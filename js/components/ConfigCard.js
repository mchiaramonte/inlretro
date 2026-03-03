import { html } from 'htm/preact';
import { MAPPER_CHR_RAM } from '../platforms.js';
import { Card } from './Card.js';
import { DetailsSection } from './DetailsSection.js';

/**
 * ConfigCard — config dropdowns driven by platform.configFields / advancedFields.
 * NES: disables and zeroes CHR-size when a CHR-RAM mapper is selected.
 */
export function ConfigCard({ platform, config, onConfigChange, isDumping }) {
  const chrRam = platform.id === 'nes' && MAPPER_CHR_RAM.has(config['mapper']);

  function renderSelect(f) {
    const disabled = isDumping || (f.id === 'chr-size' && chrRam);
    return html`
      <label key=${f.id}>
        ${f.label}
        <select
          value=${config[f.id] ?? ''}
          disabled=${disabled}
          onChange=${e => {
            const val = e.target.value;
            onConfigChange(f.id, val);
            // Force CHR-size to 0 KB when a CHR-RAM mapper is chosen
            if (f.id === 'mapper' && MAPPER_CHR_RAM.has(val)) {
              onConfigChange('chr-size', '0');
            }
          }}
        >
          ${f.options.map(o => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
        </select>
      </label>
    `;
  }

  return html`
    <${Card} heading=${platform.heading}>
      <div class="row">
        ${platform.configFields.map(renderSelect)}
      </div>
      ${platform.advancedFields.length > 0 && html`
        <${DetailsSection} summary="Advanced options">
          <div class="row">
            ${platform.advancedFields.map(renderSelect)}
          </div>
        </${DetailsSection}>
      `}
    </${Card}>
  `;
}
