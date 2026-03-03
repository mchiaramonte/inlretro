import { html } from 'htm/preact';
import { Card } from './Card.js';

/** DownloadCard — shown only after a successful dump. */
export function DownloadCard({ download }) {
  if (!download) return null;
  return html`
    <${Card} heading="Download">
      <a id="download-link" href=${download.url} download=${download.filename}>
        Download ${download.filename}
      </a>
      <div id="rom-info">${download.info}</div>
    </${Card}>
  `;
}
