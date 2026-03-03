import { html } from 'htm/preact';
import { PLATFORMS } from '../platforms.js';

/** TabBar — platform tabs (derived from PLATFORMS) plus a static Utilities tab. */
export function TabBar({ activeTab, onTab, isDumping }) {
  const tabs = [];
  const seen = new Set();
  for (const p of PLATFORMS) {
    if (!seen.has(p.tabId)) {
      seen.add(p.tabId);
      tabs.push({ id: p.tabId, label: p.label });
    }
  }
  tabs.push({ id: 'utilities', label: 'Utilities' });
  return html`
    <div class="tab-bar">
      ${tabs.map(t => html`
        <button
          key=${t.id}
          class=${activeTab === t.id ? 'active' : ''}
          disabled=${isDumping}
          onClick=${() => onTab(t.id)}
        >${t.label}</button>
      `)}
    </div>
  `;
}
