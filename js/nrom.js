/**
 * nrom.js — NES NROM cartridge dump logic.
 *
 * Mirrors the behaviour of:
 *   host/scripts/nes/nrom.lua   (dump_prgrom / dump_chrrom / process)
 *   host/scripts/app/dump.lua   (dumptocallback)
 *   host/scripts/app/buffers.lua (allocate)
 *
 * Exported API:
 *   buildHeader(prgKB, chrKB, mirroring) → Uint8Array (16-byte iNES header)
 *   dumpNrom(usbDevice, opts, onProgress, onLog) → Uint8Array (.nes file)
 *
 * onProgress({ part, totalParts, progress })
 *   part       — 0=PRG, 1=CHR
 *   totalParts — 1 or 2
 *   progress   — 0..1 within this part
 *
 * onLog(message) — status string for the UI log
 */

import {
  InlRetroDevice,
  IO_RESET, NES_INIT,
  NESCPU_4KB,
  NES_PPU_RD,
  CIA10,
} from './dict.js';
import { dumpMemory } from './dump.js';

// PRG address base for NROM — NESCPU_4KB mapper bits 3-0 = A15:A12
//   0x08 = $8000 (NES PRG window)
const PRG_ADDR_BASE = 0x08;

// ============================================================
// Mirroring detection
// ============================================================

/**
 * Detect NES/FC cartridge nametable mirroring by sampling the CIRAM A10 pin
 * at two PPU addresses.  Mirrors nes.lua detect_mapper_mirroring().
 *
 * The shared address bus drives both CPU A0-A13 and PPU PA0-PA13, so placing
 * an address on the bus lets the cart's hardwired mirroring circuit assert or
 * deassert CIRAM A10 (CIA10 pin) purely combinatorially — no /RD needed.
 *
 *   $0800 → PPU A11=1, A10=0 → CIA10 is high only under horizontal mirroring
 *   $0400 → PPU A11=0, A10=1 → CIA10 is high only under vertical mirroring
 *
 * @param {InlRetroDevice} dev  — already initialised (after NES_INIT)
 * @returns {Promise<'VERT'|'HORZ'|'1SCNA'|'1SCNB'|null>}
 */
export async function detectNesMirroring(dev) {
  await dev.nesAddrSet(0x0800);
  const readH = await dev.pinCtlRd(CIA10);
  await dev.nesAddrSet(0x0400);
  const readV = await dev.pinCtlRd(CIA10);

  if (readV === 0 && readH === 0) return '1SCNA';
  if (readV !== 0 && readH !== 0) return '1SCNB';
  if (readV !== 0 && readH === 0) return 'VERT';
  /* readV === 0 && readH !== 0 */  return 'HORZ';
}

// ============================================================
// iNES 1.0 header builder
// ============================================================

/**
 * Build a 16-byte iNES 1.0 header for an NROM (mapper 0) cartridge.
 *
 * @param {number}  prgKB     — PRG-ROM size in KB (16 or 32)
 * @param {number}  chrKB     — CHR-ROM size in KB (0 or 8)
 * @param {string}  mirroring — 'VERT' or 'HORZ'
 * @param {boolean} [battery] — true = battery-backed save RAM present (default false)
 * @returns {Uint8Array}
 */
export function buildHeader(prgKB, chrKB, mirroring, battery = false) {
  const h = new Uint8Array(16);  // initialized to zero

  // Bytes 0-3: magic "NES" + MS-DOS EOF
  h[0] = 0x4E;  // N
  h[1] = 0x45;  // E
  h[2] = 0x53;  // S
  h[3] = 0x1A;  // EOF

  // Byte 4: PRG-ROM size in 16 KB units
  h[4] = prgKB / 16;

  // Byte 5: CHR-ROM size in 8 KB units (0 = CHR-RAM)
  h[5] = chrKB / 8;

  // Byte 6: Flags — mapper low nibble (NROM=0) + mirroring + battery bits
  //   bit 0: 0=horizontal/mapper-controlled, 1=vertical
  //   bit 1: 1=battery-backed save RAM present
  //   bits 4-7: mapper number lower nibble (0 for NROM)
  h[6] = (mirroring === 'VERT' ? 0x01 : 0x00) | (battery ? 0x02 : 0x00);

  // Bytes 7-15: all zero (NES 1.0 format; mapper high nibble = 0)
  return h;
}

// ============================================================
// CHR-ROM byte-by-byte dump
// ============================================================

/**
 * Dump CHR-ROM one byte at a time using individual NES_PPU_RD reads.
 *
 * The burst-read buffer approach (NESPPU_1KB via dumpMemory) relies on usbPoll()
 * for inter-byte timing inside the firmware's nes_ppu_page_rd_poll loop.  On the
 * STM32 with hardware USB, usbPoll() returns very quickly when no USB request is
 * pending, potentially giving insufficient address-setup time for vintage Famicom
 * mask ROMs (150–200 ns access time).
 *
 * The single-byte nes_ppu_rd() firmware function uses 4 explicit NOPs (~84 ns)
 * before latching data, making it reliable for all CHR-ROM chips.  nrom.lua itself
 * recommends this approach for carts with problematic CHR-ROM circuits.
 *
 * @param {InlRetroDevice} dev
 * @param {number} chrKB  — CHR-ROM size in KB
 * @param {Function} [onProgress] — called with 0..1
 * @returns {Promise<Uint8Array>}
 */
async function dumpChrRomByByte(dev, chrKB, onProgress) {
  const totalBytes = chrKB * 1024;
  const chr = new Uint8Array(totalBytes);
  for (let addr = 0; addr < totalBytes; addr++) {
    chr[addr] = await dev.nesRead(NES_PPU_RD, addr);
    // Report progress every 256 bytes to avoid flooding the callback
    if ((addr & 0xFF) === 0xFF) onProgress?.((addr + 1) / totalBytes);
  }
  return chr;
}

// ============================================================
// Public entry point
// ============================================================

/**
 * Dump an NES NROM cartridge and return a complete .nes file.
 *
 * @param {USBDevice} usbDevice   — opened, interface-claimed WebUSB device
 * @param {object}   opts
 * @param {number}   opts.prgKB      — PRG-ROM size in KB (16 or 32, default 32)
 * @param {number}   opts.chrKB      — CHR-ROM size in KB (0 or 8, default 8)
 * @param {string}   opts.mirroring  — 'VERT' or 'HORZ' (default 'VERT')
 * @param {boolean}  opts.battery    — true = set battery-backed RAM flag in header (default false)
 * @param {Function} [onProgress]    — progress callback
 * @param {Function} [onLog]         — log string callback
 * @returns {Promise<Uint8Array>}    — complete .nes file bytes
 */
export async function dumpNrom(usbDevice, opts = {}, onProgress, onLog) {
  const { prgKB = 32, chrKB = 8, mirroring = 'VERT', battery = false } = opts;
  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (msg => console.log('[nrom]', msg));
  const totalParts = (chrKB > 0) ? 2 : 1;

  // --- initialize device I/O for NES ---
  log('Initializing device I/O…');
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  // --- Auto-detect mirroring from cart hardware (overrides user selection) ---
  // Detection removed because it's not correct
  let actualMirroring = mirroring;
  // try {
  //   const detected = await detectNesMirroring(dev);
  //   if (detected) {
  //     actualMirroring = detected;
  //     log(`Mirroring detected: ${detected}.`);
  //   }
  // } catch (e) {
  //   log(`Mirroring detection failed (${e.message}), using selected: ${mirroring}.`);
  // }

  // --- Dump PRG-ROM ---
  // NESCPU_4KB + PRG_ADDR_BASE (0x08) tells the firmware to read from $8000
  // using the NES CPU bus — this is what nrom.lua uses in production.
  log(`Dumping PRG-ROM (${prgKB} KB)…`);
  const prg = await dumpMemory(
    dev, NESCPU_4KB, PRG_ADDR_BASE, prgKB,
    p => onProgress?.({ part: 0, totalParts, progress: p })
  );
  log(`PRG-ROM done (${prg.length} bytes).`);

  // --- Dump CHR-ROM (skip if CHR-RAM board) ---
  // Uses byte-by-byte NES_PPU_RD reads rather than the buffer burst system.
  // The burst method (NESPPU_1KB) relies on usbPoll() for inter-byte timing;
  // on the STM32 with hardware USB, usbPoll() can return fast enough to violate
  // the access-time requirements of vintage Famicom mask ROMs (~150–200 ns).
  // The single-byte nes_ppu_rd() firmware path has 4 explicit NOPs, making it
  // reliable.  See the fallback comment in host/scripts/nes/nrom.lua.
  let chr = new Uint8Array(0);
  if (chrKB > 0) {
    log(`Dumping CHR-ROM (${chrKB} KB) — byte-by-byte mode…`);
    chr = await dumpChrRomByByte(
      dev, chrKB,
      p => onProgress?.({ part: 1, totalParts, progress: p })
    );
    log(`CHR-ROM done (${chr.length} bytes).`);
  } else {
    log('Skipping CHR-ROM (CHR-RAM board).');
  }

  // --- Reset device to safe state ---
  log('Resetting device…');
  await dev.io(IO_RESET);

  // --- Assemble .nes file ---
  log('Assembling .nes file…');
  const header = buildHeader(prgKB, chrKB, actualMirroring, battery);
  const rom = new Uint8Array(header.length + prg.length + chr.length);
  rom.set(header, 0);
  rom.set(prg,    header.length);
  rom.set(chr,    header.length + prg.length);

  log(`Complete. File size: ${rom.length} bytes (${(rom.length / 1024).toFixed(1)} KB).`);
  return rom;
}
