import { html } from 'htm/preact';
import { Card } from './Card.js';

/** ProgressCard — shown only while a dump/test is running. */
export function ProgressCard({ isDumping, phase, value }) {
  if (!isDumping) return null;
  return html`
    <${Card} heading="Progress">
      <div id="phase-label">${phase}</div>
      <progress max="100" value=${value}></progress>
    </${Card}>
  `;
}
