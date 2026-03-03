import { html } from 'htm/preact';

/**
 * Card — the dark rounded panel used throughout the UI.
 * `heading` renders an `<h2>` label; `extraClass` adds CSS classes to the card div.
 */
export function Card({ heading, extraClass, children }) {
  return html`
    <div class=${['card', extraClass].filter(Boolean).join(' ')}>
      ${heading && html`<h2>${heading}</h2>`}
      ${children}
    </div>
  `;
}
