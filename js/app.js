/**
 * app.js — INL Retro Web: root App component + USB handlers.
 *
 * All UI components live in js/components/; platform descriptors (config
 * fields, dump/test fns, row builders) come from platforms.js.
 * This file is purely orchestration: state, handlers, and the top-level render.
 *
 * Import map in index.html resolves bare specifiers:
 *   "preact"       → ./js/lib/preact.module.js
 *   "preact/hooks" → ./js/lib/hooks.module.js
 *   "htm/preact"   → ./js/lib/htm-preact.js
 */

import { h, render, Fragment } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { html } from 'htm/preact';

import {
  VID, PID, InlRetroDevice,
  IO_RESET, NES_INIT, NES_CPU_RD, NES_PPU_RD,
} from './dict.js';
import { dumpNrom } from './nrom.js';
import {
  dumpUxRom, dumpCnrom, dumpMmc1, dumpMmc3, dumpBxRom,
  dumpNina001, dumpFme7, dumpMmc2, dumpMmc4, dumpMmc5, dumpGtrom,
  dumpVrc6a, dumpVrc6b,
} from './nes-mappers.js';
import { MAPPER_FLASH_FN, nesMapperSupportsFlash } from './nes-flash.js';
import { flashSnes } from './snes-flash.js';
import { sleep, md5Hex } from './utils.js';
import { PLATFORMS, NES, sanitizeFilename } from './platforms.js';

import { TabBar }           from './components/TabBar.js';
import { DeviceCard }       from './components/DeviceCard.js';
import { ConfigCard }       from './components/ConfigCard.js';
import { ActionCard }       from './components/ActionCard.js';
import { FlashCard }        from './components/FlashCard.js';
import { InfoPanel }        from './components/InfoPanel.js';
import { ProgressCard }     from './components/ProgressCard.js';
import { LogPanel }         from './components/LogPanel.js';
import { DownloadCard }     from './components/DownloadCard.js';
import { N64ConverterCard } from './components/N64ConverterCard.js';

// ── NES mapper dispatch table ─────────────────────────────────────────────────
const MAPPER_DUMP_FN = {
  nrom:    dumpNrom,
  uxrom:   dumpUxRom,
  cnrom:   dumpCnrom,
  mmc1:    dumpMmc1,
  mmc3:    dumpMmc3,
  bxrom:   dumpBxRom,
  nina001: dumpNina001,
  fme7:    dumpFme7,
  mmc2:    dumpMmc2,
  mmc4:    dumpMmc4,
  mmc5:    dumpMmc5,
  vrc6a:   dumpVrc6a,
  vrc6b:   dumpVrc6b,
  gtrom:   dumpGtrom,
};

// ── Build initial config values from platform descriptor defaults ─────────────
function initConfigs() {
  const c = {};
  for (const p of PLATFORMS) {
    c[p.id] = {};
    for (const f of [...p.configFields, ...p.advancedFields]) {
      const def = f.options.find(o => o.selected) ?? f.options[0];
      c[p.id][f.id] = def?.value ?? '';
    }
  }
  return c;
}

// ── Root App component ────────────────────────────────────────────────────────
function App() {
  const [connected,  setConnected]  = useState(false);
  const [isDumping,  setIsDumping]  = useState(false);
  const [activeTab,  setActiveTab]  = useState('nes');
  const [configs,    setConfigs]    = useState(initConfigs);
  const [logLines,   setLogLines]   = useState([]);
  const [infoRows,   setInfoRows]   = useState({});  // { platformId: rows[] }
  const [progress,   setProgress]   = useState({ phase: '—', value: 0 });
  const [download,   setDownload]   = useState(null);
  const [cartStatus, setCartStatus] = useState({}); // { platformId: 'ok' | 'fail' }

  // Refs for values needed inside async handlers (avoid stale closure issues)
  const deviceRef      = useRef(null);
  const headersRef     = useRef({});   // { platformId: headerObj }
  const downloadUrlRef = useRef(null);
  // Mirror configs into a ref so async handlers always read the current value
  const configsRef = useRef(null);
  configsRef.current = configs;

  // ── Primitive helpers ─────────────────────────────────────────────────────

  function logLine(msg, cls = '') {
    setLogLines(prev => [...prev, { msg, cls }]);
    console.log('[INLRetro]', msg);
  }

  function updateConfig(platformId, updates) {
    setConfigs(prev => ({ ...prev, [platformId]: { ...prev[platformId], ...updates } }));
  }

  function offerDownload(data, filename, info) {
    if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    downloadUrlRef.current = url;
    setDownload({ url, filename, info });
  }

  function setCart(platformId, status) {
    setCartStatus(prev => ({ ...prev, [platformId]: status }));
  }

  // ── Operation runner — shared try/catch/finally + setIsDumping boilerplate ──
  //
  // `onError` is called before the generic error logLine; use it to reset
  // progress state in dump operations.

  async function runOp(intro, asyncFn, onError) {
    if (!deviceRef.current || isDumping) return;
    setIsDumping(true);
    logLine('─'.repeat(40));
    logLine(intro, 'log-info');
    try {
      await asyncFn();
    } catch (err) {
      onError?.(err);
      logLine(`Error: ${err.message}`, 'log-err');
      console.error(err);
    } finally {
      setIsDumping(false);
    }
  }

  // ── Device initialisation helper ─────────────────────────────────────────
  // Opens a fresh InlRetroDevice, sends IO_RESET + platform init commands,
  // and waits initDelay ms. Returns the initialised device.

  async function initDevice(platform) {
    const dev = new InlRetroDevice(deviceRef.current);
    await dev.io(IO_RESET);
    for (const cmd of platform.initCmds) await dev.io(cmd);
    if (platform.initDelay) await sleep(platform.initDelay);
    return dev;
  }

  // ── Header cache helper ───────────────────────────────────────────────────
  // Stores h in headersRef, updates the info panel, runs autoPopulateFn and
  // logs any auto-set field values. Returns cfg merged with auto-populated values.

  function cacheHeader(platform, h, cfg = {}) {
    headersRef.current[platform.id] = h;
    setInfoRows(prev => ({ ...prev, [platform.id]: platform.buildHeaderRows(h) }));
    if (!platform.autoPopulateFn) return cfg;
    const updates = platform.autoPopulateFn(h);
    updateConfig(platform.id, updates);
    for (const [fieldId, val] of Object.entries(updates)) {
      logLine(`→ ${fieldId} set to ${val}`, 'log-info');
    }
    return { ...cfg, ...updates };
  }

  // ── Header row → prose log helper ────────────────────────────────────────
  // Converts the structured info-panel rows into human-readable log lines.
  // Used by test handlers to give verbose diagnostic output.

  function logHeaderRows(platform, h) {
    for (const row of (platform.buildHeaderRows?.(h) ?? [])) {
      if ('section' in row) {
        logLine(`── ${row.section} ──`);
      } else {
        const cls = row.cls ? row.cls.replace('info-', 'log-') : '';
        logLine(`${row.label}: ${row.value ?? '—'}`, cls);
      }
    }
    const titleStr = sanitizeFilename(
      h.title ?? (h.intlName || h.domesticName || '').trim() ?? ''
    );
    if (titleStr) logLine(`→ Filename will use title: "${titleStr}"`, 'log-info');
  }

  // ── Device management ─────────────────────────────────────────────────────

  async function handleConnect() {
    try {
      logLine('Requesting device (browser permission dialog)…', 'log-info');
      const dev = await navigator.usb.requestDevice({ filters: [{ vendorId: VID, productId: PID }] });
      logLine(`Found: "${dev.manufacturerName}" — "${dev.productName}"`, 'log-ok');
      logLine(
        `VID: 0x${dev.vendorId.toString(16).padStart(4, '0')}  ` +
        `PID: 0x${dev.productId.toString(16).padStart(4, '0')}`,
        'log-info'
      );
      await dev.open();
      if (dev.configuration === null) await dev.selectConfiguration(1);
      await dev.claimInterface(0);
      logLine('Device opened and interface claimed.', 'log-ok');
      deviceRef.current = dev;
      setConnected(true);
    } catch (err) {
      logLine(`Connect failed: ${err.message}`, 'log-err');
      deviceRef.current = null;
      setConnected(false);
    }
  }

  async function handleDisconnect() {
    if (!deviceRef.current) return;
    try {
      await deviceRef.current.releaseInterface(0);
      await deviceRef.current.close();
      logLine('Device disconnected.', 'log-warn');
    } catch (err) {
      logLine(`Disconnect warning: ${err.message}`, 'log-warn');
    } finally {
      deviceRef.current = null;
      setConnected(false);
      setCartStatus({});
    }
  }

  // Listen for physical (surprise) disconnect events
  useEffect(() => {
    function onUsbDisconnect(e) {
      if (deviceRef.current && e.device === deviceRef.current) {
        logLine('Device disconnected unexpectedly.', 'log-warn');
        deviceRef.current = null;
        setConnected(false);
        setCartStatus({});
      }
    }
    if (navigator.usb) navigator.usb.addEventListener('disconnect', onUsbDisconnect);
    return () => navigator.usb?.removeEventListener('disconnect', onUsbDisconnect);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── NES test (special-cased: reads raw PRG + CHR bytes for diagnostics) ──

  async function handleNesTest() {
    setCart('nes', null);
    await runOp('NES Check Cartridge: IO_RESET + NES_INIT, reading $8000–800F…', async () => {
      const dev = new InlRetroDevice(deviceRef.current);
      await dev.io(IO_RESET);
      await dev.io(NES_INIT);

      // GTROM: bank register at $5000 has no defined reset state — explicitly
      // select bank 0 so $8000-$FFFF shows real PRG data.
      const testMapper = configsRef.current['nes']?.['mapper'] ?? 'nrom';
      if (testMapper === 'gtrom') {
        await dev.nesWrite(0x5000, 0);
      }

      const prgBytes = [];
      for (let a = 0x8000; a <= 0x800F; a++) prgBytes.push(await dev.nesRead(NES_CPU_RD, a));
      logLine(`$8000–800F: ${prgBytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

      const lo = await dev.nesRead(NES_CPU_RD, 0xFFFC);
      const hi = await dev.nesRead(NES_CPU_RD, 0xFFFD);
      logLine(`Reset vector ($FFFC): $${((hi << 8) | lo).toString(16).padStart(4, '0')}`, 'log-ok');

      const chrBytes = [];
      for (let a = 0x0000; a <= 0x0007; a++) chrBytes.push(await dev.nesRead(NES_PPU_RD, a));
      logLine(`PPU $0000–0007: ${chrBytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

      await dev.io(IO_RESET);

      if (prgBytes.every(b => b === 0xFF) || prgBytes.every(b => b === 0x00)) {
        logLine('WARNING: PRG bytes all 0xFF or 0x00 — check cart seating.', 'log-warn');
        setCart('nes', 'fail');
      } else {
        logLine('PRG data looks real. Cart is communicating.', 'log-ok');
        setCart('nes', 'ok');
      }
    }, () => setCart('nes', 'fail'));
  }

  // ── NES dump (special-cased: mapper dispatch table) ───────────────────────

  async function handleNesDump() {
    const cfg       = configsRef.current['nes'];
    const mapper    = cfg['mapper']    ?? 'nrom';
    const prgKB     = parseInt(cfg['prg-size'] ?? '32', 10);
    const chrKB     = parseInt(cfg['chr-size'] ?? '8',  10);
    const mirroring = cfg['mirroring'] ?? 'VERT';
    const battery   = cfg['battery'] === 'yes';
    const dumpFn    = MAPPER_DUMP_FN[mapper];
    const phases    = ['PRG-ROM', ...(chrKB > 0 ? ['CHR-ROM'] : [])];

    await runOp(
      `Starting NES dump: mapper=${mapper.toUpperCase()} ${prgKB} KB PRG + ${chrKB} KB CHR, ${mirroring} mirroring`,
      async () => {
        setDownload(null);
        setProgress({ phase: 'Initializing…', value: 0 });

        const rom = await dumpFn(
          deviceRef.current,
          { prgKB, chrKB, mirroring, battery },
          ({ part, totalParts, progress: p }) => {
            setProgress({
              phase: `${phases[part] ?? 'Dumping'} — ${Math.round(p * 100)}%`,
              value: ((part + p) / totalParts) * 100,
            });
          },
          msg => logLine(msg)
        );

        setProgress({ phase: 'Done!', value: 100 });
        const md5      = md5Hex(rom);
        const filename = `dump-nes-${mapper}-${prgKB}prg-${chrKB}chr.nes`;
        offerDownload(rom, filename,
          `${filename}  ·  ${rom.length} bytes  ·  PRG: ${prgKB} KB  CHR: ${chrKB} KB  Mirroring: ${mirroring}`);
        logLine(`Dump complete → ${filename}`, 'log-ok');

        const opts = NES.getOptsFromConfig(cfg);
        setInfoRows(prev => ({ ...prev, nes: NES.buildDumpRows(null, { rom, md5 }, opts) }));
      },
      () => setProgress({ phase: 'Error — see log.', value: 0 })
    );
  }

  // ── Generic platform test ─────────────────────────────────────────────────

  async function handleTest(platform) {
    if (platform.id === 'nes') return handleNesTest();
    setCart(platform.id, null);
    await runOp(`${platform.heading} Check Cartridge…`, async () => {
      const dev = await initDevice(platform);
      const h   = await platform.readHeaderFn(dev);
      logHeaderRows(platform, h);
      cacheHeader(platform, h);
      await dev.io(IO_RESET);
      const valid = !platform.cartValidFn || platform.cartValidFn(h);
      if (!valid) logLine('Cart header invalid — check cart is seated correctly.', 'log-warn');
      setCart(platform.id, valid ? 'ok' : 'fail');
    }, () => setCart(platform.id, 'fail'));
  }

  // ── Generic platform dump ─────────────────────────────────────────────────
  // If no header is cached, pre-reads it (for auto-populate + title → filename).
  // Normalises the varied return shapes from dump functions into a common dumpResult.

  async function handleDump(platform) {
    if (platform.id === 'nes') return handleNesDump();

    // Capture config at call time so auto-populate changes are visible to opts
    let cfg = { ...configsRef.current[platform.id] };

    await runOp(
      `Starting ${platform.heading} dump…`,
      async () => {
        setDownload(null);
        setProgress({ phase: 'Initializing…', value: 0 });

        // Pre-read header if not cached (provides title, auto-populates dropdowns)
          if (
            platform.id !== 'gba' &&
            !headersRef.current[platform.id] &&
            platform.readHeaderFn
          ) {
            logLine(`Reading ${platform.heading} header…`, 'log-info');
            const dev = await initDevice(platform);
            const h   = await platform.readHeaderFn(dev);
            cfg = cacheHeader(platform, h, cfg);
            // platform.dumpFn will call IO_RESET + initCmds again internally
        }

        const opts = platform.getOptsFromConfig(cfg);
        const rawResult = await platform.dumpFn(
          deviceRef.current,
          opts,
          progressArg => {
            // GB passes a plain number 0-1; others pass { progress, part?, totalParts? }
            const pct = typeof progressArg === 'number'
              ? Math.round(progressArg * 100)
              : progressArg.totalParts != null
                ? Math.round(((progressArg.part + progressArg.progress) / progressArg.totalParts) * 100)
                : Math.round((progressArg.progress ?? 0) * 100);
            setProgress({ phase: `ROM — ${pct}%`, value: pct });
          },
          msg => logLine(msg)
        );

        // Normalise: dump functions return Uint8Array, or { rom, title?, header?, ... }
        const rom         = rawResult instanceof Uint8Array ? rawResult : rawResult.rom;
        const returnedHdr = rawResult?.header ?? null;
        const md5         = md5Hex(rom);

        if (returnedHdr) headersRef.current[platform.id] = returnedHdr;
        const header = headersRef.current[platform.id] ?? null;

        // Post-dump checksum
        // SNES: checksumFn + postDumpLogFn are set in the platform descriptor
        // Genesis: checksum is bundled directly in rawResult from dumpGenesis
        let checksumResult = null;
        if (platform.checksumFn) {
          checksumResult = platform.checksumFn(rom, opts);
          if (platform.postDumpLogFn) platform.postDumpLogFn(checksumResult, logLine);
        } else if (rawResult?.checksumOk !== undefined) {
          checksumResult = {
            stored:   returnedHdr?.storedChecksum,
            computed: rawResult.computed,
            ok:       rawResult.checksumOk,
          };
          const storedHex   = checksumResult.stored?.toString(16).padStart(4, '0').toUpperCase()   ?? '??';
          const computedHex = checksumResult.computed?.toString(16).padStart(4, '0').toUpperCase() ?? '??';
          logLine(
            checksumResult.ok
              ? `Checksum OK: 0x${storedHex}`
              : `Checksum MISMATCH: stored 0x${storedHex}, computed 0x${computedHex}`,
            checksumResult.ok ? 'log-ok' : 'log-warn'
          );
        }

        // Build filename from platform descriptor functions.
        // Some dump functions (e.g. GBA) return a title directly on rawResult
        // rather than a full header object. Merge it as a fallback so the
        // filename doesn't silently degrade when no prior Check was run.
        const effectiveHeader = header ?? (rawResult?.title ? { title: rawResult.title } : null);
        const basename = platform.filenameFn(effectiveHeader, rom, opts);
        const ext      = platform.fileExtFn(header);
        const filename = `${sanitizeFilename(basename)}.${ext}`;

        offerDownload(rom, filename, `${filename}  ·  ${rom.length.toLocaleString()} bytes`);
        logLine(`Dump complete → ${filename}`, 'log-ok');
        setProgress({ phase: 'Done!', value: 100 });

        const dumpResult = { rom, md5, header: returnedHdr, checksum: checksumResult };
        setInfoRows(prev => ({ ...prev, [platform.id]: platform.buildDumpRows(header, dumpResult, opts) }));
      },
      () => setProgress({ phase: 'Error — see log.', value: 0 })
    );
  }

  // ── Flash handler ────────────────────────────────────────────────────────
  // Called by FlashCard.  NES uses MAPPER_FLASH_FN dispatch (same override
  // pattern as dump); SNES uses platform.flashFn = flashSnes.

  async function handleFlash(platform, romFile, flashOpts) {
    await runOp(
      `Starting ${platform.heading} flash…`,
      async () => {
        const romBytes = new Uint8Array(await romFile.arrayBuffer());
        setProgress({ phase: 'Preparing…', value: 0 });

        if (platform.id === 'nes') {
          const cfg    = configsRef.current['nes'];
          const mapper = cfg['mapper'] ?? 'nrom';
          const prgKB  = parseInt(cfg['prg-size'] ?? '32', 10);
          const chrKB  = parseInt(cfg['chr-size'] ?? '8',  10);

          if (!nesMapperSupportsFlash(mapper)) {
            throw new Error(`Flash not supported for mapper: ${mapper.toUpperCase()}`);
          }

          const fn = MAPPER_FLASH_FN[mapper];
          await fn(
            deviceRef.current,
            romBytes,
            { prgKB, chrKB },
            ({ part, totalParts, progress: p }) => {
              setProgress({
                phase: `Flashing — ${Math.round(((part + p) / totalParts) * 100)}%`,
                value: ((part + p) / totalParts) * 100,
              });
            },
            msg => logLine(msg),
          );
        } else if (platform.id === 'snes') {
          const cfg = configsRef.current['snes'];
          const opts = {
            sizeKB:   parseInt(cfg['size'] ?? '2048', 10),
            mapping:  cfg['mapping'] ?? 'LOROM',
            chipType: flashOpts.chipType ?? '5V_PLCC',
          };

          await flashSnes(
            deviceRef.current,
            romBytes,
            opts,
            ({ part, totalParts, progress: p }) => {
              setProgress({
                phase: `Flashing — ${Math.round(((part + p) / totalParts) * 100)}%`,
                value: ((part + p) / totalParts) * 100,
              });
            },
            msg => logLine(msg),
          );
        } else {
          throw new Error(`Flash not implemented for platform: ${platform.id}`);
        }

        setProgress({ phase: 'Flash complete!', value: 100 });
        logLine('Flash complete!', 'log-ok');
      },
      () => setProgress({ phase: 'Flash error — see log.', value: 0 }),
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const activePlatforms = PLATFORMS.filter(p => p.tabId === activeTab);
  const deviceName = deviceRef.current
    ? `${deviceRef.current.manufacturerName} — ${deviceRef.current.productName}`
    : 'Not connected';

  return html`
    <div class="page-wrap">

      <div class="site-header">
        <h1>INL Retro Dumper Programmer</h1>
        <span style="color:#2f9a58;font-size:0.82rem;font-weight:600;letter-spacing:0.05em">DUMPER</span>
      </div>
      <p class="subtitle">
        Chrome / Chromium required &nbsp;·&nbsp; Requires WinUSB driver (Zadig) on Windows
      </p>

      <${DeviceCard}
        connected=${connected}
        deviceName=${deviceName}
        isDumping=${isDumping}
        onConnect=${handleConnect}
        onDisconnect=${handleDisconnect}
      />

      <${TabBar} activeTab=${activeTab} onTab=${setActiveTab} isDumping=${isDumping} />

      ${activePlatforms.map(platform => html`
        <${Fragment} key=${platform.id}>
          <${ConfigCard}
            platform=${platform}
            config=${configs[platform.id] ?? {}}
            onConfigChange=${(fieldId, val) => updateConfig(platform.id, { [fieldId]: val })}
            isDumping=${isDumping}
          />
          <${ActionCard}
            platform=${platform}
            connected=${connected}
            isDumping=${isDumping}
            cartOk=${cartStatus[platform.id] ?? null}
            onCheck=${() => handleTest(platform)}
            onDump=${() => handleDump(platform)}
          />
          ${platform.supportsFlash && html`
            <${FlashCard}
              platform=${platform}
              connected=${connected}
              isDumping=${isDumping}
              onFlash=${(file, opts) => handleFlash(platform, file, opts)}
            />
          `}
          <${InfoPanel} rows=${infoRows[platform.id]} />
        </${Fragment}>
      `)}

      ${activeTab === 'utilities' && html`
        <${N64ConverterCard} isDumping=${isDumping} onDownload=${offerDownload} onLog=${logLine} />
      `}

      <${ProgressCard} isDumping=${isDumping} phase=${progress.phase} value=${progress.value} />
      <${DownloadCard} download=${download} />
      <${LogPanel} lines=${logLines} />

    </div>
  `;
}

// ── Mount ─────────────────────────────────────────────────────────────────────
render(html`<${App} />`, document.getElementById('root'));
