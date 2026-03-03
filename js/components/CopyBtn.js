import { useState } from 'preact/hooks';
import { html } from 'htm/preact';

/** Small "copy" button used inside InfoPanel rows. */
export function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return html`
    <button class="copy-btn" onClick=${() => {
      navigator.clipboard?.writeText(String(text));
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    }}>${done ? '✓' : 'copy'}</button>
  `;
}
