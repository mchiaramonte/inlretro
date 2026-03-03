# INL Retro UI — Electron / Browser-Based Cartridge Dumper

Browser-based and Electron desktop frontend for the [INL Retro USB](https://www.infiniteneslives.com/inlretro.php) cartridge dumper/programmer. Replaces `inlretro.exe` for read operations. Runs as a packaged desktop app (Windows/macOS/Linux) or directly in Chrome.

---

## Contents

- [Requirements](#requirements)
- [Windows: One-Time Driver Setup (Zadig)](#windows-one-time-driver-setup-zadig)
- [Running the App](#running-the-app)
- [Connecting to the Device](#connecting-to-the-device)
- [Supported Systems](#supported-systems)
  - [NES / Famicom](#nes--famicom)
  - [SNES / Super Famicom](#snes--super-famicom)
  - [Game Boy / Game Boy Color](#game-boy--game-boy-color)
  - [Game Boy Advance](#game-boy-advance)
  - [Sega Genesis / Mega Drive](#sega-genesis--mega-drive)
  - [Nintendo 64](#nintendo-64)
- [Desktop App / PWA Installation](#desktop-app--pwa-installation)
- [File Structure](#file-structure)
- [Architecture Overview](#architecture-overview)
  - [USB Protocol](#usb-protocol)
  - [Dictionary System](#dictionary-system)
  - [Dual-Buffer Streaming](#dual-buffer-streaming)
  - [Module API Reference](#module-api-reference)
- [Adding a New Mapper](#adding-a-new-mapper)
- [Adding a New Console](#adding-a-new-console)
- [Known Limitations](#known-limitations)

---

## Requirements

**Desktop app (Electron):**

| Requirement | Notes |
|---|---|
| **Windows, macOS, or Linux** | Download the installer from [GitHub Releases](../../releases) or build with `npm run make` |
| **INL Retro USB device** | VID `0x16C0`, PID `0x05DC` — "INL Retro-Prog" |
| **WinUSB driver on Windows** | One-time setup via Zadig; see below |

**Browser:**

| Requirement | Notes |
|---|---|
| **Chrome or Chromium** | Firefox and Safari do not support WebUSB |
| **Served over `localhost` or `https://`** | WebUSB is blocked on plain `http://` (except localhost) |
| **INL Retro USB device** | Same as above |
| **WinUSB driver on Windows** | Same as above |

---

## Windows: One-Time Driver Setup (Zadig)

Chrome's WebUSB implementation on Windows requires the **WinUSB** kernel driver rather than the default HID or libusb driver. This is a one-time setup per machine.

1. Download [Zadig](https://zadig.akeo.ie/) and run it.
2. Plug in the INL Retro device.
3. In Zadig, go to **Options → List All Devices**.
4. Select **INL Retro-Prog** (or the entry with VID `16C0` / PID `05DC`) from the dropdown.
5. Set the driver on the right to **WinUSB**.
6. Click **Replace Driver** (or **Install Driver** if no driver is currently assigned).
7. Wait for the installation to complete. Chrome should now be able to claim the device.

> **Note:** After installing WinUSB, the device still appears to work perfectly fine with the older inlretro.exe software but you may need to use Zadig to swap the driver back.

---

## Running the App

**Desktop app (Electron):**

Download the installer from [GitHub Releases](../../releases), or build and run locally:

```sh
cd host/inlretro-web
npm install
npm start          # open a dev window
npm run make       # build installer into out/
```

**Browser (Chrome):**

The app cannot be opened as a `file:///` URL — ES modules and the service worker require a server origin. Any static file server works:

```sh
cd host/inlretro-web
python -m http.server 8080
# open http://localhost:8080 in Chrome
```

```sh
npx serve host/inlretro-web
```

---

## Connecting to the Device

**Desktop app:** Plug in the device, then click **Connect**. The app connects directly — no OS permission dialog.

**Browser:** Plug in the device, click **Connect**, then select **INL Retro-Prog** from Chrome's USB device picker.

The status badge turns green when connected. Only one tab or window can hold the device at a time — if the picker shows the device greyed out, close other tabs or the Electron window that has it claimed.

---

## Supported Systems

All consoles follow the same basic workflow:

1. Select the correct tab for your cartridge.
2. *(Optional but recommended)* Click the **Test / Diagnostics** button to read the cartridge header. This validates the connection and auto-fills the size and mapping dropdowns where the header supports it.
3. Adjust the size and mapper/mapping settings if needed.
4. Click **Dump ROM**. Progress is shown in the progress bar and the log.
5. When the dump completes, a **Download** button appears. The filename is derived from the cartridge's internal title when available.

---

### NES / Famicom

**Supported mappers:**

| Dropdown value | iNES Mapper | Notes |
|---|---|---|
| NROM | 0 | 16 KB or 32 KB PRG; 0–8 KB CHR |
| UxROM | 2 | CHR-RAM only; bank table auto-detected |
| CNROM | 3 | Switchable CHR banks |
| MMC1 | 1 | PRG/CHR banking via shift register |
| MMC3 | 4 | Split PRG+CHR banking |
| BxROM / BNROM | 34 | CHR-RAM; bus-conflict-safe via bank table |
| NINA-001 | 34 | CHR-ROM variant; banking at $7FFD–$7FFF |
| FME7 / Sunsoft 5B | 69 | PRG reg 9+A; CHR reg 0+1 |
| MMC2 | 9 | Dual-latch CHR banking |
| MMC4 | 10 | MMC2 variant with 16 KB PRG |
| MMC5 | 5 | 8 KB PRG pages; 8 KB CHR |

**Output format:** iNES 1.0 (`.nes`) with a 16-byte header prepended.

**Settings:**
- **Mapper** — Select the mapper matching the cartridge board.
- **PRG-ROM** — PRG size in KB. Usually printed on the PCB or visible in a database.
- **CHR-ROM** — CHR size in KB. Set to `0 KB (CHR-RAM)` for boards without mask ROM CHR.
- **Mirroring** (Advanced options) — `Vertical` (default) or `Horizontal`. Has no effect on mappers that control mirroring via registers (MMC1, MMC3, MMC5). The test button reads and auto-fills this from hardware.

**Bus-conflict-safe bank switching (UxROM / BxROM):** These mappers have no ROM `/OE` disable line, so the CPU data bus floats to whatever the ROM outputs at the target address. Before dumping, the code searches the fixed bank for an ascending byte sequence `[0, 1, 2, … N-1]` (the "bank table") and writes `bank_number` through that address to avoid bus conflicts. If the bank table is not found, the dump is aborted and an error is logged.

---

### SNES / Super Famicom

**Supported mappings:**

| Mapping | Use |
|---|---|
| LoROM | Most common; ROM banks at `$00–$7D`, bus address `$8000–$FFFF` |
| HiROM | Full 64 KB ROM banks; header at `$FFC0` in bank 0 |
| ExHiROM | Extended HiROM for 6–8 MB ROMs; header at `$40FFC0` |

**Output format:** Raw binary (`.sfc`) — no copier header.

**Header auto-detect:** When you click **Dump ROM** without running the test first, the app reads the SNES internal header at bank 0 / `$FFC0` and auto-fills the mapping and size dropdowns.

**Checksum verification:** After every dump, the app:
1. Reads the stored checksum (`$xxDE–$xxDF`) and complement (`$xxDC–$xxDD`) from the dumped ROM.
2. Recomputes the checksum by summing all ROM bytes with the four header bytes normalised (`0xFF, 0xFF, 0x00, 0x00`).
3. For non-power-of-2 ROM sizes (e.g. 3 MB, 6 MB), mirrors the trailing portion as the SNES hardware does and sums those bytes twice.
4. Logs the result and appends `✓ checksum OK` or `⚠ checksum FAILED` to the download filename info.

A checksum mismatch most commonly means the ROM size or mapping setting is wrong, or the cartridge is not seated properly.

---

### Game Boy / Game Boy Color

**Supported MBC types:**

| MBC | Typical carts |
|---|---|
| ROM Only | Tetris, Dr. Mario, many early titles |
| MBC1 | Super Mario Land, Kirby's Dream Land |
| MBC2 | Pokémon Red/Blue (JP), Final Fantasy Adventure |
| MBC3 | Pokémon Gold/Silver, Link's Awakening DX |
| MBC5 | Pokémon Gold/Silver (international), most late-era GBC |

**Output format:** Raw binary (`.gb` / `.gbc`).

**Auto-detection:** The first time you click **Dump ROM**, the app reads the 80-byte cartridge header at `$0100–$014F`, parses the MBC type byte and ROM size code, and automatically populates the MBC Type and ROM Size dropdowns. The header checksum and Nintendo logo are also validated and logged. Subsequent dumps in the same session skip the header re-read.

The MBC dropdown defaults to `Auto-detect`. If auto-detection fails or the MBC byte is unrecognised, set the type manually.

---

### Game Boy Advance

**Output format:** Raw binary (`.gba`).

**ROM size:** The GBA header does not contain a ROM size field, so the size must be selected manually from the dropdown (256 KB – 32 MB). The most common sizes are 4 MB, 8 MB, and 16 MB.

**Header read:** When **Dump ROM** is first clicked, the app reads the 192-byte GBA ROM header to extract the game title and game code (displayed in the log). The header checksum over those 156 bytes is validated. The title is used as the download filename when available.

**Power-on settling:** GBA ROM chips require approximately 500 ms after 3 V power is applied before reliable reads are possible. The code inserts this delay automatically.

---

### Sega Genesis / Mega Drive

**Output format:** Raw binary (`.md`).

**Header auto-detect:** The Genesis ROM header at `$0100–$01FF` contains the domestic and international game names, serial number, and — critically — the ROM start and end addresses, from which the ROM size is computed. When `Auto-detect from header` is selected, the app reads this header before dumping and sets the ROM size accordingly.

**Checksum verification:** The Genesis header at `$018E–$018F` stores a 16-bit checksum computed as the sum of all 16-bit words from `$0200` to end-of-ROM (the first `$200` bytes are excluded). The app computes and compares this checksum after every dump and logs the result.

---

### Nintendo 64

**Output format:** `.z64` (native big-endian format).

**ROM size:** The N64 header does not include a size field. Select the ROM size manually; common sizes are 4 MB (small titles), 8 MB (typical), 16–32 MB (large titles), and 64 MB (Conker, Resident Evil 2).

**Byte-order detection:** The first dump header word identifies the byte order:
- `80 37 12 40` → `.z64` (native big-endian, ready to use)
- `37 80 40 12` → `.v64` (byte-swapped pairs)
- `40 12 37 80` → `.n64` (little-endian 32-bit)

The test button reports the detected format. The app always produces `.z64` output directly.

**N64 Byte-Order Converter:** The N64 tab includes a built-in converter. Load any `.z64`, `.v64`, or `.n64` file, select the target format, and download the converted file — no dump required.

**Power-on settling:** N64 ROM chips require approximately 2 seconds after the cart is powered before reads are reliable. The code inserts this delay automatically after `N64_INIT`.

---

## Desktop App / PWA Installation

**Electron:** Install the packaged build from [GitHub Releases](../../releases). Works fully offline with no browser required. See [Running the App](#running-the-app) to build locally.

**Browser PWA:** The app includes a service worker (`sw.js`) that caches all assets on first visit. On Chrome for Windows/macOS, the browser will offer to install the app as a standalone PWA, placing a desktop icon that opens the app without browser chrome.

The service worker cache is versioned (`CACHE_NAME` in `sw.js`). Bump the version after updating any cached assets to force clients to re-fetch.

---

## File Structure

```
host/inlretro-web/
├── main.js                 Electron main process (window, app:// protocol, USB permissions)
├── package.json            Electron/forge dependencies and build scripts
├── forge.config.js         electron-forge packaging config
├── index.html              Main UI — tabs, controls, JS module entry point
├── manifest.json           PWA manifest (name, icons, display mode)
├── sw.js                   Service worker — offline caching
├── DUMP_FLOW_REFERENCE.md  Deep-dive USB protocol & per-platform flow reference
├── icons/
│   └── icon.svg            Cartridge icon for PWA install
└── js/
    ├── dict.js             USB constants + InlRetroDevice class
    ├── dump.js             Universal dual-buffer dump engine
    ├── utils.js            sleep() helper
    ├── nrom.js             NES mapper 0 (NROM)
    ├── nes-mappers.js      NES bank-switched mappers (UxROM through MMC5)
    ├── snes.js             SNES dumper + header reader + checksum verifier
    ├── n64.js              N64 dumper + header reader
    ├── gb.js               GB/GBC dumper + header reader
    ├── gba.js              GBA dumper + header reader
    └── genesis.js          Genesis/MD dumper + header reader + checksum verifier
```

---

## Architecture Overview

### USB Protocol

All communication uses **USB vendor control transfers on endpoint 0** — there are no bulk or interrupt endpoints. The transfer fields map directly to the firmware's command dispatch:

```
bmRequestType = 0xC0 (IN)  or  0x40 (OUT)
bRequest      = dictionary ID           (which subsystem to address)
wValue        = (misc << 8) | opcode    (what command to execute)
wIndex        = operand                 (command argument — address, bank, etc.)
wLength       = from RL= comment in firmware headers  (bytes to return)
```

**Response format (IN transfers):**

```
Byte 0:  error code  (0x00 = success)
Byte 1:  data length (number of valid data bytes that follow)
Byte 2…: data bytes
```

`RL=3` in the firmware header comments means the transfer returns 3 bytes total: 1 error + 1 length + 1 data byte. `RL=4` returns 2 data bytes, and so on.

For OUT transfers (writes), no response data is returned — success/failure is signalled only by the USB ACK/NAK.

### Dictionary System

The firmware organises opcodes into **dictionaries** (subsystems). The dictionary ID is passed as `bRequest`. Each dictionary handles a specific hardware domain:

| ID | Name | Purpose |
|---|---|---|
| 2 | IO | Reset, power, platform initialise (NES_INIT, SNES_INIT, …) |
| 3 | NES | CPU/PPU reads and writes, MMC1 shift-register writes |
| 4 | SNES | Bank select, ROM byte read |
| 5 | BUFFER | Firmware buffer allocation and payload retrieval |
| 7 | OPER | Start/stop/query the dump state machine |
| 12 | GAMEBOY | GB address-space reads and writes |
| 13 | GBA | Address latch, bus release, ROM read |
| 14 | SEGA | Genesis bank select |
| 15 | N64 | Bank select, address latch, ROM read |

All constants are defined in `js/dict.js`.

### Dual-Buffer Streaming

Bulk ROM reads use a **double-buffered pipeline** implemented in firmware. The host allocates two 128-byte buffers (`ALLOCATE_BUFFER0`, `ALLOCATE_BUFFER1`), configures the memory type and mapper variant, then starts the dump operation via `SET_OPERATION`. The firmware fills the buffers in alternation while the host reads completed buffers via `BUFF_PAYLOAD` transfers, effectively hiding USB latency behind firmware read time.

The flow in `dumpMemory()` (`js/dump.js`):

```
1. RAW_BUFFER_RESET          — clear any prior buffer state
2. ALLOCATE_BUFFER0/1        — claim two 128 B buffers in firmware SRAM
3. SET_MEM_N_PART (×2)       — tell each buffer what memory type to read
4. SET_MAP_N_MAPVAR (×2)     — tell each buffer the mapper / bank variable
5. SET_RELOAD_PAGENUM0/1     — set interleaved page counter increments
6. SET_OPERATION(STARTDUMP)  — firmware begins filling buffers
7. loop:
     poll GET_CUR_BUFF_STATUS
     when status == DUMPED: read 128 B via BUFF_PAYLOAD
     repeat until all KB read
8. SET_OPERATION(OP_RESET)   — stop dump state machine
```

All platform dumpers call `dumpMemory()` from `dump.js` — none implement their own read loops.

### Module API Reference

#### `js/dict.js` — `InlRetroDevice`

The `InlRetroDevice` class wraps a raw `USBDevice` and exposes dictionary-level methods:

```js
const dev = new InlRetroDevice(usbDevice);

// IO dictionary (platform init, power)
await dev.io(opcode, operand?, misc?)

// NES dictionary
await dev.nesRead(opcode, addr)   → number   // CPU or PPU read
await dev.nesWrite(addr, data)               // CPU write (NES_CPU_WR)
await dev.nesMmc1Write(addr, data)           // shift-register write

// SNES dictionary
await dev.snesSetBank(bank)                  // SNES_SET_BANK
await dev.snesRead(addr)          → number   // SNES_ROM_RD

// Game Boy dictionary
await dev.gameboyWrite(addr, data)

// GBA dictionary
await dev.gbaLatchAddr(addrLow, addrHigh)
await dev.gbaReleaseBus()

// Genesis dictionary
await dev.genSetBank(bank)

// N64 dictionary
await dev.n64SetBank(bank)
await dev.n64LatchAddr(addr)
await dev.n64ReleaseBus()
await dev.n64Read()               → [hi, lo]

// Buffer / OPER dictionaries (used by dump.js internally)
await dev.buffer(opcode, operand?, misc?)
await dev.oper(opcode, operand?, misc?)
await dev.bufferStatus()          → number
await dev.bufferPayloadIn(n)      → Uint8Array
```

#### `js/dump.js` — `dumpMemory`

```js
import { dumpMemory } from './js/dump.js';

const romBytes = await dumpMemory(
  dev,           // InlRetroDevice
  SNESROM,       // memType constant from dict.js
  LOROM,         // mapperVal constant from dict.js
  2048,          // sizeKB
  p => { … }    // onProgress(0..1) — optional
);
// returns Uint8Array of raw ROM bytes
```

#### Per-platform dumpers

All platform dumpers have the same signature:

```js
const result = await dumpXxx(
  usbDevice,     // raw USBDevice (not InlRetroDevice)
  opts,          // platform-specific options object
  onProgress,    // ({ part, totalParts, progress }) => void  — optional
  onLog          // (message, cssClass?) => void              — optional
);
```

| Module | Function | Returns |
|---|---|---|
| `nrom.js` | `dumpNrom(dev, {prgKB, chrKB, mirroring})` | `Uint8Array` (full .nes file) |
| `nes-mappers.js` | `dumpUxRom / dumpCnrom / dumpMmc1 / …(dev, {prgKB, chrKB, mirroring})` | `Uint8Array` (full .nes file) |
| `snes.js` | `dumpSnes(dev, {sizeKB, mapping})` | `Uint8Array` (raw .sfc) |
| `gb.js` | `dumpGb(dev, {mbcType, romSizeKB})` | `{ rom: Uint8Array, title, header }` |
| `gba.js` | `dumpGba(dev, {sizeKB})` | `{ rom: Uint8Array, title }` |
| `genesis.js` | `dumpGenesis(dev, {sizeKB})` | `{ rom, title, header, checksumOk, computed }` |
| `n64.js` | `dumpN64(dev, {sizeKB})` | `Uint8Array` (raw .z64) |

Header readers are also exported from each module:

```js
import { readSnesHeader, verifySnesChecksum } from './js/snes.js';
import { readN64Header   } from './js/n64.js';
import { readGbHeader    } from './js/gb.js';
import { readGbaHeader   } from './js/gba.js';
import { readGenesisHeader } from './js/genesis.js';
```

---

## Adding a New Mapper

NES mapper modules all live in `js/nes-mappers.js`. To add a mapper:

1. Write a `dumpXxxRom(usbDevice, opts, onProgress, onLog)` function following the existing pattern.

   The typical structure:
   ```js
   export async function dumpMyMapper(usbDevice, opts = {}, onProgress, onLog) {
     const { prgKB = 256, chrKB = 0, mirroring = 'VERT' } = opts;
     const dev = new InlRetroDevice(usbDevice);
     const log = onLog ?? (m => console.log('[mymapper]', m));

     await dev.io(IO_RESET);
     await dev.io(NES_INIT);

     // --- Dump PRG-ROM (example: 16 KB banks at $8000) ---
     const prgChunks = [];
     const totalBanks = prgKB / 16;
     for (let bank = 0; bank < totalBanks; bank++) {
       await dev.nesWrite(0x8000, bank);   // select bank (mapper-specific)
       const chunk = await dumpMemory(dev, NESCPU_4KB, 0x08, 16,
         p => onProgress?.({ part: 0, totalParts: 2,
                             progress: (bank + p) / totalBanks }));
       prgChunks.push(chunk);
     }
     const prg = concat(prgChunks);

     // --- Dump CHR-ROM (example: 8 KB banks at PPU $0000) ---
     // … similar loop …

     await dev.io(IO_RESET);
     return concat([buildNesHeader(prgKB, chrKB, MAPPER_NUM, mirroring), prg, chr]);
   }
   ```

   Use `NESCPU_4KB` (4 KB pages, address nibble `$8`–`$F`) or `NESCPU_PAGE` (256 B pages) as the `memType` depending on the banking granularity. Use `NESPPU_1KB` or `NESPPU_PAGE` for CHR.

2. Export the function and add it to the import in `index.html`.

3. Add an `<option>` in the `#nes-mapper` `<select>` element.

4. Add a `case 'mymapper':` branch in the NES dump handler switch statement in `index.html`.

---

## Adding a New Console

1. **Create `js/myconsole.js`** implementing:
   - `readMyConsoleHeader(dev)` — reads the cart header, returns a plain object
   - `dumpMyConsole(usbDevice, opts, onProgress, onLog)` — dumps the ROM, returns `Uint8Array` or `{ rom, title, … }`

2. **Add a tab in `index.html`:**
   - Add a `<button class="tab-btn" data-tab="myconsole">My Console</button>` in `.tab-bar`
   - Add a `<div id="tab-myconsole" class="tab-panel">` with config cards and action buttons

3. **Wire up the event handlers** in the `<script type="module">` block:
   - Import from `./js/myconsole.js`
   - Add Test and Dump button listeners following the existing pattern (connect → header read → dump → checksum verify → `offerDownload`)

4. **Update `sw.js`** — add `'./js/myconsole.js'` to the `ASSETS` array and bump `CACHE_NAME`.

---

## Known Limitations

- **Read-only.** The web frontend currently supports dumping (reading) only. Flash programming is not implemented.
- **Browser mode: Chrome / Chromium only.** WebUSB is not supported in Firefox or Safari. The Electron desktop app has no browser restriction.
- **Windows requires the Zadig driver swap.** Applies to both the Electron app and the browser — the device cannot share the WinUSB driver with `inlretro.exe`.
- **One connection at a time.** Only one browser tab or Electron window can hold the USB device. If the device is unresponsive, close other tabs or restart the app.
- **NES mapper detection is manual.** Unlike SNES / GB / Genesis, the NES cartridge header does not identify itself over the bus; the mapper must be selected from the dropdown.
- **GBA ROM size is manual.** The GBA ROM header contains a title and checksum but no ROM size field; the size must be chosen from the dropdown.
- **No SRAM / save data access.** Battery-backed SRAM read/write is not implemented.
- **No ExHiROM test.** `readSnesHeader` reads bank 0 only; for ExHiROM the header is in bank `$40`. Running the Test button on an ExHiROM cart will show junk title data but the Dump button will use the correct header location.

---

## Further Reading

See [`DUMP_FLOW_REFERENCE.md`](./DUMP_FLOW_REFERENCE.md) for an in-depth reference covering:

- Detailed USB packet structure and response decoding
- Complete per-platform dump flows with annotated opcode sequences
- iNES 1.0 header byte layout
- SNES, Genesis, N64, and GB internal header formats
- Checksum algorithm details
- Flash/write operation flow (inverse of dump)
