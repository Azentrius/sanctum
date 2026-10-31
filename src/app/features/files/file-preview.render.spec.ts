// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { appendXlsxTable, createSandboxedPreviewFrame } from './file-preview.render';

describe('appendXlsxTable', () => {
  it('renders cell values as text without injecting HTML', () => {
    const container = document.createElement('div');
    appendXlsxTable(container, [['<img src=x onerror=alert(1)>', 'safe']]);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.textContent).toContain('safe');
  });
});

describe('createSandboxedPreviewFrame', () => {
  it('creates an iframe without allow-scripts', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { iframe, body } = createSandboxedPreviewFrame(host);

    expect(iframe.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-scripts');
    expect(body.tagName).toBe('BODY');
    expect(host.contains(iframe)).toBe(true);
  });
});
