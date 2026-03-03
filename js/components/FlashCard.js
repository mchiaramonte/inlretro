import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { Card } from './Card.js';

/**
 * FlashCard — file picker + optional chip-type selector + "Erase + Flash" button.
 *
 * Props:
 *   platform   — platform descriptor (used for platform.id)
 *   connected  — bool: USB device connected
 *   isDumping  — bool: any operation in progress
 *   onFlash    — async (file: File, flashOpts: object) => void
 *
 * Shown only for platforms where supportsFlash = true (NES and SNES).
 *
 * SNES shows an additional "Chip type" dropdown (5V PLCC / 3V TSSOP) to select
 * the correct erase and write sequences.
 */
export function FlashCard({ platform, connected, isDumping, onFlash }) {
  const [romFile,  setRomFile]  = useState(null);
  const [chipType, setChipType] = useState('5V_PLCC');

  const isSnes = platform.id === 'snes';
  const busy   = !connected || isDumping;
  const ready  = !busy && romFile !== null;

  function handleFileChange(e) {
    setRomFile(e.target.files?.[0] ?? null);
  }

  function handleFlash() {
    if (!ready) return;
    onFlash(romFile, isSnes ? { chipType } : {});
  }

  return html`
    <${Card} heading="Flash ROM">
      <p style="color:#f6ad55;font-size:0.82rem;margin:0 0 0.6rem">
        ⚠ Flash writing is irreversible. Chip erase clears all data.
        Verify the ROM file and mapper settings before proceeding.
      </p>
      <div class="row">
        <label style="display:flex;flex-direction:column;gap:0.25rem;font-size:0.85rem">
          ROM file
          <input
            type="file"
            accept=".nes,.sfc,.smc,.gb,.gba,.md,.bin"
            disabled=${busy}
            onChange=${handleFileChange}
            style="font-size:0.82rem"
          />
        </label>

        ${isSnes && html`
          <label style="display:flex;flex-direction:column;gap:0.25rem;font-size:0.85rem">
            Chip type
            <select
              value=${chipType}
              disabled=${busy}
              onChange=${e => setChipType(e.target.value)}
            >
              <option value="5V_PLCC">5V PLCC (SST 39SF040)</option>
              <option value="3V_TSSOP">3V TSSOP v3 (SST 39VF040)</option>
            </select>
          </label>
        `}

        <button
          style="margin-left:auto;background:#9b2c2c;color:#fff;border-color:#9b2c2c"
          disabled=${!ready}
          onClick=${handleFlash}
        >
          Erase + Flash
        </button>
      </div>

      ${romFile && html`
        <p style="font-size:0.78rem;color:#a0aec0;margin:0.4rem 0 0">
          Selected: ${romFile.name}
          (${(romFile.size / 1024).toFixed(0)} KB)
        </p>
      `}
    </${Card}>
  `;
}
