/**
 * gba.js — Game Boy Advance cartridge dump logic.
 *
 * Mirrors the behaviour of:
 *   host/scripts/gba/basic.lua
 *
 * The GBA ROM is a flat address space (no in-cartridge bank switching).
 * The device firmware reads via a 24-bit latched address; the ROM
 * auto-increments its internal counter after each word read.  The host
 * must call GBA_LATCH_ADDR before each 128 KB dumpMemory() chunk to
 * keep the firmware and ROM address counters in sync (the Lua comment
 * in basic.lua explains this requirement in detail).
 *
 * Each 128 KB chunk corresponds to A16–A23 = chunk index, A0–A15 = 0.
 * The data bus is 16-bit (2 bytes per address step), so 128 KB of ROM
 * data covers 64 K address steps — the firmware handles this internally.
 *
 * Exported API:
 *   readGbaHeader(dev) → header object
 *   dumpGba(usbDevice, opts, onProgress, onLog) → { rom: Uint8Array, title }
 *
 * opts:
 *   sizeKB {number} — ROM size in KB (required; read from UI dropdown)
 *
 * onProgress({ progress: 0..1 })
 * onLog(message)
 */

import {
  InlRetroDevice,
  IO_RESET, GBA_INIT, GB_POWER_3V,
  GBA_ROM_PAGE,
} from './dict.js';
import {
  beginDumpSession,
  dumpChunkSession,
  endDumpSession,
  dumpMemory,
} from './dump.js';
import { sleep } from './utils.js';

// 128 KB per latched address range (A16–A23 selects which 128 KB window)
const BANK_KB = 128;

// Milliseconds to wait after GB_POWER_3V before asserting the address bus.
// GBA ROM chips (Sharp, Macronix, Atmel) have varying power-on settling times.
// The Lua host gets implicit delay from interpreter overhead; we need an
// explicit pause to ensure all chip variants are ready before the first read.
const POWER_SETTLE_MS = 500;

// Probe settings
const PROBE_KB = 1;
const SIZE_CANDIDATES_KB = [
  256, 512, 1024, 2048, 4096, 8192, 16384, 32768,
];

// ============================================================
// GBA header validation
// Complement check (byte $BD): -(0x19 + sum($A0..$BC)) & 0xFF
// ============================================================
function headerChecksumValid(data) {
  let sum = 0x19;
  for (let i = 0xA0; i <= 0xBC; i++) sum += data[i];
  return ((sum + data[0xBD]) & 0xFF) === 0x00;
}

// ============================================================
// Parse the GBA ROM header from the first 256 bytes of the ROM.
// ============================================================
function parseGbaHeader(data) {
  // Game title: bytes $A0–$AB (12 bytes), ASCII, null-padded
  let titleEnd = 0xAC;
  while (titleEnd > 0xA0 && data[titleEnd - 1] === 0x00) titleEnd--;
  const title = String.fromCharCode(...data.slice(0xA0, titleEnd)).trim();

  // Game code: $AC–$AF (4 bytes, e.g. "AGBJ")
  const gameCode  = String.fromCharCode(...data.slice(0xAC, 0xB0));
  // Maker code: $B0–$B1 (2 bytes)
  const makerCode = String.fromCharCode(...data.slice(0xB0, 0xB2));
  const version   = data[0xBC];
  const checkOk   = headerChecksumValid(data);

  return { title, gameCode, makerCode, version, checkOk };
}

// ============================================================
// Public: read GBA header
//
// Latches address 0 and dumps 256 bytes (2 × 128 B reads) which
// covers the full 192-byte header region ($00–$BF).
// ============================================================
export async function readGbaHeader(dev) {
  await dev.gbaLatchAddr(0x0000, 0x00);
  await dev.gbaLatchAddr(0x0000, 0x00);
  // 0.25 KB = 256 bytes = exactly 2 buffer reads
  const data = await dumpMemory(dev, GBA_ROM_PAGE, 0, 0.25, null);
  await dev.gbaReleaseBus();
  return parseGbaHeader(data);
}

// ============================================================
// Pre-dump probing (session-based, no buffer resets between probes)
// ============================================================

function isAllByte(data, value) {
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== value) return false;
  }
  return true;
}

function samplesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function readGbaSample(dev, bankIndex, sizeKB) {
  await dev.gbaLatchAddr(0x0000, bankIndex);
  const data = await dumpChunkSession(dev, sizeKB, null);
  await dev.gbaReleaseBus();
  return data;
}

async function probeGbaSize(dev, onLog) {
  const log = onLog ?? (msg => console.log('[gba]', msg));
  log('Probing GBA ROM size (session mode)...');

  const bank0 = await readGbaSample(dev, 0, PROBE_KB);

  for (const sizeKB of SIZE_CANDIDATES_KB) {
    const bankIndex = sizeKB / BANK_KB;
    const sample = await readGbaSample(dev, bankIndex, PROBE_KB);
    const isBlank = isAllByte(sample, 0xFF) || isAllByte(sample, 0x00);
    const isMirror = samplesEqual(sample, bank0);

    if (isBlank || isMirror) {
      log(`Probe boundary ${sizeKB} KB: ${isBlank ? 'blank' : 'mirrored'} — using ${sizeKB} KB.`);
      return sizeKB;
    }
  }

  log('Probe reached max boundary — using 32768 KB.');
  return 32768;
}

// ============================================================
// Public entry point
// ============================================================

/**
 * Dump a GBA cartridge and return the raw ROM bytes.
 *
 * @param {USBDevice} usbDevice  — opened, interface-claimed WebUSB device
 * @param {object}   opts
 * @param {number}   opts.sizeKB — ROM size in KB (from UI dropdown)
 * @param {Function} [onProgress] — called with { progress: 0..1 }
 * @param {Function} [onLog]      — log string callback
 * @returns {Promise<{ rom: Uint8Array, title: string }>}
 */
export async function dumpGba(usbDevice, opts = {}, onProgress, onLog) {
  let { sizeKB } = opts;
  if (!sizeKB) throw new Error('sizeKB is required for GBA dump.');

  const dev = new InlRetroDevice(usbDevice);
  const log = onLog ?? (msg => console.log('[gba]', msg));

  log('Initializing device I/O…');
  await dev.io(IO_RESET);
  await dev.io(GBA_INIT);
  await dev.io(GB_POWER_3V);  // GBA cartridge is 3.3 V
  await sleep(0); // wait for ROM chip power-on (varies by manufacturer)

  // Do NOT do a separate header pre-read here.
  //
  // The GBA ROM auto-increments its address counter on every word read.  The
  // firmware also pre-buffers ahead (see Lua comment in basic.lua: "the
  // firmware assumes the host will want the next page and goes ahead and
  // starts dumping it").  Doing a short 256-byte read followed by
  // SET_OPERATION(RESET) leaves the ROM counter at an undefined position
  // (≥ 256, possibly 384 or 512).  While a subsequent LATCH_ADDR(0, 0)
  // should reset the counter, some ROM chips do not recover reliably from
  // this start-stop-restart pattern, causing misaligned reads on those carts.
  //
  // Lua basic.lua goes straight into the 128 KB chunk loop without any
  // pre-read.  We do the same; the header is simply extracted from the first
  // 256 bytes of the completed dump data.

  // Begin a single dump session to allow pre-dump probing without resets.
  await beginDumpSession(dev, GBA_ROM_PAGE, 0);

  if (sizeKB === 'AUTO') {
    sizeKB = await probeGbaSize(dev, log);
    opts.sizeKB = sizeKB;
  }

  const numBanks = sizeKB / BANK_KB;
  const sizeStr  = sizeKB >= 1024 ? `${sizeKB / 1024} MB` : `${sizeKB} KB`;
  log(`Dumping ${sizeStr} GBA ROM (${numBanks} × ${BANK_KB} KB)…`);

  const output = new Uint8Array(sizeKB * 1024);
  let offset = 0;

  for (let b = 0; b < numBanks; b++) {
    if (b % 8 === 0) {
      log(`Bank ${b}/${numBanks}…`);
    }

    // Latch the start address for this 128 KB chunk.
    // A0–A15 = 0x0000 (always aligned to 128 KB boundary).
    // A16–A23 = b (chunk index = upper address bits).
    await dev.gbaLatchAddr(0x0000, b);

    const chunk = await dumpChunkSession(dev, BANK_KB,
      p => onProgress?.({ progress: (b + p) / numBanks }));

    // Release the address bus before the next LATCH_ADDR.
    await dev.gbaReleaseBus();

    output.set(chunk, offset);
    offset += chunk.length;
  }

  // End session before resetting device I/O.
  await endDumpSession(dev);

  log('Resetting device…');
  await dev.io(IO_RESET);

  // Parse the header from the dumped data — the header is always at the
  // start of the ROM, so this is equivalent to reading it fresh but without
  // any extra cart interactions.
  const header = parseGbaHeader(output);
  if (header.title) log(`Title: "${header.title}"  Game code: ${header.gameCode}`);
  if (!header.checkOk) log('WARNING: complement check failed — dump may be corrupt.');

  log(`Complete. ${output.length} bytes (${(output.length / 1024 / 1024).toFixed(1)} MB).`);
  return { rom: output, title: header.title };
}
