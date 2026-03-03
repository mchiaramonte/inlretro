/**
 * genesis.js — Sega Genesis / Mega Drive ROM dump.
 *
 * Mirrors the behaviour of:
 *   host/scripts/sega/genesis_v2.lua
 *
 * The Genesis ROM is divided into 128 KB banks (A17–A23 selected via
 * GEN_SET_BANK). Each bank is read as two 64 KB half-pages:
 *   GENESIS_ROM_PAGE0 — A16 = 0 (lower 64 KB)
 *   GENESIS_ROM_PAGE1 — A16 = 1 (upper 64 KB)
 *
 * The internal ROM header lives at $0100–$01FF in bank 0 (PAGE0).
 * The stored checksum at $018E covers all 16-bit words from $0200 onward.
 *
 * Exported API:
 *   readGenesisHeader(dev)                              → header object
 *   dumpGenesis(usbDevice, opts, onProgress, onLog)     → { rom, title, header, checksumOk }
 *
 * opts:
 *   sizeKB {number|'AUTO'} — ROM size in KB; 'AUTO' reads from header
 *
 * onProgress({ progress: 0..1 })
 * onLog(message, cssClass?)
 */

import {
  InlRetroDevice,
  IO_RESET, SEGA_INIT,
  GENESIS_ROM_PAGE0, GENESIS_ROM_PAGE1,
} from './dict.js';
import { dumpMemory } from './dump.js';

// 128 KB per Genesis bank (A17–A23), split into two 64 KB half-pages.
const BANK_KB = 128;
const HALF_KB = 64;

// ── Header parsing ──────────────────────────────────────────────────────────
// Reference: https://plutiedev.com/rom-header

function parseGenesisHeader(data) {
  const dec = new TextDecoder('ascii');
  const str = (off, len) => dec.decode(data.slice(off, off + len)).trimEnd();

  // $0100 — console name (16 bytes); validated to identify the cart
  const consoleName = str(0x100, 16);
  const valid = consoleName.startsWith('SEGA GENESIS')   ||
                consoleName.startsWith('SEGA MEGA DRIVE') ||
                consoleName.startsWith('SEGA PICO')       ||
                consoleName.startsWith('SEGA 32X');

  // $018E — stored checksum (big-endian uint16)
  const storedChecksum = ((data[0x18E] << 8) | data[0x18F]) & 0xFFFF;

  // $01A0 — ROM address range: two big-endian uint32 (start, end)
  const romStart = ((data[0x1A0] << 24) | (data[0x1A1] << 16) |
                    (data[0x1A2] <<  8) |  data[0x1A3]) >>> 0;
  const romEnd   = ((data[0x1A4] << 24) | (data[0x1A5] << 16) |
                    (data[0x1A6] <<  8) |  data[0x1A7]) >>> 0;

  // Round up to the next 128 KB bank boundary (minimum 128 KB)
  let romSizeKB = romEnd >= romStart ? Math.ceil((romEnd - romStart + 1) / 1024) : 0;
  romSizeKB = Math.max(128, Math.ceil(romSizeKB / 128) * 128);

  return {
    consoleName,
    valid,
    domesticName: str(0x120, 48),
    intlName:     str(0x150, 48),
    serial:       str(0x180, 14),
    storedChecksum,
    region:       str(0x1F0, 3),
    romSizeKB,
  };
}

// Genesis checksum: sum of all big-endian 16-bit words from byte $0200 onward,
// truncated to 16 bits.  (Mirrors genesis_v2.lua checksum_rom.)
function computeChecksum(rom) {
  let sum = 0;
  for (let i = 0x200; i + 1 < rom.length; i += 2) {
    sum = (sum + ((rom[i] << 8) | rom[i + 1])) & 0xFFFF;
  }
  return sum;
}

// ── Header read (test button) ───────────────────────────────────────────────

/**
 * Read and parse the Genesis ROM header.
 *
 * Reads the first 512 bytes of bank 0 (PAGE0, A16=0), which covers the
 * full internal header at $0100–$01FF plus ROM range at $01A0–$01A7.
 *
 * @param {InlRetroDevice} dev  — already initialized with SEGA_INIT
 * @returns {Promise<object>}
 */
export async function readGenesisHeader(dev) {
  await dev.genSetBank(0);
  const data = await dumpMemory(dev, GENESIS_ROM_PAGE0, 0, 0.5);  // 512 bytes
  return parseGenesisHeader(data);
}

// ── ROM dump ────────────────────────────────────────────────────────────────

/**
 * Dump a Genesis / Mega Drive ROM into a Uint8Array.
 *
 * Each 128 KB bank is read as two 64 KB half-pages (PAGE0 then PAGE1).
 * After the dump the checksum is verified against the value stored in the
 * internal header.
 *
 * @param {USBDevice} usbDevice
 * @param {{ sizeKB?: number|'AUTO' }} [opts]
 * @param {Function} [onProgress]  called with { progress: 0..1 }
 * @param {Function} [onLog]       called with (message, cssClass?)
 * @returns {Promise<{ rom: Uint8Array, title: string, header: object, checksumOk: boolean }>}
 */
export async function dumpGenesis(usbDevice, opts = {}, onProgress, onLog) {
  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (() => {});

  log('Initializing Sega I/O…');
  await dev.io(IO_RESET);
  await dev.io(SEGA_INIT);

  // Resolve ROM size — auto-detect from header if not provided
  let { sizeKB } = opts;
  if (!sizeKB || sizeKB === 'AUTO') {
    const h = await readGenesisHeader(dev);
    if (!h.valid) {
      log(`Console field: "${h.consoleName}" — header may be invalid, check cart seating`, 'log-warn');
    }
    const name = (h.intlName || h.domesticName).trim();
    log(`Detected: "${h.consoleName.trim()}"  "${name}"  → ${h.romSizeKB} KB`);
    sizeKB = h.romSizeKB;
    if (!sizeKB) throw new Error('Cannot auto-detect ROM size — select manually.');
  }

  const numBanks = Math.ceil(sizeKB / BANK_KB);
  const output   = new Uint8Array(sizeKB * 1024);
  let   offset   = 0;

  const sizeFmt = sizeKB >= 1024 ? `${sizeKB / 1024} MB` : `${sizeKB} KB`;
  log(`Dumping ${sizeFmt} (${numBanks} × 128 KB banks)…`);

  for (let b = 0; b < numBanks; b++) {
    await dev.genSetBank(b);  // set A17–A23

    // Lower half-page (A16 = 0)
    const lo = await dumpMemory(dev, GENESIS_ROM_PAGE0, 0, HALF_KB, frac => {
      if (onProgress) onProgress({ progress: (b + frac * 0.5) / numBanks });
    });
    output.set(lo, offset);
    offset += lo.length;

    // Upper half-page (A16 = 1)
    const hi = await dumpMemory(dev, GENESIS_ROM_PAGE1, 0, HALF_KB, frac => {
      if (onProgress) onProgress({ progress: (b + 0.5 + frac * 0.5) / numBanks });
    });
    output.set(hi, offset);
    offset += hi.length;

    if (onProgress) onProgress({ progress: (b + 1) / numBanks });
  }

  await dev.io(IO_RESET);

  // Verify checksum
  const h = parseGenesisHeader(output);
  const computed   = computeChecksum(output);
  const checksumOk = computed === h.storedChecksum;

  const title = (h.intlName || h.domesticName || 'genesis_rom').trim();
  return { rom: output, title, header: h, checksumOk, computed };
}
