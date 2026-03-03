/**
 * platforms.js — Platform config descriptors + shared format helpers.
 *
 * Each PLATFORM descriptor drives the entire UI for that system:
 *   configFields / advancedFields → dropdowns rendered by ConfigCard
 *   initCmds / initDelay         → device initialisation sequence
 *   readHeaderFn / dumpFn        → async USB functions (from js/*.js modules)
 *   buildHeaderRows / buildDumpRows → info-panel row arrays
 *   autoPopulateFn               → auto-set dropdowns from header data
 *   checksumFn / postDumpLogFn   → post-dump verification
 *
 * NES special case: readHeaderFn = null, dumpFn = null
 *   → handleTest / handleDump detect this and call the NES override paths in app.js
 *
 * GB and GBA have separate tabs (tabId = 'gb' and 'gba' respectively).
 */

import {
  NES_INIT, SNES_INIT, N64_INIT,
  GAMEBOY_INIT, GB_POWER_5V, GBA_INIT, GB_POWER_3V, SEGA_INIT,
} from './dict.js';
import { readSnesHeader, dumpSnes, verifySnesChecksum } from './snes.js';
import { readN64Header,  dumpN64  } from './n64.js';
import { readGbHeader,   dumpGb   } from './gb.js';
import { readGbaHeader,  dumpGba  } from './gba.js';
import { readGenesisHeader, dumpGenesis } from './genesis.js';

// ── Shared format helpers ─────────────────────────────────────────────────────
export const fmtKB = kb => kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`;
export const hex8  = v  => `$${v.toString(16).padStart(2,  '0').toUpperCase()}`;
export const hex16 = v  => `$${v.toString(16).padStart(4,  '0').toUpperCase()}`;
export const hex32 = v  => `$${v.toString(16).padStart(8,  '0').toUpperCase()}`;

export function sanitizeFilename(str) {
  return (str || '')
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── SNES helpers (needed by the SNES descriptor below) ───────────────────────
export function snesMapModeToDropdown(byte) {
  switch (byte & 0xEF) {
    case 0x20: case 0x22: return 'LOROM';
    case 0x21: case 0x23: return 'HIROM';
    case 0x25:            return 'EXHIROM';
    default:              return null;
  }
}

export function snesRomSizeToDropdown(byte) {
  if (byte === 0 || byte > 15) return null;
  const kb  = 1 << byte;
  const hit = [256, 512, 1024, 2048, 3072, 4096, 6144, 8192].find(o => o >= kb);
  return hit ? String(hit) : '8192';
}

// ── NES / Famicom ─────────────────────────────────────────────────────────────
// readHeaderFn = null and dumpFn = null: signals NES override path in app.js
export const NES = {
  id:       'nes',
  tabId:    'nes',
  label:    'NES / FC',
  heading:  'NES / Famicom',
  initCmds: [NES_INIT],
  initDelay: 0,

  configFields: [
    {
      id: 'mapper', label: 'Mapper',
      options: [
        { value: 'nrom',    label: 'NROM (Mapper 0)',              selected: true },
        { value: 'uxrom',   label: 'UxROM (Mapper 2) — CHR-RAM' },
        { value: 'cnrom',   label: 'CNROM (Mapper 3)' },
        { value: 'mmc1',    label: 'MMC1 (Mapper 1)' },
        { value: 'mmc3',    label: 'MMC3 (Mapper 4)' },
        { value: 'bxrom',   label: 'BxROM (Mapper 34) — CHR-RAM' },
        { value: 'nina001', label: 'NINA-001 (Mapper 34) — CHR-ROM' },
        { value: 'fme7',    label: 'FME7 / Sunsoft 5B (Mapper 69)' },
        { value: 'mmc2',    label: 'MMC2 (Mapper 9)' },
        { value: 'mmc4',    label: 'MMC4 (Mapper 10)' },
        { value: 'mmc5',    label: 'MMC5 (Mapper 5)' },
        { value: 'vrc6a',   label: 'VRC6a (Mapper 24)' },
        { value: 'vrc6b',   label: 'VRC6b (Mapper 26)' },
        { value: 'gtrom',   label: 'GTROM (Mapper 111) — CHR-RAM' },
      ],
    },
    {
      id: 'prg-size', label: 'PRG-ROM',
      options: [
        { value: '16',   label: '16 KB' },
        { value: '32',   label: '32 KB', selected: true },
        { value: '64',   label: '64 KB' },
        { value: '128',  label: '128 KB' },
        { value: '256',  label: '256 KB' },
        { value: '512',  label: '512 KB' },
        { value: '1024', label: '1 MB' },
      ],
    },
    {
      id: 'chr-size', label: 'CHR-ROM',
      options: [
        { value: '0',   label: '0 KB (CHR-RAM)' },
        { value: '8',   label: '8 KB', selected: true },
        { value: '16',  label: '16 KB' },
        { value: '32',  label: '32 KB' },
        { value: '64',  label: '64 KB' },
        { value: '128', label: '128 KB' },
        { value: '256', label: '256 KB' },
      ],
    },
  ],

  advancedFields: [
    {
      id: 'mirroring', label: 'Mirroring',
      options: [
        { value: 'HORZ', label: 'Horizontal' },
        { value: 'VERT', label: 'Vertical', selected: true },
      ],
    },
    {
      id: 'battery', label: 'Battery',
      options: [
        { value: 'no',  label: 'No',  selected: true },
        { value: 'yes', label: 'Yes' },
      ],
    },
  ],

  testLabel: 'Test: Read $8000–800F',
  dumpLabel: 'Dump ROM',

  readHeaderFn:  null,  // NES override path
  dumpFn:        null,  // NES override path
  autoPopulateFn: null,
  checksumFn:     null,
  postDumpLogFn:  null,
  buildHeaderRows: null,
  supportsFlash:  true, // flash dispatch lives in app.js → MAPPER_FLASH_FN

  getOptsFromConfig: (cfg) => ({
    mapper:     cfg['mapper'],
    prgKB:      parseInt(cfg['prg-size'], 10),
    chrKB:      parseInt(cfg['chr-size'], 10),
    mirroring:  cfg['mirroring'],
    battery:    cfg['battery'] === 'yes',
  }),

  buildDumpRows: (header, dumpResult, opts) => {
    const { prgKB, chrKB, mirroring, mapper } = opts;
    return [
      { section: 'Configuration' },
      { label: 'Mapper',    value: mapper.toUpperCase() },
      { label: 'PRG-ROM',   value: fmtKB(prgKB) },
      { label: 'CHR-ROM',   value: chrKB > 0 ? fmtKB(chrKB) : 'CHR-RAM' },
      { label: 'Mirroring', value: mirroring },
      { section: 'Dump Result' },
      { label: 'File size', value: `${dumpResult.rom.length.toLocaleString()} bytes (${fmtKB(dumpResult.rom.length / 1024)})` },
      { label: 'MD5',       value: dumpResult.md5, copy: true },
    ];
  },

  filenameFn: (header, rom, opts) =>
    `dump-nes-${opts.mapper}-${opts.prgKB}prg-${opts.chrKB}chr`,
  fileExtFn: () => 'nes',

  hasExtraSlot: false,
};

// ── SNES / Super Famicom ──────────────────────────────────────────────────────
export const SNES = {
  id:       'snes',
  tabId:    'snes',
  label:    'SNES / SFC',
  heading:  'SNES / Super Famicom',
  initCmds: [SNES_INIT],
  initDelay: 0,

  configFields: [
    {
      id: 'mapping', label: 'Mapping',
      options: [
        { value: 'LOROM',   label: 'LoROM',   selected: true },
        { value: 'HIROM',   label: 'HiROM' },
        { value: 'EXHIROM', label: 'ExHiROM' },
      ],
    },
    {
      id: 'size', label: 'ROM Size',
      options: [
        { value: '256',  label: '2 Mbit (256 KB)' },
        { value: '512',  label: '4 Mbit (512 KB)' },
        { value: '1024', label: '8 Mbit (1 MB)' },
        { value: '2048', label: '16 Mbit (2 MB)', selected: true },
        { value: '3072', label: '24 Mbit (3 MB)' },
        { value: '4096', label: '32 Mbit (4 MB)' },
        { value: '6144', label: '48 Mbit (6 MB)' },
        { value: '8192', label: '64 Mbit (8 MB)' },
      ],
    },
  ],

  advancedFields: [],
  testLabel: 'Test: Read SNES Header',
  dumpLabel: 'Dump SNES ROM',

  readHeaderFn: (dev) => readSnesHeader(dev, 0),
  dumpFn: dumpSnes,

  getOptsFromConfig: (cfg) => ({
    sizeKB:  parseInt(cfg['size'], 10),
    mapping: cfg['mapping'],
  }),

  // Checksum + complement must sum to 0xFFFF for a valid SNES cart
  cartValidFn: (h) => (h.checksum + h.complement) === 0xFFFF,

  autoPopulateFn: (h) => {
    const result = {};
    const mapping = snesMapModeToDropdown(h.mapModeByte);
    const size    = snesRomSizeToDropdown(h.romSizeByte);
    if (mapping) result['mapping'] = mapping;
    if (size)    result['size']    = size;
    return result;
  },

  buildHeaderRows: (h) => {
    const pairOk = (h.checksum + h.complement) === 0xFFFF;
    return [
      { section: 'Cart Header' },
      { label: 'Title',        value: h.title || '—' },
      { label: 'Map mode',     value: `${hex8(h.mapModeByte)} → ${h.mapModeStr}` },
      { label: 'ROM size',     value: `${hex8(h.romSizeByte)} → ${h.romSizeStr}` },
      { label: 'SRAM size',    value: `${hex8(h.sramSizeByte)} → ${h.sramSizeStr}` },
      { label: 'Checksum',     value: hex16(h.checksum) },
      { label: 'Complement',   value: hex16(h.complement) },
      { label: 'Pair valid',   value: pairOk ? 'Yes' : 'No — check mapping', cls: pairOk ? 'info-ok' : 'info-warn' },
      { label: 'Reset vector', value: hex16(h.resetVector) },
    ];
  },

  buildDumpRows: (header, dumpResult, opts) => {
    const { sizeKB, mapping } = opts;
    const sizeFmt = fmtKB(sizeKB);
    const rows = header
      ? [...SNES.buildHeaderRows(header), { section: 'Dump Result' }]
      : [{ section: 'Dump Result' }];
    const ck = dumpResult.checksum;
    if (ck && !ck.error) {
      rows.push(
        { label: 'Stored checksum',     value: hex16(ck.storedChecksum) },
        { label: 'Calculated checksum', value: hex16(ck.calculatedChecksum) },
        { label: 'Checksum',            value: ck.checksumOk ? 'OK ✓' : 'MISMATCH ✗',
                                        cls:   ck.checksumOk ? 'info-ok' : 'info-err' },
      );
    }
    rows.push(
      { label: 'File size', value: `${dumpResult.rom.length.toLocaleString()} bytes (${sizeFmt})` },
      { label: 'MD5',       value: dumpResult.md5, copy: true },
    );
    return rows;
  },

  filenameFn: (header, rom, opts) => {
    const title = sanitizeFilename(header?.title || '');
    const { sizeKB, mapping } = opts;
    const sizeFmt = sizeKB >= 1024 ? `${sizeKB / 1024}MB` : `${sizeKB}KB`;
    return title || `dump-snes-${sizeFmt}-${mapping.toLowerCase()}`;
  },
  fileExtFn: () => 'sfc',

  supportsFlash: true,  // flashFn = flashSnes (imported in app.js)

  checksumFn: (rom, opts) => verifySnesChecksum(rom, opts.mapping),

  postDumpLogFn: (ck, logLine) => {
    if (ck.error) {
      logLine(`Checksum: unable to verify — ${ck.error}`, 'log-warn');
      return;
    }
    const pairStr = ck.complementOk ? 'pair valid' : 'PAIR INVALID';
    logLine(
      `Checksum:  stored=${hex16(ck.storedChecksum)}` +
      `  complement=${hex16(ck.storedComplement)}  (${pairStr})`,
      ck.complementOk ? '' : 'log-warn'
    );
    logLine(
      `Checksum:  calculated=${hex16(ck.calculatedChecksum)}` +
      `  — ${ck.checksumOk ? 'matches stored ✓' : 'MISMATCH ✗'}`,
      ck.checksumOk ? 'log-ok' : 'log-err'
    );
    if (!ck.valid) {
      logLine(
        '⚠ Checksum mismatch — the dump may be corrupt or incomplete. ' +
        'Verify the ROM size and mapping, reseat the cartridge, and try again.',
        'log-warn'
      );
    }
  },

  hasExtraSlot: false,
};

// ── Nintendo 64 ───────────────────────────────────────────────────────────────
export const N64 = {
  id:       'n64',
  tabId:    'n64',
  label:    'N64',
  heading:  'Nintendo 64',
  initCmds: [N64_INIT],
  initDelay: 2000,  // cart bus stabilisation

  configFields: [
    {
      id: 'size', label: 'ROM Size',
      options: [
        { value: '4096',  label: '32 Mbit (4 MB)' },
        { value: '8192',  label: '64 Mbit (8 MB)', selected: true },
        { value: '12288', label: '96 Mbit (12 MB)' },
        { value: '16384', label: '128 Mbit (16 MB)' },
        { value: '24576', label: '192 Mbit (24 MB)' },
        { value: '32768', label: '256 Mbit (32 MB)' },
        { value: '49152', label: '384 Mbit (48 MB)' },
        { value: '65536', label: '512 Mbit (64 MB)' },
      ],
    },
  ],

  advancedFields: [],
  testLabel: 'Test: Read N64 Header',
  dumpLabel: 'Dump N64 ROM',

  readHeaderFn: readN64Header,
  dumpFn: dumpN64,

  getOptsFromConfig: (cfg) => ({ sizeKB: parseInt(cfg['size'], 10) }),

  // CRC1 being 0 or 0xFFFFFFFF indicates no cart / all-zero / all-FF bus reads
  cartValidFn: (h) => h.crc1 !== 0 && h.crc1 !== 0xFFFFFFFF,

  autoPopulateFn: null,

  buildHeaderRows: (h) => [
    { section: 'Cart Header' },
    { label: 'Title',   value: h.title || '—' },
    { label: 'Format',  value: h.formatStr },
    { label: 'CRC1',    value: hex32(h.crc1) },
    { label: 'CRC2',    value: hex32(h.crc2) },
    { label: 'Country', value: h.countryStr },
    { label: 'Version', value: `${h.version}` },
  ],

  buildDumpRows: (header, dumpResult, opts) => {
    const rows = header
      ? [...N64.buildHeaderRows(header), { section: 'Dump Result' }]
      : [{ section: 'Dump Result' }];
    rows.push(
      { label: 'File size', value: `${dumpResult.rom.length.toLocaleString()} bytes (${fmtKB(opts.sizeKB)})` },
      { label: 'MD5',       value: dumpResult.md5, copy: true },
    );
    return rows;
  },

  filenameFn: (header, rom, opts) => {
    const title = sanitizeFilename(header?.title || '');
    const sizeMB = opts.sizeKB / 1024;
    return title || `dump-n64-${sizeMB}MB`;
  },
  fileExtFn: () => 'z64',

  checksumFn: null,
  postDumpLogFn: null,

  hasExtraSlot: true,  // N64 byte-order converter rendered below the dump card
};

// ── Game Boy / Game Boy Color ─────────────────────────────────────────────────
export const GB = {
  id:       'gb',
  tabId:    'gb',
  label:    'GB / GBC',
  heading:  'Game Boy / Game Boy Color',
  initCmds: [GAMEBOY_INIT, GB_POWER_5V],
  initDelay: 0,

  configFields: [
    {
      id: 'mbc', label: 'MBC Type',
      options: [
        { value: 'AUTO',     label: 'Auto-detect', selected: true },
        { value: 'ROM_ONLY', label: 'ROM Only (32 KB)' },
        { value: 'MBC1',     label: 'MBC1' },
        { value: 'MBC2',     label: 'MBC2' },
        { value: 'MBC3',     label: 'MBC3' },
        { value: 'MBC5',     label: 'MBC5' },
      ],
    },
    {
      id: 'size', label: 'ROM Size',
      options: [
        { value: 'AUTO', label: 'Auto-detect', selected: true },
        { value: '32',   label: '256 Kbit (32 KB)' },
        { value: '64',   label: '512 Kbit (64 KB)' },
        { value: '128',  label: '1 Mbit (128 KB)' },
        { value: '256',  label: '2 Mbit (256 KB)' },
        { value: '512',  label: '4 Mbit (512 KB)' },
        { value: '1024', label: '8 Mbit (1 MB)' },
        { value: '2048', label: '16 Mbit (2 MB)' },
        { value: '4096', label: '32 Mbit (4 MB)' },
        { value: '8192', label: '64 Mbit (8 MB)' },
      ],
    },
  ],

  advancedFields: [],
  testLabel: 'Test: Read GB Header',
  dumpLabel: 'Dump GB / GBC ROM',

  readHeaderFn: readGbHeader,
  dumpFn: dumpGb,

  getOptsFromConfig: (cfg) => ({
    mbcType:   cfg['mbc']  === 'AUTO' ? 'AUTO' : cfg['mbc'],
    romSizeKB: cfg['size'] === 'AUTO' ? 'AUTO' : parseInt(cfg['size'], 10),
  }),

  // Nintendo logo check + header checksum must both pass for a real GB/GBC cart
  cartValidFn: (h) => h.logoOk && h.checkOk,

  autoPopulateFn: (h) => {
    const result = {};
    if (h.mbcType && h.mbcType !== 'UNKNOWN') result['mbc'] = h.mbcType;
    if (h.romSizeKB) result['size'] = String(h.romSizeKB);
    return result;
  },

  buildHeaderRows: (h) => {
    const hdrOk = h.logoOk && h.checkOk;
    return [
      { section: 'Cart Header' },
      { label: 'Title',           value: h.title || '—' },
      { label: 'Type',            value: h.isGbc ? 'Game Boy Color' : 'Game Boy (DMG)' },
      { label: 'Cart type',       value: `${hex8(h.cartType)} → ${h.mbcType}` },
      { label: 'ROM size',        value: h.romSizeKB ? fmtKB(h.romSizeKB) : `code ${hex8(h.romSizeCode)}` },
      { label: 'Logo check',      value: h.logoOk  ? 'OK' : 'FAIL', cls: h.logoOk  ? 'info-ok' : 'info-err' },
      { label: 'Header checksum', value: h.checkOk ? 'OK' : 'FAIL', cls: h.checkOk ? 'info-ok' : 'info-err' },
      { label: 'Cart valid',      value: hdrOk ? 'Yes' : 'No — check cart seating', cls: hdrOk ? 'info-ok' : 'info-warn' },
    ];
  },

  buildDumpRows: (header, dumpResult, opts) => {
    const h = dumpResult.header ?? header;
    const rows = h ? [...GB.buildHeaderRows(h), { section: 'Dump Result' }]
                   : [{ section: 'Dump Result' }];
    const sizeMB = dumpResult.rom.length >= 1024 * 1024
      ? `${(dumpResult.rom.length / 1024 / 1024).toFixed(1)} MB`
      : `${(dumpResult.rom.length / 1024).toFixed(0)} KB`;
    rows.push(
      { label: 'File size', value: `${dumpResult.rom.length.toLocaleString()} bytes (${sizeMB})` },
      { label: 'MD5',       value: dumpResult.md5, copy: true },
    );
    return rows;
  },

  filenameFn: (header, rom, opts) => {
    const title = sanitizeFilename(header?.title || '');
    const ext = header?.isGbc ? 'gbc' : 'gb';
    const sizeMB = rom.length >= 1024 * 1024
      ? `${(rom.length / 1024 / 1024).toFixed(1)}MB`
      : `${(rom.length / 1024).toFixed(0)}KB`;
    // Extension is part of the base name for GB (to choose .gb vs .gbc)
    GB._lastExt = ext;
    return title || `dump-${ext}-${sizeMB}`;
  },
  fileExtFn: (header) => header?.isGbc ? 'gbc' : 'gb',

  checksumFn: null,
  postDumpLogFn: null,

  hasExtraSlot: false,
};

// ── Game Boy Advance ──────────────────────────────────────────────────────────
// readHeaderFn = null because dumpGba performs its own header read internally;
// the title/header come back from the dumpFn return value.
export const GBA = {
  id:       'gba',
  tabId:    'gba',
  label:    'GBA',
  heading:  'Game Boy Advance',
  initCmds: [GBA_INIT, GB_POWER_3V],
  initDelay: 0,

  configFields: [
    {
      id: 'size', label: 'ROM Size',
      options: [
        { value: 'AUTO',  label: 'Auto-detect (probe)', selected: true },
        { value: '256',   label: '2 Mbit (256 KB)' },
        { value: '512',   label: '4 Mbit (512 KB)' },
        { value: '1024',  label: '8 Mbit (1 MB)' },
        { value: '2048',  label: '16 Mbit (2 MB)' },
        { value: '4096',  label: '32 Mbit (4 MB)' },
        { value: '8192',  label: '64 Mbit (8 MB)' },
        { value: '16384', label: '128 Mbit (16 MB)' },
        { value: '32768', label: '256 Mbit (32 MB)' },
      ],
    },
  ],

  advancedFields: [],
  testLabel: 'Test: Read GBA Header',
  dumpLabel: 'Dump GBA ROM',

  readHeaderFn: readGbaHeader,
  dumpFn: dumpGba,

  getOptsFromConfig: (cfg) => ({
    sizeKB: cfg['size'] === 'AUTO' ? 'AUTO' : parseInt(cfg['size'], 10),
  }),

  // Header complement check must pass for a valid GBA cart
  cartValidFn: (h) => h.checkOk,

  autoPopulateFn: null,  // GBA header has no ROM size field

  buildHeaderRows: (h) => [
    { section: 'Cart Header' },
    { label: 'Title',      value: h.title || '—' },
    { label: 'Game code',  value: h.gameCode },
    { label: 'Maker code', value: h.makerCode },
    { label: 'Version',    value: `${h.version}` },
    { label: 'Complement', value: h.checkOk ? 'OK' : 'FAIL', cls: h.checkOk ? 'info-ok' : 'info-err' },
  ],

  buildDumpRows: (header, dumpResult, opts) => {
    const sizeKB = opts.sizeKB;
    const sizeFmt = fmtKB(sizeKB);
    const rows = header
      ? [...GBA.buildHeaderRows(header), { section: 'Dump Result' }]
      : [{ section: 'Dump Result' }];
    rows.push(
      { label: 'File size', value: `${dumpResult.rom.length.toLocaleString()} bytes (${sizeFmt})` },
      { label: 'MD5',       value: dumpResult.md5, copy: true },
    );
    return rows;
  },

  filenameFn: (header, rom, opts) => {
    const title = sanitizeFilename(header?.title || '');
    const sizeKB = opts.sizeKB;
    const sizeFmt = sizeKB >= 1024 ? `${sizeKB / 1024}MB` : `${sizeKB}KB`;
    return title || `dump-gba-${sizeFmt}`;
  },
  fileExtFn: () => 'gba',

  checksumFn: null,
  postDumpLogFn: null,

  hasExtraSlot: false,
};

// ── Sega Genesis / Mega Drive ─────────────────────────────────────────────────
export const GENESIS = {
  id:       'genesis',
  tabId:    'genesis',
  label:    'Genesis / MD',
  heading:  'Sega Genesis / Mega Drive',
  initCmds: [SEGA_INIT],
  initDelay: 0,

  configFields: [
    {
      id: 'size', label: 'ROM Size',
      options: [
        { value: 'AUTO', label: 'Auto-detect from header', selected: true },
        { value: '256',  label: '2 Mbit (256 KB)' },
        { value: '512',  label: '4 Mbit (512 KB)' },
        { value: '1024', label: '8 Mbit (1 MB)' },
        { value: '2048', label: '16 Mbit (2 MB)' },
        { value: '3072', label: '24 Mbit (3 MB)' },
        { value: '4096', label: '32 Mbit (4 MB)' },
        { value: '5120', label: '40 Mbit (5 MB)' },
      ],
    },
  ],

  advancedFields: [],
  testLabel: 'Test: Read Genesis Header',
  dumpLabel: 'Dump Genesis ROM',

  readHeaderFn: readGenesisHeader,
  dumpFn: dumpGenesis,

  getOptsFromConfig: (cfg) => ({
    sizeKB: cfg['size'] === 'AUTO' ? 'AUTO' : parseInt(cfg['size'], 10),
  }),

  // h.valid is set by readGenesisHeader when the console name field looks correct
  cartValidFn: (h) => h.valid,

  autoPopulateFn: (h) => {
    if (!h.romSizeKB) return {};
    return { size: String(h.romSizeKB) };
  },

  buildHeaderRows: (h) => [
    { section: 'Cart Header' },
    { label: 'Console',          value: h.consoleName?.trim() || '—' },
    { label: 'Title (domestic)', value: h.domesticName?.trim() || '—' },
    { label: "Title (int'l)",    value: h.intlName?.trim() || '—' },
    { label: 'Serial',           value: h.serial?.trim() || '—' },
    { label: 'Region',           value: h.region?.trim() || '—' },
    { label: 'ROM size',         value: h.romSizeKB ? fmtKB(h.romSizeKB) : '—' },
    { label: 'Stored checksum',  value: `0x${h.storedChecksum.toString(16).padStart(4,'0').toUpperCase()}` },
    { label: 'Header valid',     value: h.valid ? 'Yes' : 'No — check cart seating', cls: h.valid ? 'info-ok' : 'info-warn' },
  ],

  buildDumpRows: (header, dumpResult, opts) => {
    const h = dumpResult.header ?? header;
    const rows = h ? [...GENESIS.buildHeaderRows(h), { section: 'Dump Result' }]
                   : [{ section: 'Dump Result' }];
    const dumpSizeKB = dumpResult.rom.length / 1024;
    const dumpSizeFmt = fmtKB(dumpSizeKB);
    const ck = dumpResult.checksum;
    if (ck) {
      const storedHex   = ck.stored.toString(16).padStart(4,'0').toUpperCase();
      const computedHex = ck.computed.toString(16).padStart(4,'0').toUpperCase();
      rows.push(
        { label: 'Computed checksum', value: `0x${computedHex}` },
        { label: 'Checksum',
          value: ck.ok ? 'OK ✓' : `MISMATCH ✗ (stored 0x${storedHex})`,
          cls:   ck.ok ? 'info-ok' : 'info-err' },
      );
    }
    rows.push(
      { label: 'File size', value: `${dumpResult.rom.length.toLocaleString()} bytes (${dumpSizeFmt})` },
      { label: 'MD5',       value: dumpResult.md5, copy: true },
    );
    return rows;
  },

  filenameFn: (header, rom, opts) => {
    const h = header;
    const title = sanitizeFilename(
      (h?.intlName || h?.domesticName || '').trim()
    );
    const dumpSizeKB = rom.length / 1024;
    const sizeFmt = dumpSizeKB >= 1024 ? `${dumpSizeKB / 1024}MB` : `${dumpSizeKB}KB`;
    return title || `dump-genesis-${sizeFmt}`;
  },
  fileExtFn: () => 'md',

  // Genesis checksum is performed inside dumpGenesis; result comes back in rawResult
  checksumFn: null,
  postDumpLogFn: null,

  hasExtraSlot: false,
};

// ── Ordered platform list ─────────────────────────────────────────────────────
// Tab bar renders unique tabIds in this order; platforms with same tabId share a tab.
export const PLATFORMS = [NES, SNES, GB, GBA, N64, GENESIS];

// Mapper CHR-RAM set (used by ConfigCard to disable CHR-size select for NES)
export const MAPPER_CHR_RAM = new Set(['uxrom', 'bxrom', 'gtrom']);
