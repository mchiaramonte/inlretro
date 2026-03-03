import { html } from 'htm/preact';

/**
 * DetailsSection — collapsible `<details>` block with consistent body padding.
 * Used for "Advanced options" in ConfigCard and "Diagnostics" in ActionCard.
 */
export function DetailsSection({ summary, children }) {
  return html`
    <details>
      <summary>${summary}</summary>
      <div class="details-body">${children}</div>
    </details>
  `;
}
