/**
 * gb.js — Game Boy / Game Boy Color cartridge dump logic.
 *
 * Mirrors the behaviour of:
 *   host/scripts/gb/romonly.lua   (ROM-only carts)
 *   host/scripts/gb/mbc1.lua     (MBC1 bank-switched carts)
 *
 * Supported MBC types:
 *   ROM_ONLY — 32 KB, single dumpMemory() call from $0000.
 *   MBC1     — up to 2 MB; bank 0 at $0000–$3FFF fixed, banks 1..N-1
 *               at $4000–$7FFF after writing bank number to $2000.
 *   MBC2     — up to 256 KB; same window layout as MBC1, but bank
 *               register is at $2100 (needs A8=1) with a 4-bit bank number.
 *   MBC3     — up to 2 MB; identical register protocol to MBC1 for ROM
 *               (no shadow-bank gap, supports bank 0 at $4000 too but we
 *               skip it because bank 0 is already captured at $0000).
 *   MBC5     — up to 8 MB; 9-bit bank number split across $2000 (bits
 *               7–0) and $3000 (bit 8 only).
 *
 * Exported API:
 *   readGbHeader(dev) → header object
 *   dumpGb(usbDevice, opts, onProgress, onLog) → { rom: Uint8Array, title, header }
 *
 * opts:
 *   mbcType   {string|'AUTO'} — 'AUTO' | 'ROM_ONLY' | 'MBC1' | 'MBC2' | 'MBC3' | 'MBC5'
 *   romSizeKB {number|'AUTO'} — KB or 'AUTO' to read from cartridge header
 *
 * onProgress(0..1)
 * onLog(message)
 */

import {
  InlRetroDevice,
  IO_RESET, GAMEBOY_INIT, GB_POWER_5V,
  GAMEBOY_PAGE,
} from './dict.js';
import { dumpMemory } from './dump.js';

// ============================================================
// Cartridge type byte ($0147) → MBC name
// ============================================================
const CART_TYPE_TO_MBC = {
  0x00: 'ROM_ONLY',
  0x01: 'MBC1',  0x02: 'MBC1',  0x03: 'MBC1',
  0x05: 'MBC2',  0x06: 'MBC2',
  0x08: 'ROM_ONLY', 0x09: 'ROM_ONLY',  // ROM + RAM (no bank switching)
  0x0F: 'MBC3',  0x10: 'MBC3',  0x11: 'MBC3',
  0x12: 'MBC3',  0x13: 'MBC3',
  0x19: 'MBC5',  0x1A: 'MBC5',  0x1B: 'MBC5',
  0x1C: 'MBC5',  0x1D: 'MBC5',  0x1E: 'MBC5',
};

// ROM size code ($0148) → KB
const ROM_SIZE_CODE_TO_KB = [
  32, 64, 128, 256, 512, 1024, 2048, 4096, 8192,
];
// Non-power-of-2 sizes used by a handful of Japanese carts
const ROM_SIZE_EXTRA_KB = { 0x52: 1152, 0x53: 1280, 0x54: 1536 };

// ============================================================
// Nintendo logo bytes at header offset $0104–$0133 (48 bytes)
// The GB boot ROM validates this; if wrong the cart won't boot.
// We use it as a quick sanity-check for a seated cartridge.
// ============================================================
const NINTENDO_LOGO = new Uint8Array([
  0xCE, 0xED, 0x66, 0x66, 0xCC, 0x0D, 0x00, 0x0B,
  0x03, 0x73, 0x00, 0x83, 0x00, 0x0C, 0x00, 0x0D,
  0x00, 0x08, 0x11, 0x1F, 0x88, 0x89, 0x00, 0x0E,
  0xDC, 0xCC, 0x6E, 0xE6, 0xDD, 0xDD, 0xD9, 0x99,
  0xBB, 0xBB, 0x67, 0x63, 0x6E, 0x0E, 0xEC, 0xCC,
  0xDD, 0xDC, 0x99, 0x9F, 0xBB, 0xB9, 0x33, 0x3E,
]);

function logoValid(data) {
  for (let i = 0; i < 48; i++) {
    if (data[0x0104 + i] !== NINTENDO_LOGO[i]) return false;
  }
  return true;
}

// Header checksum ($014D): must equal ~(sum of bytes $0134–$014C) & 0xFF
function headerChecksumValid(data) {
  let v = 0;
  for (let i = 0x0134; i <= 0x014C; i++) v = (v - data[i] - 1) & 0xFF;
  return v === data[0x014D];
}

// ============================================================
// Parse the GB/GBC cartridge header from a raw byte array.
// The array must be at least 0x0150 bytes long (first 1 KB covers it).
// ============================================================
function parseGbHeader(data) {
  // Title: bytes $0134–$0143, null-padded.
  // On CGB carts the last 4 bytes of this range are the manufacturer code
  // and $0143 is the CGB flag, so the printable title may be shorter.
  let titleEnd = 0x0144;
  while (titleEnd > 0x0134 && data[titleEnd - 1] === 0x00) titleEnd--;
  const title = String.fromCharCode(...data.slice(0x0134, titleEnd))
    .replace(/[^\x20-\x7E]/g, '')
    .trim();

  const cgbFlag     = data[0x0143];
  const cartType    = data[0x0147];
  const romSizeCode = data[0x0148];
  const sramCode    = data[0x0149];

  const isGbc    = (cgbFlag === 0x80 || cgbFlag === 0xC0);
  const mbcType  = CART_TYPE_TO_MBC[cartType] ?? 'UNKNOWN';
  const romSizeKB = ROM_SIZE_CODE_TO_KB[romSizeCode] ?? ROM_SIZE_EXTRA_KB[romSizeCode] ?? null;

  const logoOk  = logoValid(data);
  const checkOk = headerChecksumValid(data);

  return { title, cgbFlag, isGbc, cartType, mbcType, romSizeCode, romSizeKB, sramCode, logoOk, checkOk };
}

// ============================================================
// Public: read GB header
// Dumps 1 KB from bank 0 ($0000) — always the fixed bank for all
// MBC types. The header lives at $0100–$014F within this range.
// ============================================================
export async function readGbHeader(dev) {
  const data = await dumpMemory(dev, GAMEBOY_PAGE, 0x00, 1, null);
  return parseGbHeader(data);
}

// ============================================================
// Internal dump strategies (one per MBC family)
// ============================================================

// ROM-only: single 32 KB read from $0000–$7FFF.
async function dumpRomOnly(dev, romSizeKB, onProgress) {
  return dumpMemory(dev, GAMEBOY_PAGE, 0x00, romSizeKB, onProgress);
}

// MBC1: bank 0 is fixed at $0000–$3FFF (addr_base 0x00).
// Banks 1..N-1 are mapped to $4000–$7FFF (addr_base 0x40).
// MBC1 bank select is split: low 5 bits → $2000, upper 2 bits → $4000.
// $6000 must be set to 0x00 (ROM banking mode) so that $4000 selects ROM
// high bits rather than RAM bank bits — required for ROMs > 512 KB (> 32 banks).
async function dumpMbc1(dev, romSizeKB, onProgress) {
  const KB_PER_BANK = 16;
  const numBanks    = romSizeKB / KB_PER_BANK;
  const output      = new Uint8Array(romSizeKB * 1024);
  let   offset      = 0;

  // ROM banking mode: upper bits of $4000 go to PRG bank high select
  await dev.gameboyWrite(0x6000, 0x00);

  // Bank 0 — fixed window, no register write needed
  const bank0 = await dumpMemory(dev, GAMEBOY_PAGE, 0x00, KB_PER_BANK,
    p => onProgress?.((0 + p) / numBanks));
  output.set(bank0, offset);
  offset += bank0.length;

  // Banks 1..N-1 — switchable window at $4000
  for (let b = 1; b < numBanks; b++) {
    await dev.gameboyWrite(0x4000, (b >> 5) & 0x03); // upper 2 bits
    await dev.gameboyWrite(0x2000, b & 0x1F);         // lower 5 bits
    const chunk = await dumpMemory(dev, GAMEBOY_PAGE, 0x40, KB_PER_BANK,
      p => onProgress?.((b + p) / numBanks));
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

// MBC2: like MBC1 but only 16 banks (4-bit bank number), and the
// bank-select register requires A8=1 (address $2100, not $2000).
async function dumpMbc2(dev, romSizeKB, onProgress) {
  const KB_PER_BANK = 16;
  const numBanks    = romSizeKB / KB_PER_BANK;
  const output      = new Uint8Array(romSizeKB * 1024);
  let   offset      = 0;

  const bank0 = await dumpMemory(dev, GAMEBOY_PAGE, 0x00, KB_PER_BANK,
    p => onProgress?.((0 + p) / numBanks));
  output.set(bank0, offset);
  offset += bank0.length;

  for (let b = 1; b < numBanks; b++) {
    await dev.gameboyWrite(0x2100, b & 0x0F);  // A8=1 required; 4-bit bank
    const chunk = await dumpMemory(dev, GAMEBOY_PAGE, 0x40, KB_PER_BANK,
      p => onProgress?.((b + p) / numBanks));
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

// MBC5: 9-bit bank number split across two registers.
//   $2000 — bits 7–0 of bank number
//   $3000 — bit  8   of bank number (0x00 or 0x01)
// Bank 0 is accessible at both $0000 and $4000 on real hardware,
// but we only read it once from the fixed window.
async function dumpMbc5(dev, romSizeKB, onProgress) {
  const KB_PER_BANK = 16;
  const numBanks    = romSizeKB / KB_PER_BANK;
  const output      = new Uint8Array(romSizeKB * 1024);
  let   offset      = 0;

  const bank0 = await dumpMemory(dev, GAMEBOY_PAGE, 0x00, KB_PER_BANK,
    p => onProgress?.((0 + p) / numBanks));
  output.set(bank0, offset);
  offset += bank0.length;

  for (let b = 1; b < numBanks; b++) {
    await dev.gameboyWrite(0x2000,  b & 0xFF);        // low 8 bits
    await dev.gameboyWrite(0x3000, (b >> 8) & 0x01);  // bit 8
    const chunk = await dumpMemory(dev, GAMEBOY_PAGE, 0x40, KB_PER_BANK,
      p => onProgress?.((b + p) / numBanks));
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

// ============================================================
// Public entry point
// ============================================================

/**
 * Dump a GB / GBC cartridge and return the raw ROM bytes.
 *
 * @param {USBDevice} usbDevice  — opened, interface-claimed WebUSB device
 * @param {object}   opts
 * @param {string}   opts.mbcType   — MBC type, or 'AUTO' to read from header
 * @param {number|string} opts.romSizeKB — ROM size in KB, or 'AUTO'
 * @param {Function} [onProgress]  — called with 0..1
 * @param {Function} [onLog]       — log string callback
 * @returns {Promise<{ rom: Uint8Array, title: string, header: object }>}
 */
export async function dumpGb(usbDevice, opts = {}, onProgress, onLog) {
  let { mbcType = 'AUTO', romSizeKB = 'AUTO' } = opts;
  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (msg => console.log('[gb]', msg));

  // initialize device I/O for Game Boy
  log('Initializing device I/O…');
  await dev.io(IO_RESET);
  await dev.io(GAMEBOY_INIT);
  await dev.io(GB_POWER_5V);

  // Auto-detect MBC type and/or ROM size from the cartridge header
  let header = null;
  let title  = '';
  if (mbcType === 'AUTO' || romSizeKB === 'AUTO') {
    log('Reading cartridge header…');
    header = await readGbHeader(dev);

    log(`Title:     "${header.title}"`);
    log(`Cart type: 0x${header.cartType.toString(16).padStart(2, '0')} → ${header.mbcType}  (${header.isGbc ? 'GBC' : 'DMG'})`);
    log(`ROM size:  code 0x${header.romSizeCode.toString(16)} → ${header.romSizeKB ?? '?'} KB`);
    log(`Logo: ${header.logoOk ? 'OK' : 'FAIL'}  Header checksum: ${header.checkOk ? 'OK' : 'FAIL'}`);

    if (!header.logoOk || !header.checkOk) {
      log('WARNING: header validation failed — check cart seating.');
    }

    if (mbcType   === 'AUTO') mbcType   = header.mbcType;
    if (romSizeKB === 'AUTO') romSizeKB = header.romSizeKB;
    title = header.title;
  }

  if (!romSizeKB) throw new Error('ROM size could not be determined. Set it manually.');
  if (!mbcType || mbcType === 'UNKNOWN') {
    throw new Error(`unrecognized MBC type (cart type byte 0x${header?.cartType?.toString(16) ?? '??'}). Set MBC type manually.`);
  }

  log(`Dumping ${romSizeKB} KB using ${mbcType}…`);

  let rom;
  switch (mbcType) {
    case 'ROM_ONLY':
      rom = await dumpRomOnly(dev, romSizeKB, onProgress);
      break;
    case 'MBC1':
    case 'MBC3':
      rom = await dumpMbc1(dev, romSizeKB, onProgress);
      break;
    case 'MBC2':
      rom = await dumpMbc2(dev, romSizeKB, onProgress);
      break;
    case 'MBC5':
      rom = await dumpMbc5(dev, romSizeKB, onProgress);
      break;
    default:
      throw new Error(`Unsupported MBC type: ${mbcType}. Supported: ROM_ONLY, MBC1, MBC2, MBC3, MBC5.`);
  }

  log('Resetting device…');
  await dev.io(IO_RESET);

  log(`Complete. ${rom.length} bytes (${(rom.length / 1024).toFixed(0)} KB).`);
  return { rom, title, header };
}
