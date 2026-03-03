import { html } from 'htm/preact';
import { Card } from './Card.js';

/** DeviceCard — Connect / Disconnect buttons + connection status badge. */
export function DeviceCard({ connected, deviceName, isDumping, onConnect, onDisconnect }) {
  return html`
    <${Card} heading="Device">
      <div class="row">
        <button disabled=${connected || isDumping} onClick=${onConnect}>
          Connect to INL Retro
        </button>
        <button class="secondary" disabled=${!connected || isDumping} onClick=${onDisconnect}>
          Disconnect
        </button>
        <span id="device-status" class=${connected ? 'connected' : ''}>
          ${connected ? deviceName : 'Not connected'}
        </span>
      </div>
    </${Card}>
  `;
}
