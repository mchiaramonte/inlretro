/**
 * erase.js — AMD/SST JEDEC chip-erase sequences for NES PRG, NES CHR, and SNES.
 *
 * Mirrors host/scripts/app/erase.lua and the erase sections of the mapper scripts.
 *
 * Chip erase is a 6-write unlock command followed by polling until the target
 * address reads back 0xFF (indicating erase complete).
 *
 * WARNING: Chip erase is irreversible and erases ALL data on the flash chip.
 */

import {
  DICT_NES, NES_CPU_RD, NES_PPU_RD,
  DICT_SNES, SNES_ROM_RD,
} from './dict.js';

// Safety limit for GTROM toggle-bit polls (see eraseGtrom)
const MAX_TOGGLE_POLLS = 10000;

// Safety limit: each poll is a USB round-trip.  Chip erase can take up to ~200ms
// on slow chips; at ~500 polls/s that's ~100 polls minimum.  10 000 gives ~20 s.
const MAX_ERASE_POLLS = 10000;

// ── NES PRG-ROM ───────────────────────────────────────────────────────────────
/**
 * Erase the NES PRG-ROM flash chip.
 *
 * Uses DISCRETE_EXP0_PRGROM_WR (no /ROMSEL assertion) so the unlock addresses
 * 0x5555 / 0x2AAA map directly to the flash chip's A14:A0 bits.
 *
 * Assumes the device is already NES-initialised (IO_RESET + NES_INIT done).
 *
 * @param {InlRetroDevice} dev
 * @param {function(string):void} log
 */
export async function eraseNesPrg(dev, log) {
  log('Erasing PRG-ROM flash (chip erase)…');

  // AMD/SST chip-erase unlock sequence
  await dev.nesExpPrgWrite(0x5555, 0xAA);
  await dev.nesExpPrgWrite(0x2AAA, 0x55);
  await dev.nesExpPrgWrite(0x5555, 0x80);
  await dev.nesExpPrgWrite(0x5555, 0xAA);
  await dev.nesExpPrgWrite(0x2AAA, 0x55);
  await dev.nesExpPrgWrite(0x5555, 0x10);  // chip-erase command

  // Poll $8000 until 0xFF
  let rv, polls = 0;
  do {
    if (++polls > MAX_ERASE_POLLS) throw new Error('PRG erase timeout');
    rv = await dev.nesRead(NES_CPU_RD, 0x8000);
  } while (rv !== 0xFF);

  log(`PRG-ROM erase complete (${polls} polls).`);
}

// ── NES CHR-ROM ───────────────────────────────────────────────────────────────
/**
 * Erase the NES CHR-ROM flash chip.
 *
 * Uses NES_PPU_WR; unlock addresses are 0x1555 / 0x0AAA (PPU bus A13:A0 = A12:A0
 * of the flash chip — A13 is /ROMSEL on the PPU bus and must be 0 for ROM access).
 *
 * @param {InlRetroDevice} dev
 * @param {function(string):void} log
 */
export async function eraseNesChr(dev, log) {
  log('Erasing CHR-ROM flash (chip erase)…');

  await dev.nesPpuWrite(0x1555, 0xAA);
  await dev.nesPpuWrite(0x0AAA, 0x55);
  await dev.nesPpuWrite(0x1555, 0x80);
  await dev.nesPpuWrite(0x1555, 0xAA);
  await dev.nesPpuWrite(0x0AAA, 0x55);
  await dev.nesPpuWrite(0x1555, 0x10);  // chip-erase command

  // Poll PPU $0000 until 0xFF
  let rv, polls = 0;
  do {
    if (++polls > MAX_ERASE_POLLS) throw new Error('CHR erase timeout');
    rv = await dev.nesRead(NES_PPU_RD, 0x0000);
  } while (rv !== 0xFF);

  log(`CHR-ROM erase complete (${polls} polls).`);
}

// ── SNES 5V PLCC (SST 39SF040) ────────────────────────────────────────────────
/**
 * Erase the SNES 5V PLCC flash chip (SST 39SF040 or compatible).
 *
 * Standard AMD/SST addresses 0x5555 / 0x2AAA.  Bank must be set to 0 before calling.
 * Polls SNES_ROM_RD at bank=0 / addr=$8000 until 0xFF.
 *
 * @param {InlRetroDevice} dev
 * @param {function(string):void} log
 */
export async function eraseSnes5v(dev, log) {
  log('Erasing SNES 5V PLCC flash (chip erase)…');

  await dev.snesSetBank(0x00);

  await dev.snesWrite(0x5555, 0xAA);
  await dev.snesWrite(0x2AAA, 0x55);
  await dev.snesWrite(0x5555, 0x80);
  await dev.snesWrite(0x5555, 0xAA);
  await dev.snesWrite(0x2AAA, 0x55);
  await dev.snesWrite(0x5555, 0x10);  // chip-erase command

  // Poll bank=0 / addr=$8000 until 0xFF
  let rv, polls = 0;
  do {
    if (++polls > MAX_ERASE_POLLS) throw new Error('SNES 5V erase timeout');
    rv = await dev.snesRead(0x8000);
  } while (rv !== 0xFF);

  log(`SNES 5V erase complete (${polls} polls).`);
}

// ── SNES 3V TSSOP (SST 39VF040 / v3 board) ───────────────────────────────────
/**
 * Erase the SNES 3V TSSOP flash chip (SST 39VF040 on v3 INL boards).
 *
 * The v3 board's address decoder places the flash unlock addresses at
 * 0x8AAA / 0x8555 (A15=1, A13:A0 = 0x0AAA/0x0555).  No prgm_mode needed.
 *
 * @param {InlRetroDevice} dev
 * @param {function(string):void} log
 */
export async function eraseSnes3v(dev, log) {
  log('Erasing SNES 3V TSSOP flash (chip erase)…');

  await dev.snesSetBank(0x00);

  await dev.snesWrite(0x8AAA, 0xAA);
  await dev.snesWrite(0x8555, 0x55);
  await dev.snesWrite(0x8AAA, 0x80);
  await dev.snesWrite(0x8AAA, 0xAA);
  await dev.snesWrite(0x8555, 0x55);
  await dev.snesWrite(0x8AAA, 0x10);  // chip-erase command

  // Poll bank=0 / addr=$8000 until 0xFF
  let rv, polls = 0;
  do {
    if (++polls > MAX_ERASE_POLLS) throw new Error('SNES 3V erase timeout');
    rv = await dev.snesRead(0x8000);
  } while (rv !== 0xFF);

  log(`SNES 3V erase complete (${polls} polls).`);
}

// ── GTROM (INL Mapper 111) ────────────────────────────────────────────────────
/**
 * Erase the GTROM PRG-ROM flash chip.
 *
 * GTROM has no bus conflicts, so standard NES_CPU_WR is used (not
 * DISCRETE_EXP0_PRGROM_WR).  The unlock addresses differ from the standard
 * NES PRG erase: the GTROM address decoder maps flash addr 0x5555 → CPU $D555
 * and flash addr 0x2AAA → CPU $AAAA.
 *
 * Erase completion is detected via toggle-bit polling: two consecutive reads
 * of $8000 that return the same value indicate the chip has stopped toggling.
 * Mirrors the gtrom.lua erase sequence exactly.
 *
 * @param {InlRetroDevice} dev
 * @param {function(string):void} log
 */
export async function eraseGtrom(dev, log) {
  log('Erasing GTROM flash (chip erase)…');

  // AMD/SST chip-erase unlock via NES_CPU_WR (no bus conflicts on GTROM)
  await dev.nesWrite(0xD555, 0xAA);
  await dev.nesWrite(0xAAAA, 0x55);
  await dev.nesWrite(0xD555, 0x80);
  await dev.nesWrite(0xD555, 0xAA);
  await dev.nesWrite(0xAAAA, 0x55);
  await dev.nesWrite(0xD555, 0x10);  // chip-erase command

  // Toggle-bit completion detection: loop until two consecutive reads agree.
  // While erasing, the flash's DQ6 bit toggles on every read; it stops when done.
  let rv = 0xFF;  // seed value — guaranteed to differ from first erase read
  let polls = 0;
  while (true) {
    const sample = await dev.nesRead(NES_CPU_RD, 0x8000);
    if (sample === rv) break;  // stable — erase complete
    rv = await dev.nesRead(NES_CPU_RD, 0x8000);
    if (++polls > MAX_TOGGLE_POLLS) throw new Error('GTROM erase timeout');
  }

  log(`GTROM erase complete (${polls} toggle-bit polls).`);
}
