import { useRef, useEffect } from 'preact/hooks';
import { html } from 'htm/preact';
import { Card } from './Card.js';

/** LogPanel — append-only log with per-line CSS class, auto-scrolls to bottom. */
export function LogPanel({ lines }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);
  return html`
    <${Card}>
      <details class="log-section" open>
        <summary>Log</summary>
        <div ref=${ref} id="log" style="margin-top:0.5rem">
          ${lines.map((l, i) => html`<span key=${i} class=${l.cls}>${l.msg + '\n'}</span>`)}
        </div>
      </details>
    </${Card}>
  `;
}
