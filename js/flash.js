/**
 * flash.js — Core double-buffer flash-write streaming engine.
 *
 * Mirrors host/scripts/app/flash.lua write_file().
 *
 * Protocol (mirrors buffers.lua allocate() for the flash 2×256B configuration):
 *
 *   Buffer layout for flash (2 × 256B per page):
 *     buff0: 8 raw banks, id=0, base=0  → even pages  (firstPage=0, reload=2)
 *     buff1: 8 raw banks, id=0, base=8  → odd  pages  (firstPage=1, reload=2)
 *
 * Flow:
 *   1. RAW_BUFFER_RESET + allocate both buffers
 *   2. SET_MEM_N_PART / SET_MAP_N_MAPVAR for both buffers
 *   3. SET_OPERATION(STARTFLASH) — arm device
 *   4. For each 256B chunk:
 *        a. Poll GET_CUR_BUFF_STATUS until EMPTY (buffer ready)
 *        b. Send chunk via bufferPayloadOut
 *   5. After all chunks: poll GET_PRI_ELEMENTS on each buffer until EMPTY or FLASHED
 *   6. SET_OPERATION(RESET) + RAW_BUFFER_RESET
 *
 * Export:
 *   flashStream(dev, romBytes, mapperVal, memType, romOffset, sizeKB, onProgress)
 */

import {
  SET_OPERATION,
  RAW_BUFFER_RESET,
  SET_MEM_N_PART, SET_MAP_N_MAPVAR,
  ALLOCATE_BUFFER0, ALLOCATE_BUFFER1,
  SET_RELOAD_PAGENUM0, SET_RELOAD_PAGENUM1,
  MASKROM, NOVAR,
  OP_RESET, STARTFLASH, EMPTY, FLASHED,
} from './dict.js';

// Flash uses 256B buffers (8 raw banks × 32 B/bank)
const FLASH_BUFF_SIZE = 256;
const FLASH_NUM_BANKS = 8;

// Max polls per chunk before giving up.  Flash programming is ~14 µs/byte so
// a 256B chunk takes ~3.6 ms.  At ~1 poll/ms that is ~4 polls/chunk minimum;
// 50 000 gives a generous 50-second per-chunk safety net.
const MAX_POLLS = 50000;

/**
 * Allocate two 256-byte double-buffers for flash write operations.
 * Must be preceded by RAW_BUFFER_RESET if re-using after a dump.
 */
async function allocateFlashBuffers(dev) {
  // buff0: 8 raw banks, id=0, base bank 0
  await dev.buffer(ALLOCATE_BUFFER0, (0 << 8) | 0, FLASH_NUM_BANKS);
  // buff1: 8 raw banks, id=0, base bank 8
  await dev.buffer(ALLOCATE_BUFFER1, (0 << 8) | 8, FLASH_NUM_BANKS);
  // reload=2 (page_num increments by 2 per completed buffer), firstPage differentiates even/odd
  await dev.buffer(SET_RELOAD_PAGENUM0, 0, 2);  // firstPage=0, reload=2
  await dev.buffer(SET_RELOAD_PAGENUM1, 1, 2);  // firstPage=1, reload=2
}

/**
 * Stream `sizeKB` kilobytes from `romBytes` starting at byte offset `romOffset`
 * to the flash chip, using the double-buffer pipeline.
 *
 * The caller is responsible for:
 *   - Erasing the chip (or relevant sectors) before calling.
 *   - Any mapper-specific bank switching before calling (for banked carts).
 *
 * @param {InlRetroDevice} dev
 * @param {Uint8Array}     romBytes   — full ROM image (including any header)
 * @param {number}         mapperVal  — e.g. NROM, MMC1_MAPPER, LOROM_5VOLT
 * @param {number}         memType    — e.g. PRGROM, CHRROM, SNESROM
 * @param {number}         romOffset  — byte offset into romBytes where this block starts
 * @param {number}         sizeKB     — size of this block in kilobytes
 * @param {function(number):void} [onProgress] — called with 0..1 after each chunk
 */
export async function flashStream(dev, romBytes, mapperVal, memType, romOffset, sizeKB, onProgress) {
  const totalBytes = sizeKB * 1024;
  const numChunks  = totalBytes / FLASH_BUFF_SIZE;

  // ── Buffer setup ──────────────────────────────────────────────────────────
  await dev.oper(SET_OPERATION, OP_RESET);
  await dev.buffer(RAW_BUFFER_RESET);
  await allocateFlashBuffers(dev);

  const memOp = (memType   << 8) | MASKROM;
  const mapOp = (mapperVal << 8) | NOVAR;
  await dev.buffer(SET_MEM_N_PART,   memOp, 0);  // buff0
  await dev.buffer(SET_MAP_N_MAPVAR, mapOp, 0);
  await dev.buffer(SET_MEM_N_PART,   memOp, 1);  // buff1
  await dev.buffer(SET_MAP_N_MAPVAR, mapOp, 1);

  // ── Arm flash ─────────────────────────────────────────────────────────────
  await dev.oper(SET_OPERATION, STARTFLASH);

  // ── Stream chunks ─────────────────────────────────────────────────────────
  for (let i = 0; i < numChunks; i++) {
    // Wait for device to signal the current buffer is EMPTY (ready for data)
    let status, polls = 0;
    do {
      if (++polls > MAX_POLLS) {
        throw new Error(`Flash timeout waiting for EMPTY on chunk ${i + 1}/${numChunks}`);
      }
      status = await dev.bufferStatus();
    } while (status !== EMPTY);

    const offset = romOffset + i * FLASH_BUFF_SIZE;
    const chunk  = romBytes.subarray(offset, offset + FLASH_BUFF_SIZE);
    await dev.bufferPayloadOut(chunk);

    if (onProgress) onProgress((i + 1) / numChunks);
  }

  // ── Wait for both buffers to finish programming ───────────────────────────
  for (let bn = 0; bn < 2; bn++) {
    let status, polls = 0;
    do {
      if (++polls > MAX_POLLS) {
        throw new Error(`Flash timeout waiting for buffer ${bn} to complete`);
      }
      status = await dev.getPriElements(bn);
    } while (status !== EMPTY && status !== FLASHED);
  }

  // ── Finalize ──────────────────────────────────────────────────────────────
  await dev.oper(SET_OPERATION, OP_RESET);
  await dev.buffer(RAW_BUFFER_RESET);
}
