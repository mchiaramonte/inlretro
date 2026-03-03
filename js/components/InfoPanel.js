import { html } from 'htm/preact';
import { Card } from './Card.js';
import { CopyBtn } from './CopyBtn.js';

/**
 * InfoPanel — renders the structured info table below each platform's action card.
 * Rows come from platform.buildHeaderRows / buildDumpRows.
 * Returns null when there are no rows (nothing cached yet).
 */
export function InfoPanel({ rows }) {
  if (!rows?.length) return null;
  return html`
    <${Card} extraClass="info-panel visible">
      <table class="info-table">
        <tbody>
          ${rows.map((row, i) =>
            'section' in row
              ? html`<tr key=${i} class="info-sec"><td colspan="2">${row.section}</td></tr>`
              : html`
                  <tr key=${i} class="info-row">
                    <td>${row.label}</td>
                    <td class=${row.cls ?? ''}>
                      ${row.value ?? '—'}
                      ${row.copy && html`<${CopyBtn} text=${row.value} />`}
                    </td>
                  </tr>
                `
          )}
        </tbody>
      </table>
    </${Card}>
  `;
}
