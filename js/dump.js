/**
 * dump.js — shared buffer dump primitives.
 *
 * Mirrors the behaviour of:
 *   host/scripts/app/buffers.lua  (allocate)
 *   host/scripts/app/dump.lua     (dumptocallback)
 *
 * Used by nrom.js, snes.js, and any future console modules.
 *
 * Exported API:
 *   allocateBuffers(dev)
 *   beginDumpSession(dev, memType, mapperVal)
 *   dumpChunkSession(dev, sizeKB, onProgress) → Uint8Array
 *   endDumpSession(dev)
 *   dumpMemory(dev, memType, mapperVal, sizeKB, onProgress) → Uint8Array
 */

import {
  SET_OPERATION,
  RAW_BUFFER_RESET,
  SET_MEM_N_PART, SET_MAP_N_MAPVAR,
  ALLOCATE_BUFFER0, ALLOCATE_BUFFER1,
  SET_RELOAD_PAGENUM0, SET_RELOAD_PAGENUM1,
  MASKROM, NOVAR,
  OP_RESET, STARTDUMP, DUMPED,
  RAW_BANK_SIZE,
} from './dict.js';

// Each firmware buffer is 128 bytes (4 raw banks × 32 bytes/bank).
export const BUFF_SIZE = 128;
const NUM_BANKS = BUFF_SIZE / RAW_BANK_SIZE;  // = 4

// Maximum number of status polls before giving up (safety timeout).
// Each poll is a USB round-trip (~1 ms), so 10000 ≈ 10 second timeout.
const MAX_POLLS = 10000;

// ============================================================
// Buffer allocation
// Mirrors buffers.lua allocate() for 2 × 128B configuration
// ============================================================

/**
 * Allocate two 128-byte double-buffers on the device firmware.
 *
 * Buffer layout (2 × 128B = 256B per page):
 *   buff0: id=0x00, banks 0-3   → handles low half of each 256B page
 *   buff1: id=0x80, banks 4-7   → handles high half of each 256B page
 *   reload = 1 (page_num increments by 1 per completed 256B pair)
 *
 * @param {InlRetroDevice} dev
 */
export async function allocateBuffers(dev) {
  // ALLOCATE_BUFFER0: operand=(id<<8|baseBank)=0x0000, misc=numBanks=4
  await dev.buffer(ALLOCATE_BUFFER0, (0x00 << 8) | 0, NUM_BANKS);

  // ALLOCATE_BUFFER1: operand=(0x80<<8|4)=0x8004, misc=numBanks=4
  await dev.buffer(ALLOCATE_BUFFER1, (0x80 << 8) | NUM_BANKS, NUM_BANKS);

  // SET_RELOAD_PAGENUM0/1: misc=reload=1, operand=firstPage=0
  await dev.buffer(SET_RELOAD_PAGENUM0, 0x0000, 1);
  await dev.buffer(SET_RELOAD_PAGENUM1, 0x0000, 1);
}

// ============================================================
// Dump sessions — reusable buffer setup for multi-chunk workflows
// ============================================================

/**
 * Begin a dump session: reset buffer manager, allocate buffers, and
 * configure memory type / mapper.
 *
 * @param {InlRetroDevice} dev
 * @param {number} memType
 * @param {number} mapperVal
 */
export async function beginDumpSession(dev, memType, mapperVal) {
  // --- Reset buffer manager and raw SRAM allocations ---
  await dev.oper(SET_OPERATION, OP_RESET);
  await dev.buffer(RAW_BUFFER_RESET);

  // --- Allocate two 128B double-buffers ---
  await allocateBuffers(dev);

  // --- Tell each buffer what memory type / mapper to use ---
  // SET_MEM_N_PART: operand=(memType<<8|partNum), misc=buffN
  const memOp = (memType   << 8) | MASKROM;
  await dev.buffer(SET_MEM_N_PART, memOp, 0);  // buff0
  await dev.buffer(SET_MEM_N_PART, memOp, 1);  // buff1

  // SET_MAP_N_MAPVAR: operand=(mapper<<8|mapvar), misc=buffN
  const mapOp = (mapperVal << 8) | NOVAR;
  await dev.buffer(SET_MAP_N_MAPVAR, mapOp, 0);  // buff0
  await dev.buffer(SET_MAP_N_MAPVAR, mapOp, 1);  // buff1
}

/**
 * Dump `sizeKB` kilobytes of ROM from the cartridge into a Uint8Array,
 * using an already-started dump session.
 *
 * @param {InlRetroDevice} dev
 * @param {number} sizeKB
 * @param {Function} [onProgress] — called with 0..1 after each 128B chunk
 * @returns {Promise<Uint8Array>}
 */
export async function dumpChunkSession(dev, sizeKB, onProgress) {
  const totalBytes = sizeKB * 1024;
  const numReads   = totalBytes / BUFF_SIZE;
  const output     = new Uint8Array(totalBytes);
  let   offset     = 0;

  // --- Kick off the dump ---
  await dev.oper(SET_OPERATION, STARTDUMP);

  // --- Pull data out 128B at a time ---
  for (let i = 0; i < numReads; i++) {
    // Poll until the current buffer is DUMPED (filled from cart and ready)
    let status;
    let polls = 0;
    do {
      if (++polls > MAX_POLLS) {
        throw new Error(`Timeout waiting for buffer DUMPED on read ${i + 1}/${numReads}`);
      }
      status = await dev.bufferStatus();
    } while (status !== DUMPED);

    // Retrieve the 128B chunk
    const chunk = await dev.bufferPayloadIn(BUFF_SIZE);
    output.set(chunk, offset);
    offset += BUFF_SIZE;

    if (onProgress) onProgress((i + 1) / numReads);
  }

  return output;
}

/**
 * End a dump session: reset buffer manager and raw SRAM allocations.
 *
 * @param {InlRetroDevice} dev
 */
export async function endDumpSession(dev) {
  await dev.oper(SET_OPERATION, OP_RESET);
  await dev.buffer(RAW_BUFFER_RESET);
}

// ============================================================
// Core dump routine — works for PRG, CHR, SNESROM, etc.
// Mirrors dump.lua dumptocallback()
// ============================================================

/**
 * Dump `sizeKB` kilobytes of ROM from the cartridge into a Uint8Array.
 *
 * @param {InlRetroDevice} dev
 * @param {number} memType   — e.g. NESCPU_4KB, NESPPU_1KB, SNESROM
 * @param {number} mapperVal — e.g. PRG_ADDR_BASE, LOROM, HIROM
 * @param {number} sizeKB    — how many KB to read
 * @param {Function} [onProgress] — called with 0..1 after each 128B chunk
 * @returns {Promise<Uint8Array>}
 */
export async function dumpMemory(dev, memType, mapperVal, sizeKB, onProgress) {
  await beginDumpSession(dev, memType, mapperVal);
  const output = await dumpChunkSession(dev, sizeKB, onProgress);
  await endDumpSession(dev);
  return output;
}
