/**
 * nes-flash.js — NES/FC mapper-specific flash-write orchestration.
 *
 * Mirrors the flash_prgrom / flash_chrrom functions in:
 *   host/scripts/nes/nrom.lua
 *   host/scripts/nes/mmc1.lua
 *   host/scripts/nes/mmc3.lua
 *
 * Each exported flashXxx function takes a raw USBDevice (same as dump fns),
 * creates an InlRetroDevice internally, performs IO_RESET + NES_INIT, runs
 * erase + programming, and calls IO_RESET on exit.
 *
 * NES ROM image layout (.nes / iNES format):
 *   bytes 0–15  : 16-byte iNES header
 *   bytes 16…   : PRG-ROM  (prgKB × 1024 bytes)
 *   bytes 16+PRG…: CHR-ROM  (chrKB × 1024 bytes)
 *
 * Exported:
 *   flashNrom(usbDevice, romBytes, opts, onProgress, log)
 *   flashMmc1(usbDevice, romBytes, opts, onProgress, log)
 *   flashMmc3(usbDevice, romBytes, opts, onProgress, log)
 *   flashGtrom(usbDevice, romBytes, opts, onProgress, log)
 *   nesMapperSupportsFlash(mapper) → bool
 *   MAPPER_FLASH_FN  — dispatch table
 */

import { InlRetroDevice, IO_RESET, NES_INIT, PRGROM, CHRROM, MMC1_MAPPER, MMC3_MAPPER, NROM, GTROM_MAPPER } from './dict.js';
import { eraseNesPrg, eraseNesChr, eraseGtrom } from './erase.js';
import { flashStream } from './flash.js';

/** Return 16 if romBytes starts with the iNES magic ('NES\x1A'), otherwise 0. */
function nesHeaderOffset(romBytes) {
  return (romBytes[0] === 0x4E && romBytes[1] === 0x45 &&
          romBytes[2] === 0x53 && romBytes[3] === 0x1A) ? 16 : 0;
}

// ── NROM (Mapper 0) ───────────────────────────────────────────────────────────
/**
 * Flash a NROM cart (fixed PRG + optional CHR-ROM).
 * No bank switching needed; the firmware handles the fixed $8000–$FFFF window.
 *
 * @param {USBDevice}  usbDevice
 * @param {Uint8Array} romBytes  — complete .nes image (with 16-byte iNES header)
 * @param {{ prgKB: number, chrKB: number }} opts
 * @param {function({part,totalParts,progress}):void} onProgress
 * @param {function(string):void} log
 */
export async function flashNrom(usbDevice, romBytes, opts, onProgress, log) {
  const { prgKB = 32, chrKB = 8 } = opts;
  const totalParts = chrKB > 0 ? 2 : 1;
  const hdr = nesHeaderOffset(romBytes);

  const dev = new InlRetroDevice(usbDevice);
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  await eraseNesPrg(dev, log);
  if (chrKB > 0) await eraseNesChr(dev, log);

  log(`Programming NROM PRG-ROM (${prgKB} KB)…`);
  await flashStream(
    dev, romBytes, NROM, PRGROM,
    hdr, prgKB,
    p => onProgress({ part: 0, totalParts, progress: p }),
  );
  log('PRG-ROM programmed.');

  if (chrKB > 0) {
    log(`Programming NROM CHR-ROM (${chrKB} KB)…`);
    await flashStream(
      dev, romBytes, NROM, CHRROM,
      hdr + prgKB * 1024, chrKB,
      p => onProgress({ part: 1, totalParts, progress: p }),
    );
    log('CHR-ROM programmed.');
  }

  await dev.io(IO_RESET);
}

// ── MMC1 (Mapper 1) ───────────────────────────────────────────────────────────
/**
 * Flash an MMC1 cart.
 *
 * PRG banks: 32 KB each, selected via MMC1 PRG register at $E000.
 * CHR banks: 4 KB each, selected via MMC1 CHR register at $A000 / $C000.
 *
 * MMC1 init: write 0x80 to $8000 (shift-register reset), then set control
 * register ($8000) to mode 3 (fix last PRG bank, switch first).
 *
 * @param {USBDevice}  usbDevice
 * @param {Uint8Array} romBytes
 * @param {{ prgKB: number, chrKB: number }} opts
 * @param {function({part,totalParts,progress}):void} onProgress
 * @param {function(string):void} log
 */
export async function flashMmc1(usbDevice, romBytes, opts, onProgress, log) {
  const { prgKB = 256, chrKB = 0 } = opts;
  const prgBankKB   = 32;
  const chrBankKB   = 4;
  const numPrgBanks = prgKB  / prgBankKB;
  const numChrBanks = chrKB  / chrBankKB;
  const totalParts  = (numPrgBanks > 0 ? 1 : 0) + (numChrBanks > 0 ? 1 : 0);
  let   partIdx     = 0;
  const hdr = nesHeaderOffset(romBytes);

  const dev = new InlRetroDevice(usbDevice);
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  await eraseNesPrg(dev, log);
  if (chrKB > 0) await eraseNesChr(dev, log);

  // MMC1 init: reset shift register
  await dev.nesMmc1Write(0x8000, 0x80);
  // Control register: CHR mode=0 (8KB), PRG mode=3 (fix last, switch first)
  await dev.nesMmc1Write(0x8000, 0x1F);

  // ── PRG banks ──
  if (numPrgBanks > 0) {
    log(`Programming MMC1 PRG-ROM (${prgKB} KB, ${numPrgBanks} × ${prgBankKB} KB banks)…`);
    const myPart = partIdx++;
    for (let bank = 0; bank < numPrgBanks; bank++) {
      await dev.nesMmc1Write(0xE000, bank);  // select PRG bank at $8000
      await flashStream(
        dev, romBytes, MMC1_MAPPER, PRGROM,
        hdr + bank * prgBankKB * 1024, prgBankKB,
        p => onProgress({ part: myPart, totalParts, progress: (bank + p) / numPrgBanks }),
      );
      log(`  PRG bank ${bank + 1}/${numPrgBanks} done.`);
    }
    log('MMC1 PRG-ROM programmed.');
  }

  // ── CHR banks ──
  if (numChrBanks > 0) {
    log(`Programming MMC1 CHR-ROM (${chrKB} KB, ${numChrBanks} × ${chrBankKB} KB banks)…`);
    const myPart = partIdx++;
    const chrOffset = hdr + prgKB * 1024;
    for (let bank = 0; bank < numChrBanks; bank++) {
      await dev.nesMmc1Write(0xA000, bank);  // select CHR bank 0 (4KB mode)
      await flashStream(
        dev, romBytes, MMC1_MAPPER, CHRROM,
        chrOffset + bank * chrBankKB * 1024, chrBankKB,
        p => onProgress({ part: myPart, totalParts, progress: (bank + p) / numChrBanks }),
      );
      log(`  CHR bank ${bank + 1}/${numChrBanks} done.`);
    }
    log('MMC1 CHR-ROM programmed.');
  }

  await dev.io(IO_RESET);
}

// ── MMC3 (Mapper 4) ───────────────────────────────────────────────────────────
/**
 * Flash an MMC3 cart.
 *
 * PRG banks: 8 KB each.  MMC3 command at $8000, data at $8001.
 *   Write 0x06 to $8000, then bank# to $8001 → maps bank to $8000–$9FFF.
 *
 * The last two 8 KB banks ($C000–$FFFF) are fixed; they are programmed last
 * to avoid overwriting live code while the mapper is still running.
 *
 * @param {USBDevice}  usbDevice
 * @param {Uint8Array} romBytes
 * @param {{ prgKB: number, chrKB: number }} opts
 * @param {function({part,totalParts,progress}):void} onProgress
 * @param {function(string):void} log
 */
export async function flashMmc3(usbDevice, romBytes, opts, onProgress, log) {
  const { prgKB = 512, chrKB = 0 } = opts;
  const prgBankKB = 8;
  const numBanks  = prgKB / prgBankKB;
  const hdr = nesHeaderOffset(romBytes);

  const dev = new InlRetroDevice(usbDevice);
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  await eraseNesPrg(dev, log);

  // Init: map bank 0 → $8000, bank 1 → $A000 (safe starting state)
  await dev.nesWrite(0x8000, 0x06);
  await dev.nesWrite(0x8001, 0x00);
  await dev.nesWrite(0x8000, 0x07);
  await dev.nesWrite(0x8001, 0x01);

  log(`Programming MMC3 PRG-ROM (${prgKB} KB, ${numBanks} × ${prgBankKB} KB banks)…`);
  for (let bank = 0; bank < numBanks; bank++) {
    // Select bank into the $8000–$9FFF window via register 6
    await dev.nesWrite(0x8000, 0x06);
    await dev.nesWrite(0x8001, bank);

    await flashStream(
      dev, romBytes, MMC3_MAPPER, PRGROM,
      hdr + bank * prgBankKB * 1024, prgBankKB,
      p => onProgress({ part: 0, totalParts: 1, progress: (bank + p) / numBanks }),
    );
    if ((bank + 1) % 8 === 0) log(`  Bank ${bank + 1}/${numBanks}…`);
  }
  log('MMC3 PRG-ROM programmed.');

  await dev.io(IO_RESET);
}

// ── GTROM (INL Mapper 111) ────────────────────────────────────────────────────
/**
 * Flash a GTROM cart.
 *
 * GTROM is INL's own flash-cart mapper.  It has no bus conflicts, so the bank
 * select register at $5000 and the flash unlock addresses can be written with
 * a standard NES_CPU_WR.  Unlock addresses in CPU space: $D555 / $AAAA
 * (corresponding to flash chip addresses 0x5555 / 0x2AAA).
 *
 * PRG banks are 32 KB each, selected by writing the bank number to $5000.
 * The firmware also needs SET_CUR_BANK() so its buffer-flash pipeline tracks
 * which bank is currently mapped.
 *
 * GTROM has CHR-RAM only; there is no CHR-ROM to flash.
 *
 * Mirrors host/scripts/nes/gtrom.lua flash_prgrom().
 *
 * @param {USBDevice}  usbDevice
 * @param {Uint8Array} romBytes   — .nes image (16-byte iNES header + PRG data)
 * @param {{ prgKB: number }} opts
 * @param {function({part,totalParts,progress}):void} onProgress
 * @param {function(string):void} log
 */
export async function flashGtrom(usbDevice, romBytes, opts, onProgress, log) {
  const { prgKB = 512 } = opts;
  const prgBankKB = 32;
  const numBanks  = prgKB / prgBankKB;
  const hdr = nesHeaderOffset(romBytes);

  const dev = new InlRetroDevice(usbDevice);
  await dev.io(IO_RESET);
  await dev.io(NES_INIT);

  await eraseGtrom(dev, log);

  log(`Programming GTROM PRG-ROM (${prgKB} KB, ${numBanks} × ${prgBankKB} KB banks)…`);
  for (let bank = 0; bank < numBanks; bank++) {
    // Select bank in mapper register ($5000) and inform firmware
    await dev.nesWrite(0x5000, bank);
    await dev.nesSetCurBank(bank);

    await flashStream(
      dev, romBytes, GTROM_MAPPER, PRGROM,
      hdr + bank * prgBankKB * 1024, prgBankKB,
      p => onProgress({ part: 0, totalParts: 1, progress: (bank + p) / numBanks }),
    );
    if ((bank + 1) % 4 === 0) log(`  Bank ${bank + 1}/${numBanks}…`);
  }
  log('GTROM PRG-ROM programmed.');

  await dev.io(IO_RESET);
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/** mapper string → flash function */
export const MAPPER_FLASH_FN = {
  nrom:  flashNrom,
  mmc1:  flashMmc1,
  mmc3:  flashMmc3,
  gtrom: flashGtrom,
};

/** Returns true if the given mapper string has a flash implementation. */
export function nesMapperSupportsFlash(mapper) {
  return mapper in MAPPER_FLASH_FN;
}
