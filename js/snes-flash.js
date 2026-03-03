/**
 * snes-flash.js — SNES flash-write orchestration.
 *
 * Supports four chip/board combinations:
 *
 *   5V PLCC (SST 39SF040)  LoROM — per 32 KB bank  (lorom_5volt.lua)
 *   5V PLCC (SST 39SF040)  HiROM — per 64 KB bank
 *   3V TSSOP (SST 39VF040) LoROM — single write_file for full ROM  (v3.lua)
 *   3V TSSOP (SST 39VF040) HiROM — single write_file for full ROM  (v3.lua)
 *
 * For 5V PLCC boards the host must explicitly call SNES_SET_BANK before each
 * bank chunk; the firmware's LOROM_5VOLT / HIROM_5VOLT flash functions write
 * only the 32/64 KB window that is currently mapped.
 *
 * For 3V TSSOP (v3) boards the firmware auto-increments its internal bank
 * pointer; the host sends the full ROM in a single flashStream call.
 *
 * No prgm_mode (RST-pin toggling) is needed for either variant supported here.
 * Older v2 SNES boards do require it, but those are not common in flash-cart
 * builds and are deferred to a future implementation.
 *
 * Exported:
 *   flashSnes(usbDevice, romBytes, opts, onProgress, log)
 *   opts: { sizeKB, mapping, chipType }
 *     sizeKB   — ROM size in KB
 *     mapping  — 'LOROM' | 'HIROM' | 'EXHIROM'
 *     chipType — '5V_PLCC' | '3V_TSSOP'
 */

import {
  InlRetroDevice, IO_RESET, SNES_INIT,
  LOROM_5VOLT, HIROM_5VOLT,
  LOROM_3VOLT, HIROM_3VOLT,
  SNESROM,
} from './dict.js';
import { eraseSnes5v, eraseSnes3v } from './erase.js';
import { flashStream } from './flash.js';

// ── 5V PLCC LoROM ─────────────────────────────────────────────────────────────
/**
 * Flash a SNES 5V PLCC LoROM cart.
 * Each bank is 32 KB; host sets bank before each flashStream call.
 *
 * @param {InlRetroDevice} dev
 * @param {Uint8Array} romBytes
 * @param {number} sizeKB
 * @param {function(number):void} onProgress  0..1
 * @param {function(string):void} log
 */
async function flash5vLoRom(dev, romBytes, sizeKB, onProgress, log) {
  const bankKB    = 32;
  const numBanks  = sizeKB / bankKB;

  await eraseSnes5v(dev, log);

  log(`Programming SNES LoROM 5V PLCC (${sizeKB} KB, ${numBanks} banks)…`);
  for (let bank = 0; bank < numBanks; bank++) {
    await dev.snesSetBank(bank);
    await flashStream(
      dev, romBytes, LOROM_5VOLT, SNESROM,
      bank * bankKB * 1024, bankKB,
      p => onProgress((bank + p) / numBanks),
    );
    if ((bank + 1) % 4 === 0) log(`  Bank ${bank + 1}/${numBanks}…`);
  }
  log('SNES LoROM 5V PLCC programmed.');
}

// ── 5V PLCC HiROM ─────────────────────────────────────────────────────────────
/**
 * Flash a SNES 5V PLCC HiROM cart.
 * Each bank is 64 KB; host sets bank before each flashStream call.
 *
 * @param {InlRetroDevice} dev
 * @param {Uint8Array} romBytes
 * @param {number} sizeKB
 * @param {function(number):void} onProgress
 * @param {function(string):void} log
 */
async function flash5vHiRom(dev, romBytes, sizeKB, onProgress, log) {
  const bankKB   = 64;
  const numBanks = sizeKB / bankKB;

  await eraseSnes5v(dev, log);

  log(`Programming SNES HiROM 5V PLCC (${sizeKB} KB, ${numBanks} banks)…`);
  for (let bank = 0; bank < numBanks; bank++) {
    await dev.snesSetBank(bank);
    await flashStream(
      dev, romBytes, HIROM_5VOLT, SNESROM,
      bank * bankKB * 1024, bankKB,
      p => onProgress((bank + p) / numBanks),
    );
    log(`  Bank ${bank + 1}/${numBanks}…`);
  }
  log('SNES HiROM 5V PLCC programmed.');
}

// ── 3V TSSOP LoROM ────────────────────────────────────────────────────────────
/**
 * Flash a SNES 3V TSSOP LoROM cart (v3 boards).
 * Firmware handles bank auto-increment; host sends the full ROM in one call.
 *
 * @param {InlRetroDevice} dev
 * @param {Uint8Array} romBytes
 * @param {number} sizeKB
 * @param {function(number):void} onProgress
 * @param {function(string):void} log
 */
async function flash3vLoRom(dev, romBytes, sizeKB, onProgress, log) {
  await eraseSnes3v(dev, log);

  log(`Programming SNES LoROM 3V TSSOP (${sizeKB} KB)…`);
  await flashStream(dev, romBytes, LOROM_3VOLT, SNESROM, 0, sizeKB, onProgress);
  log('SNES LoROM 3V TSSOP programmed.');
}

// ── 3V TSSOP HiROM ────────────────────────────────────────────────────────────
/**
 * Flash a SNES 3V TSSOP HiROM cart (v3 boards).
 *
 * @param {InlRetroDevice} dev
 * @param {Uint8Array} romBytes
 * @param {number} sizeKB
 * @param {function(number):void} onProgress
 * @param {function(string):void} log
 */
async function flash3vHiRom(dev, romBytes, sizeKB, onProgress, log) {
  await eraseSnes3v(dev, log);

  log(`Programming SNES HiROM 3V TSSOP (${sizeKB} KB)…`);
  await flashStream(dev, romBytes, HIROM_3VOLT, SNESROM, 0, sizeKB, onProgress);
  log('SNES HiROM 3V TSSOP programmed.');
}

// ── Public dispatcher ─────────────────────────────────────────────────────────

/**
 * Flash a SNES cartridge.
 *
 * @param {USBDevice}  usbDevice
 * @param {Uint8Array} romBytes
 * @param {{ sizeKB: number, mapping: string, chipType: string }} opts
 *   mapping:  'LOROM' | 'HIROM' | 'EXHIROM'
 *   chipType: '5V_PLCC' | '3V_TSSOP'
 * @param {function({part,totalParts,progress}):void} onProgress
 * @param {function(string):void} log
 */
export async function flashSnes(usbDevice, romBytes, opts, onProgress, log) {
  const { sizeKB, mapping = 'LOROM', chipType = '5V_PLCC' } = opts;
  const wrap = p => onProgress({ part: 0, totalParts: 1, progress: p });

  if (mapping === 'EXHIROM') {
    throw new Error('ExHiROM flash is not yet supported (uncommon flash-cart target).');
  }

  const dev = new InlRetroDevice(usbDevice);
  await dev.io(IO_RESET);
  await dev.io(SNES_INIT);

  if (chipType === '5V_PLCC') {
    if (mapping === 'LOROM') {
      await flash5vLoRom(dev, romBytes, sizeKB, wrap, log);
    } else {
      await flash5vHiRom(dev, romBytes, sizeKB, wrap, log);
    }
  } else {
    // 3V_TSSOP
    if (mapping === 'LOROM') {
      await flash3vLoRom(dev, romBytes, sizeKB, wrap, log);
    } else {
      await flash3vHiRom(dev, romBytes, sizeKB, wrap, log);
    }
  }

  await dev.io(IO_RESET);
}
