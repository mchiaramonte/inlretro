import { useState, useRef } from 'preact/hooks';
import { html } from 'htm/preact';
import { Card } from './Card.js';

/**
 * N64ConverterCard — standalone byte-order converter for .z64/.v64/.n64 ROMs.
 * No USB needed; purely local file ↔ file conversion.
 */
export function N64ConverterCard({ isDumping, onDownload, onLog }) {
  const [srcFmt,    setSrcFmt]    = useState(null);
  const [infoText,  setInfoText]  = useState('No file loaded');
  const [infoColor, setInfoColor] = useState('#666');
  const [target,    setTarget]    = useState('z64');
  const dataRef     = useRef(null);
  const basenameRef = useRef(null);
  const fileRef     = useRef(null);

  function detectN64Fmt(data) {
    if (data[0]===0x80 && data[1]===0x37 && data[2]===0x12 && data[3]===0x40) return 'z64';
    if (data[0]===0x37 && data[1]===0x80 && data[2]===0x40 && data[3]===0x12) return 'v64';
    if (data[0]===0x40 && data[1]===0x12 && data[2]===0x37 && data[3]===0x80) return 'n64';
    return null;
  }

  function reorderToZ64(src, fmt) {
    const out = new Uint8Array(src.length);
    if (fmt === 'v64') {
      for (let i = 0; i < src.length; i += 2) { out[i] = src[i+1]; out[i+1] = src[i]; }
    } else {
      for (let i = 0; i < src.length; i += 4) {
        out[i] = src[i+3]; out[i+1] = src[i+2]; out[i+2] = src[i+1]; out[i+3] = src[i];
      }
    }
    return out;
  }

  function convertN64Bytes(src, from, to) {
    if (from === to) return src.slice();
    const z64 = from === 'z64' ? src : reorderToZ64(src, from);
    return to === 'z64' ? z64 : reorderToZ64(z64, to);
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const data = new Uint8Array(ev.target.result);
      const fmt  = detectN64Fmt(data);
      dataRef.current     = data;
      basenameRef.current = file.name.replace(/\.[^.]+$/, '');
      setSrcFmt(fmt);
      const sizeMB = (file.size / 1024 / 1024).toFixed(1);
      if (fmt) {
        const verdict = fmt === 'z64'
          ? '✓ already big-endian (.z64) — no conversion needed'
          : `needs byte-swap to .z64 (currently .${fmt})`;
        setInfoText(`${file.name}  ·  ${sizeMB} MB  ·  ${verdict}`);
        setInfoColor(fmt === 'z64' ? '#4d4' : '#fa4');
        setTarget(fmt !== 'z64' ? 'z64' : 'v64');
      } else {
        const magic = Array.from(data.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ');
        setInfoText(`${file.name}  ·  ${sizeMB} MB  ·  unrecognized magic: ${magic} — not a valid N64 ROM?`);
        setInfoColor('#f55');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleConvert() {
    if (!dataRef.current || !srcFmt) return;
    if (target === srcFmt) {
      onLog(`N64 converter: file is already .${target} — no conversion needed.`, 'log-warn');
      return;
    }
    const result   = convertN64Bytes(dataRef.current, srcFmt, target);
    const filename = `${basenameRef.current}.${target}`;
    onDownload(result, filename,
      `${filename}  ·  converted .${srcFmt} → .${target}  ·  ${(result.length / 1024 / 1024).toFixed(1)} MB`);
    onLog(`N64 converter: ${basenameRef.current}.${srcFmt} → ${filename}`, 'log-ok');
  }

  return html`
    <${Card} heading="Byte-Order Converter">
      <p style="font-size:0.82rem;color:#666;margin-bottom:0.75rem;line-height:1.6">
        Every N64 ROM header starts with <code style="color:#aaa">80 37 12 40</code> when in native
        big-endian (.z64) format. Some backup devices saved ROMs in byte-swapped (.v64) or
        little-endian (.n64) order — load the file below to detect its format and convert it.
      </p>
      <div class="row">
        <button class="secondary" onClick=${() => fileRef.current?.click()}>Choose ROM file…</button>
        <span style="font-size:0.82rem;color:${infoColor}">${infoText}</span>
      </div>
      <input
        ref=${fileRef}
        type="file"
        accept=".z64,.v64,.n64,.rom,.bin"
        style="display:none"
        onChange=${handleFileChange}
      />
      <div class="row" style="margin-top:0.75rem">
        <label>
          Convert to
          <select value=${target} onChange=${e => setTarget(e.target.value)}>
            <option value="z64">.z64  (big-endian)</option>
            <option value="v64">.v64  (byte-swapped)</option>
            <option value="n64">.n64  (little-endian)</option>
          </select>
        </label>
        <button disabled=${!srcFmt || isDumping} onClick=${handleConvert}>
          Convert &amp; Download
        </button>
      </div>
    </${Card}>
  `;
}
