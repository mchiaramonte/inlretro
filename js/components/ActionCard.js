import { html } from 'htm/preact';
import { Card } from './Card.js';

/**
 * ActionCard — Check Cartridge (required) then Dump.
 *
 * cartOk: null = not yet checked, true = passed, false = failed.
 * The Dump button is disabled until cartOk === true.
 */
export function ActionCard({ platform, connected, isDumping, cartOk, onCheck, onDump }) {
  const busy = !connected || isDumping;
  return html`
    <${Card}>
      <div class="row">
        <button class="secondary" disabled=${busy} onClick=${onCheck}>
          Check Cartridge
        </button>
        ${cartOk === 'ok'   && html`
          <span style="color:#3ecf6e;font-size:0.82rem;font-weight:500">Cart detected ✓</span>
        `}
        ${cartOk === 'fail' && html`
          <span style="color:#f56565;font-size:0.82rem;font-weight:500">Check failed — reseat cart and try again</span>
        `}
        <button style="margin-left:auto" disabled=${busy || cartOk !== 'ok'} onClick=${onDump}>
          ${platform.dumpLabel}
        </button>
      </div>
    </${Card}>
  `;
}
