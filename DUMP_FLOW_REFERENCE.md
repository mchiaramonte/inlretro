# INL Retro Dump Flow Reference

Derived from the Lua host implementation in `host/scripts/`. This documents the exact
sequence of USB operations used to dump each supported platform, and is intended as the
ground truth for the WebUSB port. This is based on a scan of the original code done by Claude.

---

## Architecture

### USB Communication Layer (`host/scripts/app/dict.lua`)

All communication is via vendor control transfers on EP0.

```
bRequest = dictionary ID         (e.g., DICT_IO=2, DICT_NES=3)
wValue   = (misc << 8) | opcode  (misc usually 0)
wIndex   = operand               (usually 0)
wLength  = from RL= comment in shared_dict_*.h (default 1)
```

IN transfer (device→host): positive RL
OUT transfer (host→device): negative RL
Response format for IN: `[error_code(1B), data_length(1B), data…]` — error `0x00` = OK

### Dictionary IDs

| ID | Name        |
|----|-------------|
| 1  | PINPORT     |
| 2  | IO          |
| 3  | NES         |
| 4  | SNES        |
| 5  | BUFFER      |
| 6  | USB         |
| 7  | OPER        |
| 12 | GAMEBOY     |
| 13 | GBA         |
| 14 | SEGA        |
| 15 | N64         |

### Dual-Buffer Streaming (`host/scripts/app/buffers.lua`)

The device keeps two hardware buffers (buff0, buff1). During a dump the firmware
continuously fills one buffer while the host drains the other:

1. Firmware: fills buff → marks status `DUMPED`
2. Host: polls `GET_CUR_BUFF_STATUS`; when `DUMPED`, reads payload with `BUFFER_PAYLOAD_IN`
3. Firmware simultaneously fills the other buffer → zero-wait pipeline

Buffer sizes: 128 B reads, 256 B writes (flash).
Buffer states: `EMPTY → DUMPING → DUMPED → USB_UNLOADING → EMPTY`

### Universal `dumptocallback()` Skeleton

Every platform's ROM read loop calls this function from `host/scripts/app/dump.lua`:

```
1.  OPER: SET_OPERATION(RESET)
2.  BUFFER: RAW_BUFFER_RESET
3.  BUFFER: allocate 2×128 B buffers (buff0, buff1)
4.  BUFFER: SET_MEM_N_PART( (mem_type<<8)|MASKROM, buff0 )
5.  BUFFER: SET_MEM_N_PART( (mem_type<<8)|MASKROM, buff1 )
6.  BUFFER: SET_MAP_N_MAPVAR( (mapper<<8)|mapvar, buff0 )
7.  BUFFER: SET_MAP_N_MAPVAR( (mapper<<8)|mapvar, buff1 )
8.  OPER:   SET_OPERATION(STARTDUMP)
9.  for i = 1 to (totalBytes / 128):
        poll GET_CUR_BUFF_STATUS until DUMPED
        BUFFER: BUFFER_PAYLOAD_IN(128 B)  → append to output file
10. OPER: SET_OPERATION(RESET)
11. BUFFER: RAW_BUFFER_RESET
```

Steps 4–7 tell the firmware which memory type and which mapper the buffers represent; the
firmware handles all electrical signalling, bank-switching timing, and address
auto-increment internally.

---

## NES / Famicom

**Scripts:** `host/scripts/app/nes.lua`, `host/scripts/nes/<mapper>.lua`

### 1. Initialization

```
IO: IO_RESET
IO: NES_INIT          -- configure address/data/control pin directions
```

Read the mirroring jumper state to determine H/V/4-screen/fixed.

### 2. Flash ID Test (if writing, not reading)

```
NES: NES_CPU_WR $5555 0xAA   -- unlock flash sequence
NES: NES_CPU_WR $2AAA 0x55
NES: NES_CPU_WR $5555 0x90   -- product ID mode
NES: NES_CPU_RD $0000        -- manufacturer ID
NES: NES_CPU_RD $0002        -- product ID
NES: NES_CPU_WR $5555 0xF0   -- reset flash
```

### 3. Mapper Setup (mapper-specific writes)

Example — MMC3:

```
NES: NES_CPU_WR $A001 0x40   -- disable WRAM
NES: NES_CPU_WR $A000 0x00   -- vertical mirroring
NES: NES_CPU_WR $8000 0x06   -- bank reg select: PRG bank 0 ($8000)
NES: NES_CPU_WR $8001 <bank> -- load bank number
NES: NES_CPU_WR $8000 0x07   -- bank reg select: PRG bank 1 ($A000)
NES: NES_CPU_WR $8001 <bank>
```

NROM carts require no setup (fixed 32 KB PRG + 8 KB CHR).

### 4. PRG-ROM Dump

Repeat for each 16 KB (or 8 KB) PRG bank:

```
NES: NES_CPU_WR $8000 <reg_select>   -- select bank register
NES: NES_CPU_WR $8001 <bank_num>     -- load bank
dumptocallback(16 KB, mapper=NESCPU_4KB, mem=PRGROM)
```

`NESCPU_4KB` tells the firmware to read from CPU address space in 4 KB pages
(`$8000–$FFFF` for 32 KB fixed, `$8000–$9FFF` per bank for banked).

### 5. CHR-ROM Dump

Repeat for each 8 KB CHR bank:

```
NES: NES_CPU_WR $8000 <chr_reg>
NES: NES_CPU_WR $8001 <chr_bank>
dumptocallback(8 KB, mapper=NESPPU_1KB, mem=CHRROM)
```

The firmware reads from PPU address space `$0000–$1FFF` (8 KB), auto-incrementing
through 1 KB pages as the mapper variable dictates.

### 6. iNES Header Construction

```
Bytes 0–3:  "NES\x1A"
Byte  4:    PRG size in 16 KB units
Byte  5:    CHR size in 8 KB units
Byte  6:    flags6  (mapper lo-nibble, mirroring, battery, trainer, 4-screen)
Byte  7:    flags7  (console type, mapper hi-nibble)
Bytes 8–15: NES 2.0 extended (mapper MSB/submapper, VROM/EEPROM sizes, timing)
```

The header is prepended to the ROM dump in memory before writing to disk.

---

## Super Nintendo / Super Famicom

**Scripts:** `host/scripts/app/snes.lua`, `host/scripts/snes/v3.lua`

### 1. Initialization

```
IO: IO_RESET
IO: SNES_INIT         -- configure pin directions for 16-bit cartridge bus
SNES: SNES_SET_RST 1  -- release reset (play mode)
```

### 2. ROM Type Detection

Read the reset vector area in multiple banks to distinguish LoROM from HiROM:

- LoROM internal header: `$00:7FB0–$00:7FFF`  (also mirrored at `$00:FFB0–$FF`)
- HiROM internal header: `$00:FFB0–$00:FFFF`

Mapper byte at header offset `+0x15`:
- `0x20` = LoROM, `0x21` = HiROM, `0x25` = ExHiROM, etc.

### 3. ROM Dump

ROM is dumped in 2 MB segments. Bank numbering (LoROM example):

```
For each 2 MB segment (bank_base = 0x00, 0x20, 0x40, 0x60, …):
    SNES: SNES_SET_BANK bank_base
    SNES: SNES_SET_RST 1            -- play mode
    dumptocallback(2048 KB, mapper=LOROM, mem=SNESROM)
```

The firmware maps LoROM banks: each 32 KB bank occupies `$8000–$FFFF` in the 64 KB bank
window. HiROM uses the full `$0000–$FFFF` window per bank.

`SNES_SET_BANK` sets the upper address lines (A16–A23). The firmware auto-increments
A0–A15 as data is clocked out.

### 4. Internal Header Fields

Located at ROM byte offset `0x7FB0` (LoROM) or `0xFFB0` (HiROM):

| Offset | Length | Field |
|--------|--------|-------|
| +0x00  | 21 B   | Game title (ASCII) |
| +0x15  | 1 B    | Mapper mode byte |
| +0x16  | 1 B    | ROM type (ROM/RAM/SRAM/coprocessor) |
| +0x17  | 1 B    | ROM size (1 << n KB) |
| +0x18  | 1 B    | SRAM size (1 << n KB) |
| +0x19  | 1 B    | Region code |
| +0x1C  | 2 B    | Complement checksum |
| +0x1E  | 2 B    | Checksum |

The dumper validates the checksum after collecting the full ROM.

---

## Game Boy / Game Boy Color

**Scripts:** `host/scripts/gb/romonly.lua` (MBC carts partially supported)

### 1. Initialization

```
IO: IO_RESET
IO: GAMEBOY_INIT      -- configure GB cartridge bus
IO: GB_POWER_5V       -- DMG/GBC use 5 V (GBA: 3.3 V)
```

### 2. ROM Dump (ROM-only / 32 KB)

```
dumptocallback(32 KB, mapper=ROMONLY, mem=GAMEBOY_ROM)
```

The firmware reads the full 16-bit address space visible to the GB cartridge slot:

| Address | Content |
|---------|---------|
| `$0000–$3FFF` | Fixed ROM bank 0 |
| `$4000–$7FFF` | Switchable bank (always bank 1 for ROM-only) |

For MBC carts the host must write the bank register before each 16 KB chunk:

```
For each bank n (1…N-1):
    GB: GAMEBOY_WR $2000 n    -- MBC1/MBC5 ROM bank register
    dumptocallback(16 KB, mapper=MBC5, mem=GAMEBOY_ROM)
```

Bank 0 (`$0000–$3FFF`) is always read first as a fixed window.

### 3. SRAM Dump (MBC carts with battery)

```
GB: GAMEBOY_WR $0000 0x0A     -- enable SRAM
For each SRAM bank n:
    GB: GAMEBOY_WR $4000 n    -- select SRAM bank (MBC1)
    dumptocallback(8 KB, mapper=…, mem=GAMEBOY_RAM)
GB: GAMEBOY_WR $0000 0x00     -- disable SRAM
```

### 4. Header

Located at `$0100–$014F` in the ROM dump:

| Offset | Field |
|--------|-------|
| `$0100` | Entry point (NOP + JP) |
| `$0104` | Nintendo logo (48 B) |
| `$0134` | Title (15 B) |
| `$0143` | CGB flag |
| `$0147` | Cartridge type (ROM/MBC1/MBC5…) |
| `$0148` | ROM size code |
| `$0149` | SRAM size code |
| `$014E` | Header checksum |

---

## Game Boy Advance

**Scripts:** `host/scripts/gba/basic.lua`

### 1. Initialization

```
IO: IO_RESET
IO: GBA_INIT          -- configure 24-bit address, 16-bit data bus
IO: GB_POWER_3V       -- GBA cartridge is 3.3 V
```

### 2. ROM Dump

GBA ROM is a flat 32 MB space (no bank-switching register). The host sets the base
address in 128 KB increments; the firmware auto-increments from there.

```
For each 128 KB chunk (addr_hi = 0x00, 0x02, 0x04, …, 0xFF):
    GBA: GBA_LATCH_ADDR_LO 0x0000        -- reset lower 16-bit address
    GBA: GBA_LATCH_ADDR_HI addr_hi       -- set A16–A23
    dumptocallback(128 KB, mapper=0, mem=GBA_ROM)
    GBA: GBA_RELEASE_BUS                 -- release bus after chunk
```

The physical GBA ROM window starts at `0x0800_0000` in the GBA address map; the device
translates automatically. Reads are 16-bit; bytes are stored little-endian.

### 3. Save Data

Save types (EEPROM, SRAM, Flash 64K/128K) are detected from the ROM header or by
scanning the binary for save-type signature strings. Each type uses a distinct
dump procedure (not part of the core ROM dump flow).

### 4. Header (first 192 bytes of ROM)

| Offset | Field |
|--------|-------|
| `0x00`  | Entry point |
| `0x04`  | Nintendo logo (156 B) |
| `0xA0`  | Game title (12 B) |
| `0xAC`  | Game code (4 B) |
| `0xB2`  | Fixed value `0x96` |
| `0xBD`  | Header checksum |

---

## Sega Genesis / Mega Drive

**Scripts:** `host/scripts/sega/genesis_v1.lua`

### 1. Initialization

```
IO: IO_RESET
IO: SEGA_INIT         -- configure 16-bit data bus, 24-bit address, /CE /OE /WE
```

### 2. Internal Header Read & Validation

Read bytes `$100–$1FF` from bank 0:

```
SEGA: GEN_SET_BANK 0
SEGA: GEN_RD $0100 … $01FF
```

Key header fields:

| Offset | Length | Field |
|--------|--------|-------|
| `$100` | 16 B   | Console name ("SEGA GENESIS    " or "SEGA MEGA DRIVE ") |
| `$110` | 16 B   | Copyright string |
| `$120` | 48 B   | Domestic game name |
| `$150` | 48 B   | Overseas game name |
| `$180` | 14 B   | Serial / version |
| `$18E` | 2 B    | Checksum (big-endian) |
| `$1A0` | 4 B    | ROM start address |
| `$1A4` | 4 B    | ROM end address → derive size |

ROM size = (end\_addr − start\_addr + 1). Divided by 131072 gives the number of 128 KB banks.

### 3. ROM Dump

```
For each 128 KB bank n (0 … N-1):
    SEGA: GEN_SET_BANK n
    dumptocallback(64 KB, mapper=0, mem=GENESIS_ROM_PAGE0)   -- even words
    dumptocallback(64 KB, mapper=0, mem=GENESIS_ROM_PAGE1)   -- odd words
```

The Genesis has a 16-bit data bus. The device reads two 64 KB pages per bank:
- `PAGE0` = even bytes (D0–D7)
- `PAGE1` = odd bytes (D8–D15)

These are interleaved by the host into the final 128 KB chunk before writing to disk.

### 4. Checksum Verification

```
computed = 0
for each 16-bit big-endian word from offset $200 onward:
    computed = (computed + word) & 0xFFFF
compare computed vs header word at $18E
```

---

## Nintendo 64

**Scripts:** `host/scripts/n64/basic.lua`

### 1. Initialization

```
IO: IO_RESET
IO: N64_INIT          -- configure 16-bit data bus, 32-bit address (banked)
```

### 2. Header Read (optional sanity check)

```
N64: N64_SET_BANK 0x1000        -- base bank for ROM ($1000_0000 physical)
N64: N64_LATCH_ADDR 0x0020      -- word offset into bank for title
for i = 0 to 15:
    N64: N64_RD → 16-bit big-endian word
    header[i*2]   = word >> 8
    header[i*2+1] = word & 0xFF
```

The ROM header (first 64 bytes) contains PI BSD domain settings, clock rate, entry point,
release date, CRC1, CRC2, and game title at offset `$20`.

### 3. ROM Dump

N64 ROMs are dumped in 64 KB banks. The device maps bank numbers to physical addresses:

```
bank_base = 0x1000       -- ROM base in device bank numbering
For each 64 KB bank n (0 … N-1):
    N64: N64_SET_BANK (bank_base + n)
    dumptocallback(64 KB, mapper=0, mem=N64_ROM)
    N64: N64_RELEASE_BUS
```

Data is returned as 16-bit big-endian words, matching the `.z64` byte-order format
(big-endian). If a `.n64` (little-endian) or `.v64` (byte-swapped) output is needed,
the host swaps after the fact.

### 4. ROM Size Detection

Size is not stored in the header. Options:
1. Read the header CRC and compare against a known-good database.
2. Use a fixed size passed in by the user / script (common sizes: 4, 8, 16, 32, 64 MB).
3. Scan for repeating patterns at power-of-two boundaries (not implemented in basic.lua).

---

## Flash / Write Flow (all platforms)

Writing follows the inverse of dumping. From `host/scripts/app/flash.lua`:

```
1.  OPER: SET_OPERATION(RESET)
2.  BUFFER: RAW_BUFFER_RESET
3.  BUFFER: allocate 2×256 B buffers
4.  BUFFER: SET_MEM_N_PART( (mem_type<<8)|MASKROM, buff0/buff1 )
5.  BUFFER: SET_MAP_N_MAPVAR( (mapper<<8)|NOVAR, buff0/buff1 )
6.  OPER: SET_OPERATION(STARTFLASH)
7.  for each 256 B chunk from file:
        BUFFER: BUFFER_PAYLOAD_OUT(256 B, data)   -- host→device
        poll GET_CUR_BUFF_STATUS until EMPTY
8.  wait both buffers reach EMPTY or FLASHED
9.  OPER: SET_OPERATION(RESET)
10. BUFFER: RAW_BUFFER_RESET
```

The firmware handles the flash unlock sequence (standard JEDEC / SST:
`$5555←0xAA`, `$2AAA←0x55`, `$5555←0xA0`, then data byte).

---

## Quick Reference Table

| Platform | ROM Size (max) | Bank Unit | Dump Buffer | Bank Register | Data Bus |
|----------|---------------|-----------|-------------|---------------|----------|
| NES PRG  | 512 KB        | 8–16 KB   | 128 B       | CPU write $8000/$8001 | 8-bit |
| NES CHR  | 512 KB        | 8 KB      | 128 B       | CPU write $8000/$8001 | 8-bit |
| SNES     | ~12 MB        | 2 MB      | 128 B       | SNES_SET_BANK | 8-bit (×2) |
| GB/GBC   | 8 MB          | 16 KB     | 128 B       | Cart WR $2000 | 8-bit |
| GBA      | 32 MB         | 128 KB    | 128 B       | LATCH_ADDR_HI | 16-bit |
| Genesis  | ~4 MB         | 128 KB    | 128 B       | GEN_SET_BANK | 16-bit (×2 pages) |
| N64      | 64 MB         | 64 KB     | 128 B       | N64_SET_BANK | 16-bit |
