/**
 * snes.js — SNES cartridge dump logic.
 *
 * Mirrors the behaviour of:
 *   host/scripts/app/dump.lua        (dumptocallback / dump_snes)
 *   host/scripts/snes/v3.lua         (process — mask ROM HiROM/LoROM)
 *   host/scripts/snes/lorom_5volt.lua (process — LoROM flash carts)
 *
 * Exported API:
 *   dumpSnes(usbDevice, opts, onProgress, onLog) → Uint8Array (raw ROM bytes, .sfc)
 *
 * onProgress({ part, totalParts, progress })
 *   part       — always 0 (SNES has one ROM region)
 *   totalParts — always 1
 *   progress   — 0..1
 *
 * onLog(message) — status string for the UI log
 *
 * ROM file format:
 *   Raw binary with no header added (.sfc).
 *   The SNES internal header is embedded in the ROM at:
 *     LoROM:   offset $007FC0  (bank 0, bus addr $FFC0)
 *     HiROM:   offset $00FFC0  (bank 0, bus addr $FFC0)
 *     ExHiROM: offset $40FFC0  (bank $40, bus addr $FFC0)
 */

import {
  InlRetroDevice,
  IO_RESET, SNES_INIT,
  SNES_SET_BANK, SNES_ROM_RD,
  SNESROM, LOROM, HIROM, EXHIROM,
} from './dict.js';
import { dumpMemory } from './dump.js';

// ============================================================
// SNES internal header parser (for test/detect)
// Header is always readable at bus address $FFC0 in bank 0
// for LoROM and HiROM.  ExHiROM uses bank $40.
// ============================================================

/**
 * Decode a SNES ROM speed/map-mode byte ($FFD5).
 * bits 4:0 → 0x20-0x2F = HiROM, 0x00-0x1F = LoROM
 * bit 4 = 1 → HiROM
 */
function decodeMapMode(byte) {
  switch (byte & 0xEF) {  // mask out fast-ROM bit (bit 4 of upper nibble)
    case 0x20: return 'LoROM';
    case 0x21: return 'HiROM';
    case 0x22: return 'LoROM (Super MMC)';
    case 0x23: return 'SA-1';
    case 0x25: return 'ExHiROM';
    case 0x32: return 'SPC7110';
    case 0x35: return 'ExHiROM (SPC7110)';
    default:   return `Unknown (0x${byte.toString(16).padStart(2,'0')})`;
  }
}

/**
 * Decode ROM size byte ($FFD7).
 * Value = exponent: size = 1 << value KB
 */
function decodeRomSize(byte) {
  if (byte === 0) return '0 KB';
  const kb = 1 << byte;
  return kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`;
}

/**
 * Read the SNES internal header using single-byte SNES_ROM_RD calls.
 * Returns an object with title, mapMode, romSize, resetVector (or throws).
 *
 * @param {InlRetroDevice} dev
 * @param {number} headerBank — bank to read from (0 for LoROM/HiROM, 0x40 for ExHiROM)
 */
export async function readSnesHeader(dev, headerBank = 0) {
  await dev.snesSetBank(headerBank);

  // Title: 21 bytes at $FFC0-$FFD4
  const titleBytes = [];
  for (let a = 0xFFC0; a <= 0xFFD4; a++) {
    titleBytes.push(await dev.snesRead(a));
  }
  // Convert to ASCII, replace non-printable with '.'
  const title = titleBytes
    .map(b => (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.')
    .join('').trimEnd();

  const mapMode  = await dev.snesRead(0xFFD5);
  const romType  = await dev.snesRead(0xFFD6);
  const romSize  = await dev.snesRead(0xFFD7);
  const sramSize = await dev.snesRead(0xFFD8);
  const compLo   = await dev.snesRead(0xFFDC);  // $FFDC = complement lo
  const compHi   = await dev.snesRead(0xFFDD);  // $FFDD = complement hi
  const checkLo  = await dev.snesRead(0xFFDE);  // $FFDE = checksum lo
  const checkHi  = await dev.snesRead(0xFFDF);  // $FFDF = checksum hi
  const rstLo    = await dev.snesRead(0xFFFC);
  const rstHi    = await dev.snesRead(0xFFFD);

  return {
    title,
    mapModeByte: mapMode,
    mapModeStr:  decodeMapMode(mapMode),
    romTypeByte: romType,
    romSizeByte: romSize,
    romSizeStr:  decodeRomSize(romSize),
    sramSizeByte: sramSize,
    sramSizeStr:  decodeRomSize(sramSize),
    checksum:    (checkHi << 8) | checkLo,
    complement:  (compHi  << 8) | compLo,
    resetVector: (rstHi   << 8) | rstLo,
  };
}

// ============================================================
// Checksum verification
// ============================================================

/**
 * Verify the SNES internal checksum against the dumped ROM bytes.
 *
 * The SNES header contains two 16-bit fields (little-endian):
 *   $xxDC–$xxDD  Checksum complement  (should equal checksum ^ 0xFFFF)
 *   $xxDE–$xxDF  Checksum             (16-bit sum of all ROM bytes, with those
 *                                      4 bytes normalized — see below)
 *
 * Header location in the ROM file:
 *   LoROM   → offset $007FC0  (complement at $007FDC, checksum at $007FDE)
 *   HiROM   → offset $00FFC0  (complement at $00FFDC, checksum at $00FFDE)
 *   ExHiROM → offset $40FFC0  (complement at $40FFDC, checksum at $40FFDE)
 *
 * Normalisation during calculation:
 *   Treat complement bytes as 0xFF, 0xFF  and  checksum bytes as 0x00, 0x00.
 *   Equivalently: subtract their stored values, add 0x01FE.
 *
 * Non-power-of-2 ROMs (e.g. 3 MB = 2 MB + 1 MB):
 *   The SNES mirrors the trailing portion to fill the next power of 2.
 *   Those mirrored bytes are included twice in the checksum sum.
 *
 * @param {Uint8Array} rom     — raw ROM bytes, no copier/iNES header
 * @param {string}    mapping  — 'LOROM' | 'HIROM' | 'EXHIROM'
 * @returns {{ storedChecksum, storedComplement, calculatedChecksum,
 *             complementOk, checksumOk, valid [, error] }}
 */
export function verifySnesChecksum(rom, mapping = 'LOROM') {
  // Header base address within the ROM file
  const headerBase = mapping === 'EXHIROM' ? 0x40FFC0
                   : mapping === 'HIROM'   ? 0x00FFC0
                   :                        0x007FC0;

  if (headerBase + 0x3F >= rom.length) {
    return {
      valid: false,
      error: `ROM too small (${rom.length} bytes) to contain ${mapping} header at 0x${headerBase.toString(16)}`,
    };
  }

  // Byte offsets in the file
  const compOffset  = headerBase + 0x1C;  // $xxDC  complement lo, [+1] hi
  const checkOffset = headerBase + 0x1E;  // $xxDE  checksum lo,   [+1] hi

  const storedComplement = (rom[compOffset  + 1] << 8) | rom[compOffset];
  const storedChecksum   = (rom[checkOffset + 1] << 8) | rom[checkOffset];

  // Complement + checksum should always equal 0xFFFF
  const complementOk = (storedChecksum + storedComplement) === 0xFFFF;

  // --- Calculate expected checksum ---
  const size = rom.length;
  let sum = 0;

  // Sum all bytes
  for (let i = 0; i < size; i++) sum += rom[i];

  // Non-power-of-2: the trailing portion is mirrored (sum it a second time)
  if (size > 0 && (size & (size - 1)) !== 0) {
    let base = 1;
    while (base * 2 <= size) base *= 2;   // largest power-of-2 ≤ size
    for (let i = base; i < size; i++) sum += rom[i];
  }

  // Substitute normalized values for the 4 header bytes
  //   remove stored values, add 0xFF + 0xFF for complement (checksum bytes → +0, already 0)
  sum -= rom[compOffset] + rom[compOffset + 1]     // stored complement lo+hi
       + rom[checkOffset] + rom[checkOffset + 1];  // stored checksum lo+hi
  sum += 0xFF + 0xFF;                              // normalized complement = 0x01FE

  const calculatedChecksum = sum & 0xFFFF;
  const checksumOk = calculatedChecksum === storedChecksum;

  return {
    storedChecksum,
    storedComplement,
    calculatedChecksum,
    complementOk,
    checksumOk,
    valid: complementOk && checksumOk,
    headerOffset: headerBase,
  };
}

// ============================================================
// Public entry point
// ============================================================

/**
 * Dump a SNES cartridge ROM and return raw bytes (.sfc file).
 *
 * @param {USBDevice} usbDevice     — opened, interface-claimed WebUSB device
 * @param {object}   opts
 * @param {number}   opts.sizeKB    — ROM size in KB (default 512)
 * @param {string}   opts.mapping   — 'LOROM' | 'HIROM' | 'EXHIROM' (default 'LOROM')
 * @param {Function} [onProgress]   — progress callback
 * @param {Function} [onLog]        — log string callback
 * @returns {Promise<Uint8Array>}   — raw ROM bytes (no file header)
 */
export async function dumpSnes(usbDevice, opts = {}, onProgress, onLog) {
  const { sizeKB = 512, mapping = 'LOROM' } = opts;
  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (msg => console.log('[snes]', msg));

  const mapperVal = mapping === 'HIROM'   ? HIROM
                  : mapping === 'EXHIROM' ? EXHIROM
                  : LOROM;

  // --- initialize device I/O for SNES ---
  log('Initializing device I/O for SNES…');
  await dev.io(IO_RESET);
  await dev.io(SNES_INIT);

  // --- Dump ROM ---
  // SNESROM + mapper tells the firmware to traverse the ROM in the
  // correct bank/address order for the given mapping.
  log(`Dumping ROM (${sizeKB} KB, ${mapping})…`);
  const rom = await dumpMemory(
    dev, SNESROM, mapperVal, sizeKB,
    p => onProgress?.({ part: 0, totalParts: 1, progress: p })
  );
  log(`ROM done (${rom.length} bytes).`);

  // --- Reset device to safe state ---
  log('Resetting device…');
  await dev.io(IO_RESET);

  log(`Complete. File size: ${rom.length} bytes (${(rom.length / 1024).toFixed(1)} KB).`);
  return rom;
}
