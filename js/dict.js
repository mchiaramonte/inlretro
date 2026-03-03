/**
 * dict.js — INL Retro WebUSB protocol constants and device wrapper.
 *
 * Mirrors the Lua dict.lua / shared C header system.
 *
 * USB control transfer packet format (from dict.lua):
 *   bRequest = dictionary ID        (selects the subsystem)
 *   wValue   = (misc << 8) | opcode (misc usually = buffer number or 0)
 *   wIndex   = operand              (address / parameter)
 *   wLength  = from RL= comment in shared_dict_*.h (default 1)
 *
 * Response format for standard IN transfers (RL > 1):
 *   byte 0: error code   (0x00 = SUCCESS)
 *   byte 1: data length  (how many data bytes follow)
 *   byte 2+: data bytes
 *
 * Payload IN transfers (BUFF_PAYLOAD) return raw bytes with no header.
 */

// ============================================================
// Dictionary IDs — bRequest values  (shared/shared_dictionaries.h)
// ============================================================
export const DICT_PINPORT = 1;  // pin/port control (CTL_SET_LO, CTL_SET_HI, …)
export const DICT_IO      = 2;
export const DICT_NES     = 3;
export const DICT_SNES    = 4;
export const DICT_BUFFER  = 5;
export const DICT_OPER    = 7;
export const DICT_GAMEBOY = 12;
export const DICT_GBA     = 13;
export const DICT_SEGA    = 14;
export const DICT_N64     = 15;

// ============================================================
// IO opcodes  (shared/shared_dict_io.h)
// ============================================================
export const IO_RESET      = 0x00;  // RL=1  — put GPIO in safe pull-up state
export const NES_INIT      = 0x01;  // RL=1  — configure pins for NES cartridge
export const SNES_INIT     = 0x02;  // RL=1  — configure pins for SNES cartridge
export const GAMEBOY_INIT  = 0x05;  // RL=1  — configure pins for GB/GBC cartridge
export const GBA_INIT      = 0x06;  // RL=1  — configure pins for GBA cartridge
export const SEGA_INIT     = 0x07;  // RL=1  — configure pins for Genesis/MD cartridge
export const N64_INIT      = 0x08;  // RL=1  — configure pins for N64 cartridge
export const GB_POWER_5V   = 0x09;  // RL=1  — set cartridge power to 5V (GB/GBC)
export const GB_POWER_3V   = 0x0A;  // RL=1  — set cartridge power to 3.3V (GBA)

// ============================================================
// PINPORT opcodes  (shared/shared_dict_pinport.h)
// ============================================================
export const CTL_SET_LO = 4;  // RL=1, operand=pin — drive pin low
export const CTL_SET_HI = 5;  // RL=1, operand=pin — drive pin high
export const CTL_RD     = 6;  // RL=4, operand=pin → [error, data_len, LSB, MSB]
export const ADDR_SET   = 17; // RL=1, operand=16-bit address — latch address bus
export const SNES_RST   = 8;  // SNES /RST pin (same physical pin as EXP0/C8)
export const CIA10      = 11; // CIRAM A10 pin — NES nametable mirror select

// ============================================================
// NES opcodes  (shared/shared_dict_nes.h)
// ============================================================
export const DISCRETE_EXP0_PRGROM_WR = 0x00;  // RL=1, misc=data, operand=addr — PRG flash write (no /ROMSEL)
export const NES_PPU_WR              = 0x01;  // RL=1, misc=data, operand=addr — CHR bus write (flash unlock)
export const NES_CPU_RD  = 0x81;  // RL=3, operand=address — read one byte from CPU bus
export const NES_PPU_RD  = 0x82;  // RL=3, operand=address — read one byte from PPU bus
export const NES_CPU_WR  = 0x02;  // RL=1, misc=data, operand=address — write with M2 toggle
export const NES_MMC1_WR = 0x04;  // RL=1, misc=data, operand=address — MMC1 shift-register write
export const SET_CUR_BANK   = 0x20;  // RL=1, operand=bank — set current PRG bank (UxROM/buffer flash)
export const SET_BANK_TABLE = 0x21;  // RL=1, operand=addr — set UxROM bank-table base address

// ============================================================
// SNES opcodes  (shared/shared_dict_snes.h)
// ============================================================
export const SNES_SET_BANK = 0x00;  // RL=1, operand=bank (A16-A23)
export const SNES_ROM_RD   = 0x01;  // RL=3, operand=address (A0-A15), /ROMSEL low
export const SNES_ROM_WR   = 0x02;  // RL=1, misc=data, operand=address — SNES ROM write (flash sequences)

// ============================================================
// GAMEBOY opcodes  (shared/shared_dict_gameboy.h)
// ============================================================
export const GAMEBOY_RD = 0x00;  // RL=3, operand=address — read one byte from GB bus
export const GAMEBOY_WR = 0x01;  // RL=1, misc=data, operand=address — write one byte

// ============================================================
// GBA opcodes  (shared/shared_dict_gba.h)
// ============================================================
// LATCH_ADDR: operand=A0–A15 (low 16 bits), misc=A16–A23 (bank).
// Must be called before each dumpMemory() call for GBA_ROM_PAGE because
// the GBA ROM auto-increments its internal address counter on every read;
// re-latching at the start of each 128 KB chunk keeps the host and firmware aligned.
export const GBA_LATCH_ADDR  = 0x02;  // RL=1
export const GBA_RELEASE_BUS = 0x03;  // RL=1 — release ALE lines after each chunk

// ============================================================
// SEGA opcodes  (shared/shared_dict_sega.h)
// ============================================================
// operand = A17–A23 bank index (0 = first 128 KB of ROM)
export const GEN_SET_BANK = 0x02;  // RL=1

// ============================================================
// N64 opcodes  (shared/shared_dict_n64.h)
// ============================================================
export const N64_RD          = 0x00;  // RL=4, returns [error, len, D8-15, D0-7] (16-bit word, auto-increments addr)
export const N64_SET_BANK    = 0x02;  // RL=1, operand = A16-A31 (upper address, e.g. 0x1000 for ROM start)
export const N64_LATCH_ADDR  = 0x03;  // RL=1, operand = A0-A15  (A0 ignored by ROM — 16-bit bus)
export const N64_RELEASE_BUS = 0x04;  // RL=1, release ALE_L/H — must call after each bank dump

// ============================================================
// OPER opcodes  (shared/shared_dict_operation.h)
// ============================================================
export const SET_OPERATION = 0x00;  // RL=1, operand = operation value
export const GET_OPERATION = 0x40;  // RL=3, returns current operation value

// ============================================================
// BUFFER opcodes  (shared/shared_dict_buffer.h)
// ============================================================
export const RAW_BUFFER_RESET    = 0x00;  // RL=1 — clear all buffer allocations

export const SET_MEM_N_PART      = 0x30;  // RL=1, misc=buffN, operand=(memType<<8)|partNum
export const SET_MAP_N_MAPVAR    = 0x32;  // RL=1, misc=buffN, operand=(mapper<<8)|mapvar
export const ALLOCATE_BUFFER0    = 0x80;  // RL=1, misc=numBanks, operand=(id<<8)|baseBank
export const ALLOCATE_BUFFER1    = 0x81;
export const SET_RELOAD_PAGENUM0 = 0x90;  // RL=1, misc=reload, operand=firstPage
export const SET_RELOAD_PAGENUM1 = 0x91;
export const GET_CUR_BUFF_STATUS = 0x61;  // RL=3 — poll the current buffer's status
export const GET_PRI_ELEMENTS    = 0x50;  // RL=8, misc=buffN — [err,len,lastIdx,status,byte,reload,id,fn]
export const BUFF_PAYLOAD        = 0x70;  // raw payload IN (no error/length header)
export const BUFF_OUT_PAYLOAD_2B_INSP = 0x71;  // OUT: operand=(byte1<<8)|byte0, data=bytes[2..255]

// ============================================================
// SET_MEM_N_PART operand MSB — memory type
// ============================================================
export const PRGROM       = 0x10;
export const CHRROM       = 0x11;
export const SNESROM      = 0x13;  // SNES ROM (buffer system manages bank/address)
// Address-explicit read types — the mapper field carries the page address directly,
// not a mapper number. These are what the production nrom.lua scripts use.
export const NESCPU_4KB   = 0x20;  // mapper bits 3-0 = A15:A12  (e.g. 0x08 → $8000)
export const NESPPU_1KB   = 0x21;  // mapper bits 5-2 = A13:A10  (e.g. 0x00 → $0000)
export const NESCPU_PAGE  = 0x22;  // mapper byte = A15:A8       (e.g. 0x80 → $8000); reads in 256B pages
export const NESPPU_PAGE  = 0x23;  // mapper byte = A13:A8       (e.g. 0x00 → $0000); reads in 256B pages; bits 6-7 must be 0
// GAMEBOY_PAGE mapper field = high byte of the starting address:
//   0x00 → reads from $0000 (bank 0, $0000–$3FFF or full 32 KB for ROM-only)
//   0x40 → reads from $4000 (switchable bank window, $4000–$7FFF)
export const GAMEBOY_PAGE = 0x26;
// GBA_ROM_PAGE: address is latched externally via GBA_LATCH_ADDR; mapper field = 0
export const GBA_ROM_PAGE      = 0x27;
// GENESIS: bank (A17–A23) set via GEN_SET_BANK; PAGE0=A16 low, PAGE1=A16 high
export const GENESIS_ROM_PAGE0 = 0x28;
export const GENESIS_ROM_PAGE1 = 0x29;
export const N64_ROM_PAGE      = 0x30;  // N64 ROM page read — firmware uses current bank + page_num for address
export const MASKROM      = 0xDD;  // part_num: mask ROM (read-only)

// ============================================================
// SET_MAP_N_MAPVAR operand MSB — mapper number / SNES mapping
// ============================================================
export const NROM    = 0;
export const NOVAR   = 0;  // no mapper variant

// NES mapper IDs (used as mapperVal with PRGROM/CHRROM mem type)
export const MMC1_MAPPER  = 1;
export const UXROM_MAPPER = 2;
export const CNROM_MAPPER = 3;
export const MMC3_MAPPER  = 4;
export const MMC4_MAPPER  = 10;
export const BXROM_MAPPER = 34;
export const FME7_MAPPER  = 69;
export const GTROM_MAPPER = 111;  // INL GTROM (shared_dict_buffer.h: #define GTROM 111)

// SNES mapping modes (used as mapperVal with SNESROM mem type)
export const LOROM      = 0;  // LoROM: 32KB ROM per bank, $8000-$FFFF (3V TSSOP flash mode)
export const HIROM      = 1;  // HiROM: 64KB ROM per bank, $0000-$FFFF (3V TSSOP flash mode)
export const EXHIROM    = 2;  // ExHiROM: extended HiROM (e.g. Chrono Trigger), banks start at $C0
export const LOROM_5VOLT = 4; // LoROM 5V PLCC flash (host must set bank before each 32KB chunk)
export const HIROM_5VOLT = 5; // HiROM 5V PLCC flash (host must set bank before each 64KB chunk)
export const LOROM_3VOLT = 6; // LoROM 3V TSSOP flash (firmware handles bank auto-increment)
export const HIROM_3VOLT = 7; // HiROM 3V TSSOP flash (firmware handles bank auto-increment)

// ============================================================
// Buffer/operation status values  (shared_dict_buffer.h)
// These are used both as operands to SET_OPERATION and as
// status values returned by GET_CUR_BUFF_STATUS / GET_PRI_ELEMENTS.
// ============================================================
export const EMPTY      = 0x00;  // buffer ready to receive (flash) or fill (dump)
export const OP_RESET   = 0x01;  // reset buffer manager state
export const STARTFLASH = 0xF2;  // arm flash-write operation
export const FLASHED    = 0xF4;  // buffer has been programmed to flash chip
export const STARTDUMP  = 0xD2;  // kick off dump operation
export const DUMPED     = 0xD8;  // buffer is full and ready to read out

// ============================================================
// Buffer geometry  (shared_dict_buffer.h)
// ============================================================
export const RAW_BANK_SIZE = 32;  // bytes per raw bank on the device

// ============================================================
// Device identity
// ============================================================
export const VID = 0x16C0;
export const PID = 0x05DC;

// ============================================================
// InlRetroDevice — thin WebUSB wrapper over the dictionary protocol.
// Accepts an already-opened, interface-claimed USBDevice.
// ============================================================
export class InlRetroDevice {
  constructor(usbDevice) {
    this.dev = usbDevice;
  }

  /**
   * Low-level IN control transfer.
   * Returns a Uint8Array of `wLength` bytes from the device.
   */
  async _in(dictId, opcode, operand, misc, wLength) {
    const r = await this.dev.controlTransferIn({
      requestType: 'vendor',
      recipient:   'device',
      request:     dictId,
      value:       ((misc & 0xFF) << 8) | (opcode & 0xFF),
      index:       operand & 0xFFFF,
    }, wLength);

    if (r.status !== 'ok') {
      throw new Error(`USB IN failed (status=${r.status}, dict=${dictId}, op=0x${opcode.toString(16)})`);
    }
    return new Uint8Array(r.data.buffer);
  }

  /**
   * Standard dictionary call: RL=1 (device returns 1 error byte).
   * Throws if the device reports a non-zero error code.
   */
  async _cmd(dictId, opcode, operand = 0, misc = 0) {
    const b = await this._in(dictId, opcode, operand, misc, 1);
    if (b[0] !== 0x00) {
      throw new Error(
        `Device error 0x${b[0].toString(16).padStart(2, '0')} ` +
        `(dict=${dictId}, op=0x${opcode.toString(16).padStart(2, '0')})`
      );
    }
  }

  /**
   * Query call: RL=3 (device returns [error, dataLen, value]).
   * Returns the single data byte, or throws on error.
   */
  async _query(dictId, opcode, operand = 0, misc = 0) {
    const b = await this._in(dictId, opcode, operand, misc, 3);
    if (b[0] !== 0x00) {
      throw new Error(
        `Device error 0x${b[0].toString(16).padStart(2, '0')} ` +
        `(dict=${dictId}, op=0x${opcode.toString(16).padStart(2, '0')})`
      );
    }
    return b[2];  // actual data byte
  }

  // ---- Dictionary-level convenience methods ----

  /** IO dictionary call (RL=1). */
  async io(opcode, operand = 0, misc = 0) {
    return this._cmd(DICT_IO, opcode, operand, misc);
  }

  /** OPER dictionary call (RL=1). */
  async oper(opcode, operand = 0, misc = 0) {
    return this._cmd(DICT_OPER, opcode, operand, misc);
  }

  /** BUFFER dictionary call (RL=1). */
  async buffer(opcode, operand = 0, misc = 0) {
    return this._cmd(DICT_BUFFER, opcode, operand, misc);
  }

  /**
   * Poll GET_CUR_BUFF_STATUS (RL=3).
   * Returns the raw status byte (e.g. DUMPED=0xD8).
   */
  async bufferStatus() {
    return this._query(DICT_BUFFER, GET_CUR_BUFF_STATUS);
  }

  /**
   * Read one byte from the NES CPU or PPU bus (RL=3).
   * opcode: NES_CPU_RD (0x81) or NES_PPU_RD (0x82)
   * operand: 16-bit address
   * Returns the byte value.
   */
  async nesRead(opcode, operand) {
    return this._query(DICT_NES, opcode, operand);
  }

  /**
   * Set the SNES bank address (A16-A23).
   * Must be called before snesRead() to select the desired bank.
   */
  async snesSetBank(bank) {
    return this._cmd(DICT_SNES, SNES_SET_BANK, bank);
  }

  /**
   * Read one byte from the SNES bus at the given 16-bit address (RL=3).
   * /ROMSEL is forced low — reads the ROM chip directly regardless of mapping.
   * operand: 16-bit address (A0-A15)
   * Returns the byte value.
   */
  async snesRead(addr) {
    return this._query(DICT_SNES, SNES_ROM_RD, addr);
  }

  /**
   * Set the Genesis/MD ROM bank (A17–A23).
   * Each bank covers 128 KB (two 64 KB half-pages via GENESIS_ROM_PAGE0/1).
   * Must be called before each dumpMemory() pair.
   */
  async genSetBank(bank) {
    return this._cmd(DICT_SEGA, GEN_SET_BANK, bank);
  }

  /**
   * Set the N64 upper address (A16-A31).
   * Call before each bank dump. ROM starts at bank 0x1000 (address 0x1000_0000).
   */
  async n64SetBank(bank) {
    return this._cmd(DICT_N64, N64_SET_BANK, bank);
  }

  /**
   * Latch the N64 lower address (A0-A15) for single-word test reads.
   * Not needed for buffer-system bulk dumps (page_num auto-advances).
   */
  async n64LatchAddr(addr) {
    return this._cmd(DICT_N64, N64_LATCH_ADDR, addr);
  }

  /**
   * Release the N64 address bus (ALE_L/H high).
   * Must be called after each bank dump or test read.
   */
  async n64ReleaseBus() {
    return this._cmd(DICT_N64, N64_RELEASE_BUS);
  }

  /**
   * Read one 16-bit word from the N64 bus (RL=4).
   * The address auto-increments by 2 after each call.
   * Returns [byteHi, byteLo] in big-endian order (.z64).
   * Firmware delivers D0-D7 (LSB) in response byte 2 and D8-D15 (MSB) in byte 3; we swap them here.
   */
  async n64Read() {
    const b = await this._in(DICT_N64, N64_RD, 0, 0, 4);
    if (b[0] !== 0x00) {
      throw new Error(`N64 read error 0x${b[0].toString(16).padStart(2, '0')}`);
    }
    return [b[3], b[2]];  // [D8-15, D0-7] — firmware sends D0-7 in b[2], D8-15 in b[3]
  }

  /**
   * Write one byte to the NES CPU bus (generic CPU write with M2 toggle).
   * misc=data, operand=16-bit address.
   * Used to write mapper bank registers (e.g. $8000 for UxROM/CNROM/MMC3/etc).
   */
  async nesWrite(addr, data) {
    return this._cmd(DICT_NES, NES_CPU_WR, addr, data);
  }

  /**
   * Write one bit to the MMC1 shift register.
   * misc=data (bit 0 is the shift bit; bit 7 is reset), operand=16-bit address.
   * Firmware accumulates 5 bits then latches into the selected MMC1 register.
   */
  async nesMmc1Write(addr, data) {
    return this._cmd(DICT_NES, NES_MMC1_WR, addr, data);
  }

  /**
   * Write one byte to the Game Boy cartridge bus.
   * misc=data, operand=16-bit address.
   * Used to write MBC bank registers (e.g. $2000 for MBC1/3/5 ROM bank select).
   */
  async gameboyWrite(addr, data) {
    return this._cmd(DICT_GAMEBOY, GAMEBOY_WR, addr, data);
  }

  /**
   * Latch a GBA ROM address before a buffer dump.
   * addrLow  = A0–A15  (always 0x0000 for 128 KB-aligned chunks)
   * addrHigh = A16–A23 (chunk/bank index, 0x00–0xFF for 0–32 MB)
   * Maps to: wValue=(addrHigh<<8)|GBA_LATCH_ADDR, wIndex=addrLow
   */
  async gbaLatchAddr(addrLow, addrHigh) {
    return this._cmd(DICT_GBA, GBA_LATCH_ADDR, addrLow, addrHigh);
  }

  /**
   * Release the GBA address bus lines (ALE).
   * Must be called after each 128 KB chunk dump.
   */
  async gbaReleaseBus() {
    return this._cmd(DICT_GBA, GBA_RELEASE_BUS);
  }

  /**
   * Drive a PINPORT pin low (CTL_SET_LO).  Used to assert SNES /RST for prgm mode.
   */
  async pinportSetLo(pin) {
    return this._cmd(DICT_PINPORT, CTL_SET_LO, pin);
  }

  /**
   * Drive a PINPORT pin high (CTL_SET_HI).  Used to release SNES /RST.
   */
  async pinportSetHi(pin) {
    return this._cmd(DICT_PINPORT, CTL_SET_HI, pin);
  }

  /**
   * Latch a 16-bit address onto the shared address bus (PINPORT ADDR_SET).
   * In NES mode the lower 14 bits appear on both CPU A0-A13 and PPU PA0-PA13.
   */
  async nesAddrSet(addr) {
    return this._cmd(DICT_PINPORT, ADDR_SET, addr);
  }

  /**
   * Read a PINPORT control pin (CTL_RD, RL=4 → [error, data_len, LSB, MSB]).
   * Returns the LSB byte (0 = low, non-zero = high).
   */
  async pinCtlRd(pin) {
    const b = await this._in(DICT_PINPORT, CTL_RD, pin, 0, 4);
    if (b[0] !== 0x00) {
      throw new Error(`CTL_RD error 0x${b[0].toString(16).padStart(2, '0')} (pin=${pin})`);
    }
    return b[2];  // LSB = pin state
  }

  /**
   * NES CPU-bus write without asserting /ROMSEL (DISCRETE_EXP0_PRGROM_WR).
   * Used for PRG-ROM flash unlock sequences where ROMSEL must stay high.
   * misc=data, operand=16-bit address.
   */
  async nesExpPrgWrite(addr, data) {
    return this._cmd(DICT_NES, DISCRETE_EXP0_PRGROM_WR, addr, data);
  }

  /**
   * NES PPU-bus write (NES_PPU_WR).  Used for CHR-ROM flash unlock sequences.
   * misc=data, operand=16-bit address.
   */
  async nesPpuWrite(addr, data) {
    return this._cmd(DICT_NES, NES_PPU_WR, addr, data);
  }

  /**
   * SNES ROM bus write (SNES_ROM_WR).  Used for SNES flash erase sequences.
   * Bank must be set via snesSetBank() first if needed.
   * misc=data, operand=16-bit address.
   */
  async snesWrite(addr, data) {
    return this._cmd(DICT_SNES, SNES_ROM_WR, addr, data);
  }

  /**
   * Set the current PRG bank register (NES SET_CUR_BANK).
   * Used by the UxROM buffer-flash firmware to select the target bank.
   */
  async nesSetCurBank(bank) {
    return this._cmd(DICT_NES, SET_CUR_BANK, bank);
  }

  /**
   * Set the UxROM bank-table base address (NES SET_BANK_TABLE).
   * Must be called before UxROM flash operations.
   */
  async nesSetBankTable(addr) {
    return this._cmd(DICT_NES, SET_BANK_TABLE, addr);
  }

  /**
   * Get primary buffer elements (GET_PRI_ELEMENTS, RL=8, misc=buffNum).
   * Response layout: [error, dataLen, lastIdx, status, curByte, reload, id, fn]
   * Returns the status byte (index 3).  Used after streaming to confirm programming.
   */
  async getPriElements(buffNum) {
    const b = await this._in(DICT_BUFFER, GET_PRI_ELEMENTS, 0, buffNum, 8);
    if (b[0] !== 0x00) {
      throw new Error(`getPriElements error 0x${b[0].toString(16).padStart(2, '0')}`);
    }
    return b[3];  // status byte
  }

  /**
   * Send a 256-byte payload to the device for flash programming
   * (BUFF_OUT_PAYLOAD_2B_INSP = 0x71).
   *
   * Protocol (confirmed from firmware buffer.c):
   *   wValue = (misc=0 << 8) | 0x71
   *   wIndex = (chunk[1] << 8) | chunk[0]  — firmware reads data[0]=wIndex&0xFF, data[1]=wIndex>>8
   * Remaining 254 bytes go in the OUT data stage.
   */
  async bufferPayloadOut(chunk256) {
    const result = await this.dev.controlTransferOut({
      requestType: 'vendor',
      recipient:   'device',
      request:     DICT_BUFFER,
      value:       BUFF_OUT_PAYLOAD_2B_INSP,
      index:       chunk256[0] | (chunk256[1] << 8),
    }, chunk256.subarray(2));  // 254 bytes

    if (result.status !== 'ok') {
      throw new Error(`Flash payload OUT failed: ${result.status}`);
    }
  }

  /**
   * Raw payload read: BUFF_PAYLOAD (0x70).
   * Returns exactly numBytes of raw cartridge data — no error/length header.
   * This is what the firmware sends after a buffer has been filled from the cart.
   */
  async bufferPayloadIn(numBytes) {
    const r = await this.dev.controlTransferIn({
      requestType: 'vendor',
      recipient:   'device',
      request:     DICT_BUFFER,
      value:       0x0070,   // (misc=0 << 8) | BUFF_PAYLOAD=0x70
      index:       0,
    }, numBytes);

    if (r.status !== 'ok') {
      throw new Error(`Payload IN failed: ${r.status}`);
    }
    if (r.data.byteLength !== numBytes) {
      throw new Error(`Payload size mismatch: expected ${numBytes}B, got ${r.data.byteLength}B`);
    }
    return new Uint8Array(r.data.buffer);
  }
}
