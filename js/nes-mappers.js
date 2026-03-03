/**
 * nes-mappers.js — NES/Famicom bank-switched mapper dump implementations.
 *
 * Mirrors the behaviour of the corresponding Lua scripts in host/scripts/nes/:
 *   Mapper 2  UxROM  — unrom.lua
 *   Mapper 3  CNROM  — cnrom.lua
 *   Mapper 1  MMC1   — mmc1.lua
 *   Mapper 4  MMC3   — mmc3.lua
 *   Mapper 34 BxROM  — bnrom.lua  (CHR-RAM variant)
 *   Mapper 34 NINA-001 — bnrom.lua (CHR-ROM variant, $7FFD-$7FFF registers)
 *   Mapper 69 FME7   — fme7.lua
 *   Mapper 9  MMC2   — mmc2.lua
 *   Mapper 10 MMC4   — mmc4.lua
 *   Mapper 5  MMC5   — mmc5.lua
 *
 * Exported API:
 *   dumpUxRom  (usbDevice, opts, onProgress, onLog)  → Uint8Array (.nes)
 *   dumpCnrom  (usbDevice, opts, onProgress, onLog)  → Uint8Array (.nes)
 *   dumpMmc1   (usbDevice, opts, onProgress, onLog)  → Uint8Array (.nes)
 *   dumpMmc3   (usbDevice, opts, onProgress, onLog)  → Uint8Array (.nes)
 *   dumpBxRom  (usbDevice, opts, onProgress, onLog)  → Uint8Array (.nes)
 *   dumpNina001(usbDevice, opts, onProgress, onLog)  → Uint8Array (.nes)
 *   dumpFme7   (usbDevice, opts, onProgress, onLog)  → Uint8Array (.nes)
 *   dumpMmc2   (usbDevice, opts, onProgress, onLog)  → Uint8Array (.nes)
 *   dumpMmc4   (usbDevice, opts, onProgress, onLog)  → Uint8Array (.nes)
 *   dumpMmc5   (usbDevice, opts, onProgress, onLog)  → Uint8Array (.nes)
 *
 * Common opts fields:
 *   prgKB     {number}  PRG-ROM size in KB
 *   chrKB     {number}  CHR-ROM size in KB (0 = CHR-RAM board, omit CHR section)
 *   mirroring {string}  'VERT' | 'HORZ'
 *
 * onProgress({ part, totalParts, progress })
 *   part       — 0=PRG, 1=CHR
 *   totalParts — 1 (PRG-only) or 2 (PRG+CHR)
 *   progress   — 0..1 within the current part
 *
 * onLog(message, cssClass?)
 */

import {
  InlRetroDevice,
  IO_RESET, NES_INIT,
  NES_CPU_WR, NES_MMC1_WR,
  NESCPU_4KB, NESPPU_1KB,
  NESCPU_PAGE, NESPPU_PAGE,
  NES_PPU_RD,
} from './dict.js';
import { dumpMemory } from './dump.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Search `data` for the ascending sequence [0, 1, 2, ..., seqLen-1].
 * Returns the byte offset within `data` where the sequence starts, or -1.
 */
function searchBankTable(data, seqLen) {
  outer: for (let i = 0; i <= data.length - seqLen; i++) {
    for (let j = 0; j < seqLen; j++) {
      if (data[i + j] !== j) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Locate the bank table in the currently-visible NES CPU bank.
 *
 * The bank table is the byte sequence [0, 1, 2, ..., seqLen-1] stored at the
 * same offset in every bank.  Writing bank `b` to address `(result + b)` is
 * bus-conflict-safe because ROM[result + b] === b, so both the device and ROM
 * drive the same value on the data bus.
 *
 * Mirrors the find_banktable() logic in host/scripts/nes/unrom.lua.
 *
 * Scans the upper 16 KB ($C000-$FFFF) first (fixed bank for UxROM; common
 * location for BNROM tables too), then the lower 16 KB ($8000-$BFFF) if needed.
 *
 * @param {InlRetroDevice} dev
 * @param {number}   seqLen — number of entries to search for
 * @param {Function} [log]  — optional log callback
 * @returns {Promise<number|null>} CPU address of bank-table start, or null
 */
async function findBankTable(dev, seqLen, log) {
  // Upper 16 KB ($C000-$FFFF) — fixed bank for UxROM; also typical for BNROM
  const upper = await dumpMemory(dev, NESCPU_4KB, 0x0C, 16, null);
  const off = searchBankTable(upper, seqLen);
  if (off >= 0) {
    const addr = 0xC000 + off;
    log?.(`Bank table found at $${addr.toString(16).toUpperCase().padStart(4, '0')}.`);
    return addr;
  }

  // Lower 16 KB ($8000-$BFFF)
  const lower = await dumpMemory(dev, NESCPU_4KB, 0x08, 16, null);
  const off2 = searchBankTable(lower, seqLen);
  if (off2 >= 0) {
    const addr = 0x8000 + off2;
    log?.(`Bank table found at $${addr.toString(16).toUpperCase().padStart(4, '0')}.`);
    return addr;
  }

  log?.('Warning: bank table not found — bank-switch writes may suffer bus conflicts.');
  return null;
}

/** Concatenate an array of Uint8Arrays into one. */
function concat(arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

/**
 * Build a 16-byte iNES 1.0 header.
 *
 * @param {number} mapperNum  — iNES mapper number (0-255)
 * @param {number} prgKB      — PRG-ROM size in KB
 * @param {number} chrKB      — CHR-ROM size in KB (0 = CHR-RAM)
 * @param {string} mirroring  — 'VERT' or 'HORZ'
 * @returns {Uint8Array}
 */
function buildInesHeader(mapperNum, prgKB, chrKB, mirroring, battery = false) {
  const h = new Uint8Array(16);
  h[0] = 0x4E;  // N
  h[1] = 0x45;  // E
  h[2] = 0x53;  // S
  h[3] = 0x1A;  // EOF
  h[4] = prgKB / 16;
  h[5] = chrKB / 8;
  // Byte 6: mapper lower nibble | mirroring bit | battery bit
  h[6] = ((mapperNum & 0x0F) << 4)
       | (mirroring === 'VERT' ? 0x01 : 0x00)
       | (battery ? 0x02 : 0x00);
  // Byte 7: mapper upper nibble
  h[7] = mapperNum & 0xF0;
  return h;
}

/**
 * Assemble a complete .nes file from header params + raw data arrays.
 * @param {number} mapperNum
 * @param {number} prgKB
 * @param {number} chrKB
 * @param {string} mirroring
 * @param {Uint8Array[]} prgChunks
 * @param {Uint8Array[]} chrChunks
 * @returns {Uint8Array}
 */
function assembleNes(mapperNum, prgKB, chrKB, mirroring, prgChunks, chrChunks, opts = {}) {
  const { battery = false } = opts;
  const header = buildInesHeader(mapperNum, prgKB, chrKB, mirroring, battery);
  const prg = concat(prgChunks);
  const chr = concat(chrChunks);
  const rom = new Uint8Array(header.length + prg.length + chr.length);
  rom.set(header, 0);
  rom.set(prg, header.length);
  rom.set(chr, header.length + prg.length);
  return rom;
}

// ── Mapper 2: UxROM ──────────────────────────────────────────────────────────

/**
 * Dump a UxROM (Mapper 2) cartridge.
 *
 * PRG: 16 KB switchable bank at $8000, fixed last bank at $C000.
 * CHR: CHR-RAM only (no CHR-ROM to dump).
 *
 * Mirrors unrom.lua dump_prgrom().
 */
export async function dumpUxRom(usbDevice, opts = {}, onProgress, onLog) {
  const { prgKB = 128, mirroring = 'VERT' } = opts;
  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (msg => console.log('[uxrom]', msg));
  const chrKB = 0;  // UxROM uses CHR-RAM

  log('Initializing NES I/O…');
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  const numBanks = prgKB / 16;  // 16 KB per bank

  // Find the bank table in the fixed bank ($C000-$FFFF) for bus-conflict-safe
  // bank switching.  The table has numBanks-1 entries (switchable banks 0..N-2;
  // the fixed last bank doesn't need an entry).  Mirrors unrom.lua find_banktable().
  log('Scanning fixed bank for bank table…');
  const banktableBase = await findBankTable(dev, numBanks - 1, log);

  log(`Dumping PRG-ROM (${prgKB} KB, UxROM mapper 2)…`);
  const prgChunks = [];

  // Switchable banks 0 through N-2
  for (let b = 0; b < numBanks - 1; b++) {
    const switchAddr = banktableBase !== null ? banktableBase + b : 0x8000;
    await dev.nesWrite(switchAddr, b);
    const chunk = await dumpMemory(dev, NESCPU_4KB, 0x08, 16, frac => {
      onProgress?.({ part: 0, totalParts: 1, progress: (b + frac) / numBanks });
    });
    prgChunks.push(chunk);
  }

  // Fixed last bank at $C000-$FFFF (no bank select write needed)
  const fixed = await dumpMemory(dev, NESCPU_4KB, 0x0C, 16, frac => {
    onProgress?.({ part: 0, totalParts: 1, progress: (numBanks - 1 + frac) / numBanks });
  });
  prgChunks.push(fixed);
  onProgress?.({ part: 0, totalParts: 1, progress: 1 });

  await dev.io(IO_RESET);
  log(`Complete. PRG: ${prgKB} KB, CHR: 0 KB (CHR-RAM).`);
  return assembleNes(2, prgKB, chrKB, mirroring, prgChunks, [], opts);
}

// ── Mapper 3: CNROM ──────────────────────────────────────────────────────────

/**
 * Dump a CNROM (Mapper 3) cartridge.
 *
 * PRG: 16 or 32 KB fixed (no PRG banking).
 * CHR: 8 KB switchable banks — write bank# to $8000 to select.
 *
 * Mirrors cnrom.lua dump_prgrom() / dump_chrrom().
 */
export async function dumpCnrom(usbDevice, opts = {}, onProgress, onLog) {
  const { prgKB = 32, chrKB = 32, mirroring = 'VERT' } = opts;
  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (msg => console.log('[cnrom]', msg));
  const totalParts = 2;

  log('Initializing NES I/O…');
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  // PRG: no banking, read directly (same as NROM)
  log(`Dumping PRG-ROM (${prgKB} KB)…`);
  const prg = await dumpMemory(dev, NESCPU_4KB, 0x08, prgKB, frac => {
    onProgress?.({ part: 0, totalParts, progress: frac });
  });

  // CHR: 8 KB banks — write bank# to $8000
  log(`Dumping CHR-ROM (${chrKB} KB, ${chrKB / 8} banks)…`);
  const chrChunks = [];
  const numChrBanks = chrKB / 8;
  for (let b = 0; b < numChrBanks; b++) {
    await dev.nesWrite(0x8000, b);
    const chunk = await dumpMemory(dev, NESPPU_1KB, 0x00, 8, frac => {
      onProgress?.({ part: 1, totalParts, progress: (b + frac) / numChrBanks });
    });
    chrChunks.push(chunk);
  }
  onProgress?.({ part: 1, totalParts, progress: 1 });

  await dev.io(IO_RESET);
  log(`Complete. PRG: ${prgKB} KB, CHR: ${chrKB} KB.`);
  return assembleNes(3, prgKB, chrKB, mirroring, [prg], chrChunks, opts);
}

// ── Mapper 1: MMC1 ───────────────────────────────────────────────────────────

/**
 * Dump an MMC1 (Mapper 1) cartridge.
 *
 * PRG: 32 KB banks at $8000-$FFFF (mode 0/1).  Bank select via MMC1_WR to $E000.
 * CHR: 8 KB banks (two 4 KB halves).  Bank select via MMC1_WR to $A000 / $C000.
 *
 * Mirrors mmc1.lua init_mapper() / dump_prgrom() / dump_chrrom().
 */
export async function dumpMmc1(usbDevice, opts = {}, onProgress, onLog) {
  const { prgKB = 256, chrKB = 128, mirroring = 'VERT' } = opts;
  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (msg => console.log('[mmc1]', msg));
  const totalParts = chrKB > 0 ? 2 : 1;

  log('Initializing NES I/O…');
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  // MMC1 init (mirrors init_mapper in mmc1.lua):
  // Reset shift register with D7 set → control reg = 0x0C (16KB+fixed mode, onescreen)
  await dev.nesWrite(0x8000, 0x80);
  // Control: 0x10 = PRG mode 0 (32KB at $8000), CHR mode 0 (8KB), mirroring onescreen A
  await dev.nesMmc1Write(0x8000, 0x10);
  // PRG bank 0, WRAM disable
  await dev.nesMmc1Write(0xE000, 0x10);
  // CHR banks (flash-oriented init values; harmless for dump)
  await dev.nesMmc1Write(0xA000, 0x12);
  await dev.nesMmc1Write(0xC000, 0x15);

  // PRG: 32 KB at a time, MMC1_WR $E000 with bank# (bit 0 ignored in 32KB mode)
  log(`Dumping PRG-ROM (${prgKB} KB, ${prgKB / 32} × 32 KB)…`);
  const prgChunks = [];
  const numPrgBanks = prgKB / 32;
  for (let b = 0; b < numPrgBanks; b++) {
    await dev.nesMmc1Write(0xE000, b << 1);  // bit0 ignored; shift for clarity
    const chunk = await dumpMemory(dev, NESCPU_4KB, 0x08, 32, frac => {
      onProgress?.({ part: 0, totalParts, progress: (b + frac) / numPrgBanks });
    });
    prgChunks.push(chunk);
  }
  onProgress?.({ part: 0, totalParts, progress: 1 });

  // CHR: 8 KB at a time (two 4 KB halves via $A000 and $C000)
  const chrChunks = [];
  if (chrKB > 0) {
    log(`Dumping CHR-ROM (${chrKB} KB, ${chrKB / 8} × 8 KB)…`);
    const numChrBanks = chrKB / 8;
    for (let b = 0; b < numChrBanks; b++) {
      await dev.nesMmc1Write(0xA000, b * 2);      // 4 KB at PPU $0000
      await dev.nesMmc1Write(0xC000, b * 2 + 1);  // 4 KB at PPU $1000
      const chunk = await dumpMemory(dev, NESPPU_1KB, 0x00, 8, frac => {
        onProgress?.({ part: 1, totalParts, progress: (b + frac) / numChrBanks });
      });
      chrChunks.push(chunk);
    }
    onProgress?.({ part: 1, totalParts, progress: 1 });
  }

  await dev.io(IO_RESET);
  log(`Complete. PRG: ${prgKB} KB, CHR: ${chrKB} KB.`);
  return assembleNes(1, prgKB, chrKB, mirroring, prgChunks, chrChunks, opts);
}

// ── Mapper 4: MMC3 ───────────────────────────────────────────────────────────

/**
 * Dump an MMC3 (Mapper 4) cartridge.
 *
 * PRG: 16 KB banks at $8000-$BFFF (regs 6+7 in mode 0).
 * CHR: 4 KB banks via PPU $0000-$0FFF (regs 0+1 only; covers all CHR by iterating banks).
 *
 * Mirrors mmc3.lua init_mapper() / dump_prgrom() / dump_chrrom().
 */
export async function dumpMmc3(usbDevice, opts = {}, onProgress, onLog) {
  const { prgKB = 512, chrKB = 256, mirroring = 'VERT' } = opts;
  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (msg => console.log('[mmc3]', msg));
  const totalParts = chrKB > 0 ? 2 : 1;

  log('Initializing NES I/O…');
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  // MMC3 init (mirrors init_mapper in mmc3.lua):
  await dev.nesWrite(0xA001, 0x40);  // disable WRAM, deny writes
  await dev.nesWrite(0xA000, 0x00);  // vertical mirroring
  // Set PRG bank regs 6+7 to banks 0+1 for flash alignment (harmless for dump)
  await dev.nesWrite(0x8000, 0x06);
  await dev.nesWrite(0x8001, 0x00);  // reg6 = 8KB at $8000
  await dev.nesWrite(0x8000, 0x07);
  await dev.nesWrite(0x8001, 0x01);  // reg7 = 8KB at $A000
  // Leave reg0 selected (CHR bank at $0000) so PRG data writes don't change PRG banks
  await dev.nesWrite(0x8000, 0x00);

  // PRG: 16 KB per iter — reg6 selects $8000, reg7 selects $A000
  log(`Dumping PRG-ROM (${prgKB} KB, ${prgKB / 16} × 16 KB)…`);
  const prgChunks = [];
  const numPrgBanks = prgKB / 16;
  for (let b = 0; b < numPrgBanks; b++) {
    await dev.nesWrite(0x8000, 0x06);
    await dev.nesWrite(0x8001, b * 2);      // 8 KB at $8000
    await dev.nesWrite(0x8000, 0x07);
    await dev.nesWrite(0x8001, b * 2 + 1);  // 8 KB at $A000
    const chunk = await dumpMemory(dev, NESCPU_4KB, 0x08, 16, frac => {
      onProgress?.({ part: 0, totalParts, progress: (b + frac) / numPrgBanks });
    });
    prgChunks.push(chunk);
  }
  onProgress?.({ part: 0, totalParts, progress: 1 });

  // CHR: 4 KB per iter — reg0 selects 2KB at PPU $0000, reg1 selects 2KB at PPU $0800.
  // All CHR data is read through the $0000-$0FFF window; bit 0 of each 2KB bank is ignored
  // by MMC3 hardware, so we shift left by 1 to select even-aligned 2KB banks.
  const chrChunks = [];
  if (chrKB > 0) {
    log(`Dumping CHR-ROM (${chrKB} KB, ${chrKB / 4} × 4 KB)…`);
    const numChrIter = chrKB / 4;
    for (let b = 0; b < numChrIter; b++) {
      await dev.nesWrite(0x8000, 0x00);
      await dev.nesWrite(0x8001, (b * 2) << 1);      // 2KB at PPU $0000
      await dev.nesWrite(0x8000, 0x01);
      await dev.nesWrite(0x8001, (b * 2 + 1) << 1);  // 2KB at PPU $0800
      const chunk = await dumpMemory(dev, NESPPU_1KB, 0x00, 4, frac => {
        onProgress?.({ part: 1, totalParts, progress: (b + frac) / numChrIter });
      });
      chrChunks.push(chunk);
    }
    onProgress?.({ part: 1, totalParts, progress: 1 });
  }

  await dev.io(IO_RESET);
  log(`Complete. PRG: ${prgKB} KB, CHR: ${chrKB} KB.`);
  return assembleNes(4, prgKB, chrKB, mirroring, prgChunks, chrChunks, opts);
}

// ── Mapper 34: BxROM ─────────────────────────────────────────────────────────

/**
 * Dump a BxROM/BNROM (Mapper 34, CHR-RAM variant) cartridge.
 *
 * PRG: 32 KB banks at $8000-$FFFF.
 *   Bank switching requires a bus-conflict-safe write: the bank table
 *   [0, 1, ..., N-1] is located dynamically (mirrors bnrom.lua TODO and
 *   unrom.lua find_banktable()), then bank `b` is selected by writing `b`
 *   to `banktableBase + b` where ROM[banktableBase + b] === b.
 * CHR: CHR-RAM only (no CHR-ROM to dump).
 *
 * Mirrors bnrom.lua dump_prgrom().
 */
export async function dumpBxRom(usbDevice, opts = {}, onProgress, onLog) {
  const { prgKB = 128, mirroring = 'VERT' } = opts;
  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (msg => console.log('[bxrom]', msg));

  log('Initializing NES I/O…');
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  const numBanks = prgKB / 32;

  // Find the bank table for bus-conflict-safe bank switching.
  // For BNROM, the bank table [0, 1, ..., numBanks-1] must be present in every
  // bank at the same offset (required by the mapper's bankswitching scheme).
  // The Lua bnrom.lua hardcodes $FF94 for Lizard; we detect it dynamically.
  log('Scanning visible bank for bank table…');
  const banktableBase = await findBankTable(dev, numBanks, log);

  log(`Dumping PRG-ROM (${prgKB} KB, BxROM mapper 34)…`);
  const prgChunks = [];
  for (let b = 0; b < numBanks; b++) {
    const switchAddr = banktableBase !== null ? banktableBase + b : 0x8000;
    await dev.nesWrite(switchAddr, b);
    const chunk = await dumpMemory(dev, NESCPU_4KB, 0x08, 32, frac => {
      onProgress?.({ part: 0, totalParts: 1, progress: (b + frac) / numBanks });
    });
    prgChunks.push(chunk);
  }
  onProgress?.({ part: 0, totalParts: 1, progress: 1 });

  await dev.io(IO_RESET);
  log(`Complete. PRG: ${prgKB} KB, CHR: 0 KB (CHR-RAM).`);
  return assembleNes(34, prgKB, 0, mirroring, prgChunks, [], opts);
}

// ── Mapper 69: FME7 ──────────────────────────────────────────────────────────

/**
 * Dump an FME7 (Mapper 69) cartridge.
 *
 * PRG: 16 KB per read through reg9 ($8000) + regA ($A000) in the $8000-$BFFF window.
 * CHR: 2 KB per read through reg0+reg1 in the PPU $0000-$07FF window (1 KB each).
 *
 * Mirrors fme7.lua init_mapper() / dump_prgrom() / dump_chrrom().
 */
export async function dumpFme7(usbDevice, opts = {}, onProgress, onLog) {
  const { prgKB = 256, chrKB = 128, mirroring = 'VERT' } = opts;
  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (msg => console.log('[fme7]', msg));
  const totalParts = chrKB > 0 ? 2 : 1;

  log('Initializing NES I/O…');
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  // FME7 init (minimal — mirrors relevant parts of init_mapper in fme7.lua):
  // Disable WRAM, map ROM bank 0 to $6000
  await dev.nesWrite(0x8000, 0x08);
  await dev.nesWrite(0xA000, 0x00);
  // Vertical mirroring
  await dev.nesWrite(0x8000, 0x0C);
  await dev.nesWrite(0xA000, 0x00);
  // Set initial PRG banks: reg9=$8000, regA=$A000, regB=$C000
  await dev.nesWrite(0x8000, 0x09); await dev.nesWrite(0xA000, 0x00);
  await dev.nesWrite(0x8000, 0x0A); await dev.nesWrite(0xA000, 0x01);
  await dev.nesWrite(0x8000, 0x0B); await dev.nesWrite(0xA000, 0x02);
  // Leave $8000 pointing at IRQ reg so $A000 writes don't disturb PRG banking
  await dev.nesWrite(0x8000, 0x0E);

  // PRG: 16 KB per iter — reg9 (8KB $8000) + regA (8KB $A000)
  log(`Dumping PRG-ROM (${prgKB} KB, ${prgKB / 16} × 16 KB)…`);
  const prgChunks = [];
  const numPrgIter = prgKB / 16;
  for (let b = 0; b < numPrgIter; b++) {
    await dev.nesWrite(0x8000, 0x09); await dev.nesWrite(0xA000, b * 2);
    await dev.nesWrite(0x8000, 0x0A); await dev.nesWrite(0xA000, b * 2 + 1);
    const chunk = await dumpMemory(dev, NESCPU_4KB, 0x08, 16, frac => {
      onProgress?.({ part: 0, totalParts, progress: (b + frac) / numPrgIter });
    });
    prgChunks.push(chunk);
  }
  onProgress?.({ part: 0, totalParts, progress: 1 });

  // CHR: 2 KB per iter — reg0 (1KB at PPU $0000) + reg1 (1KB at PPU $0400)
  const chrChunks = [];
  if (chrKB > 0) {
    log(`Dumping CHR-ROM (${chrKB} KB, ${chrKB / 2} × 2 KB)…`);
    const numChrIter = chrKB / 2;
    for (let b = 0; b < numChrIter; b++) {
      await dev.nesWrite(0x8000, 0x00); await dev.nesWrite(0xA000, b * 2);
      await dev.nesWrite(0x8000, 0x01); await dev.nesWrite(0xA000, b * 2 + 1);
      const chunk = await dumpMemory(dev, NESPPU_1KB, 0x00, 2, frac => {
        onProgress?.({ part: 1, totalParts, progress: (b + frac) / numChrIter });
      });
      chrChunks.push(chunk);
    }
    onProgress?.({ part: 1, totalParts, progress: 1 });
  }

  await dev.io(IO_RESET);
  log(`Complete. PRG: ${prgKB} KB, CHR: ${chrKB} KB.`);
  return assembleNes(69, prgKB, chrKB, mirroring, prgChunks, chrChunks, opts);
}

// ── Mapper 9: MMC2 ───────────────────────────────────────────────────────────

/**
 * Dump an MMC2 (Mapper 9) cartridge.
 *
 * PRG: 8 KB banks at $8000-$9FFF — write bank# to $A000.
 *      All banks (including those fixed at $A000-$FFFF) are read through the
 *      $8000 window by iterating all bank values.
 * CHR: 8 KB per read (two 4 KB halves).  Both latch registers for each half
 *      are written to the same value to prevent mid-read latch switches at
 *      the $0FD8/$0FE8 and $1FD8/$1FE8 PPU fetch addresses.
 *
 * Mirrors mmc2.lua dump_prgrom() / dump_chrrom().
 */
export async function dumpMmc2(usbDevice, opts = {}, onProgress, onLog) {
  const { prgKB = 128, chrKB = 128, mirroring = 'VERT' } = opts;
  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (msg => console.log('[mmc2]', msg));
  const totalParts = chrKB > 0 ? 2 : 1;

  log('Initializing NES I/O…');
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  // MMC2 init: set mirroring to vert ($F000 bit0 = 0)
  await dev.nesWrite(0xF000, 0x00);

  // PRG: 8 KB per iter via NESCPU_PAGE base 0x80 ($8000-$9FFF window)
  log(`Dumping PRG-ROM (${prgKB} KB, ${prgKB / 8} × 8 KB)…`);
  const prgChunks = [];
  const numPrgBanks = prgKB / 8;
  for (let b = 0; b < numPrgBanks; b++) {
    await dev.nesWrite(0xA000, b);  // select 8KB bank at $8000-$9FFF
    const chunk = await dumpMemory(dev, NESCPU_PAGE, 0x80, 8, frac => {
      onProgress?.({ part: 0, totalParts, progress: (b + frac) / numPrgBanks });
    });
    prgChunks.push(chunk);
  }
  onProgress?.({ part: 0, totalParts, progress: 1 });

  // CHR: 8 KB per iter — set both $0FD8 latches and both $1FD8 latches to same value
  const chrChunks = [];
  if (chrKB > 0) {
    log(`Dumping CHR-ROM (${chrKB} KB, ${chrKB / 8} × 8 KB)…`);
    const numChrBanks = chrKB / 8;
    for (let b = 0; b < numChrBanks; b++) {
      // Set both latches for lower 4KB to same bank (prevents latch switch during read)
      await dev.nesWrite(0xB000, b * 2);    // $0FD8 latch
      await dev.nesWrite(0xC000, b * 2);    // $0FE8 latch
      // Set both latches for upper 4KB to same bank
      await dev.nesWrite(0xD000, b * 2 + 1);  // $1FD8 latch
      await dev.nesWrite(0xE000, b * 2 + 1);  // $1FE8 latch
      const chunk = await dumpMemory(dev, NESPPU_PAGE, 0x00, 8, frac => {
        onProgress?.({ part: 1, totalParts, progress: (b + frac) / numChrBanks });
      });
      chrChunks.push(chunk);
    }
    onProgress?.({ part: 1, totalParts, progress: 1 });
  }

  await dev.io(IO_RESET);
  log(`Complete. PRG: ${prgKB} KB, CHR: ${chrKB} KB.`);
  return assembleNes(9, prgKB, chrKB, mirroring, prgChunks, chrChunks, opts);
}

// ── Mapper 10: MMC4 ──────────────────────────────────────────────────────────

/**
 * Dump an MMC4 (Mapper 10) cartridge.
 *
 * Like MMC2 but PRG banks are 16 KB (not 8 KB).
 * CHR banking is identical to MMC2 (8 KB with dual latches).
 *
 * Mirrors mmc4.lua dump_prgrom() / dump_chrrom().
 */
export async function dumpMmc4(usbDevice, opts = {}, onProgress, onLog) {
  const { prgKB = 256, chrKB = 128, mirroring = 'VERT' } = opts;
  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (msg => console.log('[mmc4]', msg));
  const totalParts = chrKB > 0 ? 2 : 1;

  log('Initializing NES I/O…');
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  // MMC4 init: set mirroring to vert ($F000 bit0 = 0)
  await dev.nesWrite(0xF000, 0x00);

  // PRG: 16 KB per iter via NESCPU_PAGE base 0x80 ($8000-$BFFF window)
  log(`Dumping PRG-ROM (${prgKB} KB, ${prgKB / 16} × 16 KB)…`);
  const prgChunks = [];
  const numPrgBanks = prgKB / 16;
  for (let b = 0; b < numPrgBanks; b++) {
    await dev.nesWrite(0xA000, b);  // select 16KB bank at $8000-$BFFF
    const chunk = await dumpMemory(dev, NESCPU_PAGE, 0x80, 16, frac => {
      onProgress?.({ part: 0, totalParts, progress: (b + frac) / numPrgBanks });
    });
    prgChunks.push(chunk);
  }
  onProgress?.({ part: 0, totalParts, progress: 1 });

  // CHR: identical to MMC2 (8 KB, dual latch per 4KB half)
  const chrChunks = [];
  if (chrKB > 0) {
    log(`Dumping CHR-ROM (${chrKB} KB, ${chrKB / 8} × 8 KB)…`);
    const numChrBanks = chrKB / 8;
    for (let b = 0; b < numChrBanks; b++) {
      await dev.nesWrite(0xB000, b * 2);
      await dev.nesWrite(0xC000, b * 2);
      await dev.nesWrite(0xD000, b * 2 + 1);
      await dev.nesWrite(0xE000, b * 2 + 1);
      const chunk = await dumpMemory(dev, NESPPU_PAGE, 0x00, 8, frac => {
        onProgress?.({ part: 1, totalParts, progress: (b + frac) / numChrBanks });
      });
      chrChunks.push(chunk);
    }
    onProgress?.({ part: 1, totalParts, progress: 1 });
  }

  await dev.io(IO_RESET);
  log(`Complete. PRG: ${prgKB} KB, CHR: ${chrKB} KB.`);
  return assembleNes(10, prgKB, chrKB, mirroring, prgChunks, chrChunks, opts);
}

// ── Mapper 5: MMC5 ───────────────────────────────────────────────────────────

/**
 * Dump an MMC5 (Mapper 5) cartridge.
 *
 * PRG: 8 KB banks at $8000-$9FFF (mode 3, register $5114, bit7 must be set = ROM).
 * CHR: 8 KB banks via PPU $0000-$1FFF (mode 0, $5127 for sprites + $512B for BG).
 *
 * Mirrors mmc5.lua init_mapper() / dump_prgrom() / dump_chrrom().
 */
export async function dumpMmc5(usbDevice, opts = {}, onProgress, onLog) {
  const { prgKB = 512, chrKB = 256, mirroring = 'VERT' } = opts;
  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (msg => console.log('[mmc5]', msg));
  const totalParts = chrKB > 0 ? 2 : 1;

  log('Initializing NES I/O…');
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  // MMC5 init (mirrors init_mapper in mmc5.lua):
  await dev.nesWrite(0x5102, 0x01);  // WRAM protect bits (deny writes)
  await dev.nesWrite(0x5103, 0x02);
  await dev.nesWrite(0x5105, 0x44);  // vertical mirroring
  await dev.nesWrite(0x5100, 0x03);  // PRG banking mode 3: four independent 8KB windows
  await dev.nesWrite(0x5101, 0x00);  // CHR banking mode 0: single 8KB bank
  await dev.nesWrite(0x5113, 0x00);  // PRG-RAM bank at $6000
  // Init PRG windows to banks 0-3 (bit7 = ROM flag)
  await dev.nesWrite(0x5114, 0x80);
  await dev.nesWrite(0x5115, 0x81);
  await dev.nesWrite(0x5116, 0x82);
  await dev.nesWrite(0x5117, 0x83);
  // Init CHR registers
  await dev.nesWrite(0x5127, 0x00);
  await dev.nesWrite(0x512B, 0x00);

  // PRG: 8 KB per iter via NESCPU_PAGE base 0x80 ($8000-$9FFF window via $5114)
  log(`Dumping PRG-ROM (${prgKB} KB, ${prgKB / 8} × 8 KB)…`);
  const prgChunks = [];
  const numPrgBanks = prgKB / 8;
  for (let b = 0; b < numPrgBanks; b++) {
    await dev.nesWrite(0x5114, b | 0x80);  // bit7 must be set to select ROM (not RAM)
    const chunk = await dumpMemory(dev, NESCPU_PAGE, 0x80, 8, frac => {
      onProgress?.({ part: 0, totalParts, progress: (b + frac) / numPrgBanks });
    });
    prgChunks.push(chunk);
  }
  onProgress?.({ part: 0, totalParts, progress: 1 });

  // CHR: 8 KB per iter via NESPPU_PAGE base 0x00, both sprite and BG registers set
  const chrChunks = [];
  if (chrKB > 0) {
    log(`Dumping CHR-ROM (${chrKB} KB, ${chrKB / 8} × 8 KB)…`);
    const numChrBanks = chrKB / 8;
    for (let b = 0; b < numChrBanks; b++) {
      await dev.nesWrite(0x5127, b);  // sprite CHR bank @ $0000-$1FFF
      await dev.nesWrite(0x512B, b);  // BG CHR bank @ $0000-$1FFF (mode0 8x16)
      const chunk = await dumpMemory(dev, NESPPU_PAGE, 0x00, 8, frac => {
        onProgress?.({ part: 1, totalParts, progress: (b + frac) / numChrBanks });
      });
      chrChunks.push(chunk);
    }
    onProgress?.({ part: 1, totalParts, progress: 1 });
  }

  await dev.io(IO_RESET);
  log(`Complete. PRG: ${prgKB} KB, CHR: ${chrKB} KB.`);
  return assembleNes(5, prgKB, chrKB, mirroring, prgChunks, chrChunks, opts);
}

// ── Mapper 34: NINA-001 ───────────────────────────────────────────────────────

/**
 * Dump a NINA-001 (Mapper 34, CHR-ROM variant) cartridge.
 *
 * Registers (all in $6000-$7FFF, write via CPU):
 *   $7FFD — PRG bank (32 KB at $8000-$FFFF)
 *   $7FFE — CHR 4 KB bank at PPU $0000-$0FFF
 *   $7FFF — CHR 4 KB bank at PPU $1000-$1FFF
 *
 * Unlike BNROM ($8000 register, CHR-RAM), NINA-001 selects banks through
 * writes to the $7FFx range and supports CHR-ROM.
 *
 * NESdev reference: https://www.nesdev.org/wiki/INES_Mapper_034
 */
export async function dumpNina001(usbDevice, opts = {}, onProgress, onLog) {
  const { prgKB = 64, chrKB = 32, mirroring = 'VERT' } = opts;
  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (msg => console.log('[nina001]', msg));
  const totalParts = chrKB > 0 ? 2 : 1;

  log('Initializing NES I/O…');
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  // PRG: 32 KB per iter — write bank# to $7FFD, read $8000-$FFFF
  log(`Dumping PRG-ROM (${prgKB} KB, ${prgKB / 32} × 32 KB)…`);
  const prgChunks = [];
  const numPrgBanks = prgKB / 32;
  for (let b = 0; b < numPrgBanks; b++) {
    await dev.nesWrite(0x7FFD, b);
    const chunk = await dumpMemory(dev, NESCPU_4KB, 0x08, 32, frac => {
      onProgress?.({ part: 0, totalParts, progress: (b + frac) / numPrgBanks });
    });
    prgChunks.push(chunk);
  }
  onProgress?.({ part: 0, totalParts, progress: 1 });

  // CHR: 8 KB per iter (two independent 4 KB halves)
  // $7FFE selects 4 KB bank at PPU $0000; $7FFF selects 4 KB bank at PPU $1000
  const chrChunks = [];
  if (chrKB > 0) {
    log(`Dumping CHR-ROM (${chrKB} KB, ${chrKB / 8} × 8 KB)…`);
    const numChrBanks = chrKB / 8;
    for (let b = 0; b < numChrBanks; b++) {
      await dev.nesWrite(0x7FFE, b * 2);      // 4 KB at PPU $0000
      await dev.nesWrite(0x7FFF, b * 2 + 1);  // 4 KB at PPU $1000
      const chunk = await dumpMemory(dev, NESPPU_1KB, 0x00, 8, frac => {
        onProgress?.({ part: 1, totalParts, progress: (b + frac) / numChrBanks });
      });
      chrChunks.push(chunk);
    }
    onProgress?.({ part: 1, totalParts, progress: 1 });
  }

  await dev.io(IO_RESET);
  log(`Complete. PRG: ${prgKB} KB, CHR: ${chrKB} KB.`);
  return assembleNes(34, prgKB, chrKB, mirroring, prgChunks, chrChunks, opts);
}

// ── Mapper 24 / 26: VRC6 ─────────────────────────────────────────────────────

/**
 * Dump a VRC6 (Konami) cartridge.
 *
 * Two hardware variants share the same ASIC but differ in how A0/A1 are wired:
 *   VRC6a (Mapper 24) — standard A0/A1 wiring
 *   VRC6b (Mapper 26) — A0 and A1 swapped on the PCB
 *
 * PRG layout:
 *   $8000-$BFFF — 16 KB switchable (register $8000, bits 3-0 = bank number)
 *   $C000-$DFFF —  8 KB switchable (register $C000, bits 3-0 = bank number)
 *   $E000-$FFFF — fixed last 8 KB (hardwired, not selectable)
 *
 *   The fixed $E000 window duplicates the upper 8 KB of the last 16 KB bank,
 *   so iterating all 16 KB banks through the $8000 window covers all PRG data.
 *
 * CHR layout — eight independent 1 KB banks at PPU $0000-$1FFF:
 *   VRC6a: banks 0-3 via $D000-$D003; banks 4-7 via $E000-$E003.
 *   VRC6b: A0/A1 swap causes $D001↔$D002 and $E001↔$E002 to exchange roles.
 *
 * Mirrors host/scripts/nes/ (no existing Lua script — implemented from
 * NESdev wiki register documentation).
 */
async function dumpVrc6Impl(usbDevice, opts, onProgress, onLog) {
  const { prgKB = 256, chrKB = 128, mirroring = 'VERT', variant = 'a' } = opts;
  const mapperNum = variant === 'b' ? 26 : 24;
  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (msg => console.log('[vrc6]', msg));
  const totalParts = chrKB > 0 ? 2 : 1;

  // CHR bank register addresses differ between variants due to A0/A1 PCB swap.
  // Registers for banks 0-7 (each selects one 1 KB CHR bank):
  //   VRC6a: $D000 $D001 $D002 $D003  $E000 $E001 $E002 $E003
  //   VRC6b: $D000 $D002 $D001 $D003  $E000 $E002 $E001 $E003
  // ($D000, $D003, $E000, $E003 have A0=A1 or A0=A1=1 so the swap is a no-op.)
  const chrRegs = variant === 'b'
    ? [0xD000, 0xD002, 0xD001, 0xD003, 0xE000, 0xE002, 0xE001, 0xE003]
    : [0xD000, 0xD001, 0xD002, 0xD003, 0xE000, 0xE001, 0xE002, 0xE003];

  log('Initializing NES I/O…');
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  // Mirroring register $B003 — bits 3-2: 00=vertical, 01=horizontal.
  // $B003 address is variant-independent (A0=A1=1; swapping is a no-op).
  // Bit 7 = 0 keeps standard 1 KB CHR banking active.
  await dev.nesWrite(0xB003, mirroring === 'VERT' ? 0x00 : 0x04);

  // PRG bank registers to known state.
  // $8000 and $C000 are also variant-independent (A0=A1=0).
  await dev.nesWrite(0x8000, 0x00);
  await dev.nesWrite(0xC000, 0x00);

  // CHR bank registers to bank 0.
  for (const reg of chrRegs) await dev.nesWrite(reg, 0x00);

  // PRG: 16 KB per iteration via the $8000 window ($8000-$BFFF).
  // Writing bank b to $8000 maps physical 16 KB bank b to $8000-$BFFF.
  // The fixed $E000-$FFFF is the upper 8 KB of the last 16 KB bank, already
  // covered by the final iteration, so no separate read is needed.
  log(`Dumping PRG-ROM (${prgKB} KB, ${prgKB / 16} × 16 KB)…`);
  const prgChunks = [];
  const numPrgBanks = prgKB / 16;
  for (let b = 0; b < numPrgBanks; b++) {
    await dev.nesWrite(0x8000, b);
    const chunk = await dumpMemory(dev, NESCPU_4KB, 0x08, 16, frac => {
      onProgress?.({ part: 0, totalParts, progress: (b + frac) / numPrgBanks });
    });
    prgChunks.push(chunk);
  }
  onProgress?.({ part: 0, totalParts, progress: 1 });

  // CHR: 8 KB per iteration — load 8 consecutive 1 KB banks into the eight
  // CHR registers, then read 8 KB byte-by-byte via NES_PPU_RD.
  // Burst reads (NESPPU_PAGE) rely on usbPoll() for inter-byte timing; on
  // the STM32 with hardware USB, usbPoll() returns too quickly for vintage
  // Famicom mask ROMs.  The single-byte nes_ppu_rd() path uses 4 explicit
  // NOPs (~84 ns) before latching data and is reliable on all hardware.
  const chrChunks = [];
  if (chrKB > 0) {
    log(`Dumping CHR-ROM (${chrKB} KB, ${chrKB / 8} × 8 KB) — byte-by-byte mode…`);
    const numChrBanks = chrKB / 8;
    for (let b = 0; b < numChrBanks; b++) {
      for (let i = 0; i < 8; i++) {
        await dev.nesWrite(chrRegs[i], b * 8 + i);
      }
      const chunk = new Uint8Array(8192);
      for (let addr = 0; addr < 8192; addr++) {
        chunk[addr] = await dev.nesRead(NES_PPU_RD, addr);
        if ((addr & 0xFF) === 0xFF) {
          onProgress?.({ part: 1, totalParts, progress: (b + (addr + 1) / 8192) / numChrBanks });
        }
      }
      chrChunks.push(chunk);
    }
    onProgress?.({ part: 1, totalParts, progress: 1 });
  }

  await dev.io(IO_RESET);
  log(`Complete. PRG: ${prgKB} KB, CHR: ${chrKB} KB.`);
  return assembleNes(mapperNum, prgKB, chrKB, mirroring, prgChunks, chrChunks, opts);
}

export const dumpVrc6a = (usb, opts, prog, log) =>
  dumpVrc6Impl(usb, { ...opts, variant: 'a' }, prog, log);

export const dumpVrc6b = (usb, opts, prog, log) =>
  dumpVrc6Impl(usb, { ...opts, variant: 'b' }, prog, log);

// ── INL Mapper 111: GTROM ────────────────────────────────────────────────────

/**
 * Dump a GTROM (INL Mapper 111) cartridge.
 *
 * PRG: 32 KB switchable banks at $8000-$FFFF.
 *   Bank select: write bank# to $5000 (no bus conflicts — GTROM has its own
 *   mapper register separate from PRG-ROM, so no bus-conflict-safe write needed).
 * CHR: CHR-RAM only (no CHR-ROM to dump).
 *
 * Mirrors gtrom.lua dump_prgrom().
 */
export async function dumpGtrom(usbDevice, opts = {}, onProgress, onLog) {
  const { prgKB = 512, mirroring = 'VERT' } = opts;
  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (msg => console.log('[gtrom]', msg));
  const numBanks = prgKB / 32;

  log('Initializing NES I/O…');
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  log(`Dumping GTROM PRG-ROM (${prgKB} KB, ${numBanks} × 32 KB banks)…`);
  const prgChunks = [];
  for (let b = 0; b < numBanks; b++) {
    await dev.nesWrite(0x5000, b);  // bank select at $5000 (no bus conflicts)
    const chunk = await dumpMemory(dev, NESCPU_PAGE, 0x80, 32, frac => {
      onProgress?.({ part: 0, totalParts: 1, progress: (b + frac) / numBanks });
    });
    prgChunks.push(chunk);
  }
  onProgress?.({ part: 0, totalParts: 1, progress: 1 });

  await dev.io(IO_RESET);
  log(`Complete. PRG: ${prgKB} KB, CHR: 0 KB (CHR-RAM).`);
  return assembleNes(111, prgKB, 0, mirroring, prgChunks, [], opts);
}
