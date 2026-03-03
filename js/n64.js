/**
 * n64.js — Nintendo 64 cartridge header read and ROM dump.
 *
 * Mirrors the behaviour of:
 *   host/scripts/n64/basic.lua
 *
 * Protocol:
 *   - N64 ROM bus address starts at 0x1000_0000 (bank = 0x1000, offset = 0x0000)
 *   - 16-bit data bus; each N64_RD returns one 16-bit word (2 bytes)
 *   - A0 is ignored by the ROM — all accesses are 16-bit aligned
 *   - 64 KB per bank (bank number increments by 1 per 64KB)
 *   - Bank-by-bank dump: N64_SET_BANK → dumpMemory(64KB) → N64_RELEASE_BUS
 *
 * Output format: .z64 (big-endian, native N64 ROM byte order)
 *
 * Exported API:
 *   readN64Header(dev)                        → header object
 *   dumpN64(usbDevice, opts, onProgress, onLog) → Uint8Array
 */

import {
  InlRetroDevice,
  IO_RESET, N64_INIT,
  N64_ROM_PAGE, NOVAR,
} from './dict.js';
import { dumpMemory } from './dump.js';
import { sleep } from './utils.js';

// N64 ROM starts at bus address 0x1000_0000 → bank index 0x1000
const BANK_BASE = 0x1000;
// 64KB per bank (16-bit × 32K addresses)
const BANK_KB   = 64;

// ============================================================
// Header read
// ============================================================

/**
 * Read the first 64 bytes of the N64 ROM header.
 *
 * Byte layout (.z64 / big-endian):
 *   0x00–0x03  PI BSD Domain register / magic  (80 37 12 40 for .z64)
 *   0x04–0x07  Clock rate
 *   0x08–0x0B  Program counter (entry point)
 *   0x10–0x13  CRC1
 *   0x14–0x17  CRC2
 *   0x20–0x33  ROM title (20 ASCII bytes, space-padded)
 *   0x3B       Cartridge ID
 *   0x3E       Country code
 *   0x3F       ROM version
 *
 * @param {InlRetroDevice} dev  — already initialized with N64_INIT
 * @returns {Promise<object>}
 */
export async function readN64Header(dev) {
  // Select bank 0x1000 (ROM start) and latch address 0x0000
  await dev.n64SetBank(BANK_BASE);
  await dev.n64LatchAddr(0x0000);

  // Read 32 × 16-bit words = 64 bytes
  const header = new Uint8Array(64);
  for (let i = 0; i < 32; i++) {
    const [b0, b1] = await dev.n64Read();
    header[i * 2]     = b0;
    header[i * 2 + 1] = b1;
  }

  await dev.n64ReleaseBus();

  // Detect byte order from magic word
  const isZ64 = header[0] === 0x80 && header[1] === 0x37;  // big-endian   .z64
  const isV64 = header[0] === 0x37 && header[1] === 0x80;  // byte-swapped .v64
  const isN64 = header[0] === 0x40 && header[1] === 0x12;  // little-endian .n64

  const magic = Array.from(header.slice(0, 4))
    .map(b => b.toString(16).padStart(2, '0')).join(' ');

  const formatStr = isZ64 ? '.z64 (big-endian)'
    : isV64 ? '.v64 (byte-swapped)'
    : isN64 ? '.n64 (little-endian)'
    : `unknown format (magic: ${magic})`;

  // Title at 0x20, 20 bytes, ASCII space-padded
  const titleBytes = header.slice(0x20, 0x34);
  const title = new TextDecoder('ascii').decode(titleBytes)
    .replace(/\0/g, ' ').trim();

  // CRCs at 0x10 and 0x14 (big-endian 32-bit)
  const crc1 = ((header[0x10] << 24) | (header[0x11] << 16) |
                 (header[0x12] <<  8) |  header[0x13]) >>> 0;
  const crc2 = ((header[0x14] << 24) | (header[0x15] << 16) |
                 (header[0x16] <<  8) |  header[0x17]) >>> 0;

  const countryCode = header[0x3E];
  const version     = header[0x3F];

  // Decode common country codes
  const countryMap = {
    0x44: 'Germany', 0x45: 'USA', 0x46: 'France', 0x49: 'Italy',
    0x4A: 'Japan', 0x50: 'Europe', 0x53: 'Spain', 0x55: 'Australia',
    0x59: 'Australia (PAL)', 0x00: 'Demo',
  };
  const countryStr = countryMap[countryCode]
    ?? `0x${countryCode.toString(16).padStart(2, '0')}`;

  return { magic, isZ64, isV64, isN64, formatStr, title, crc1, crc2, countryCode, countryStr, version };
}

// Milliseconds to wait after N64_INIT before driving the address bus.
// N64 carts need more time to stabilise than other platforms.
const POWER_SETTLE_MS = 2000;

// ============================================================
// ROM dump
// ============================================================

/**
 * Dump an N64 ROM bank-by-bank into a Uint8Array (.z64 format).
 *
 * @param {USBDevice} usbDevice
 * @param {{ sizeKB?: number }} [opts]   sizeKB defaults to 8192 (8 MB)
 * @param {Function} [onProgress]        called with { progress: 0..1 }
 * @param {Function} [onLog]             called with log message strings
 * @returns {Promise<Uint8Array>}
 */
export async function dumpN64(usbDevice, opts = {}, onProgress, onLog) {
  const { sizeKB = 8 * 1024 } = opts;

  const dev = new InlRetroDevice(usbDevice);
  const log = onLog || (() => {});

  const numBanks = Math.ceil(sizeKB / BANK_KB);
  const output   = new Uint8Array(sizeKB * 1024);

  log(`Initializing N64 I/O…`);
  await dev.io(IO_RESET);
  await dev.io(N64_INIT);
  await sleep(0);

  try {
    for (let i = 0; i < numBanks; i++) {
      // Select the next 64KB bank
      await dev.n64SetBank(BANK_BASE + i);
      await sleep(0);

      // Dump 64KB via the buffer system (N64_ROM_PAGE handler)
      const bankData = await dumpMemory(dev, N64_ROM_PAGE, NOVAR, BANK_KB, frac => {
        if (onProgress) onProgress({ progress: (i + frac) / numBanks });
      });

      output.set(bankData, i * BANK_KB * 1024);

      // Release address bus between banks
      await dev.n64ReleaseBus();
      await sleep(0);

      if (onProgress) onProgress({ progress: (i + 1) / numBanks });
    }
  } finally {
    // Always release bus and reset I/O
    await dev.n64ReleaseBus();
    await dev.io(IO_RESET);
  }

  log(`N64 dump complete: ${sizeKB >= 1024 ? sizeKB / 1024 + ' MB' : sizeKB + ' KB'} (${output.length} bytes)`);
  return output;
}
