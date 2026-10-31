// SPDX-License-Identifier: GPL-3.0-or-later
/** Builds a table via DOM APIs so cell values cannot execute as HTML. */
export function appendXlsxTable(
  container: HTMLElement,
  rows: (string | number | boolean | null)[][],
): void {
  const table = document.createElement('table');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      td.textContent = cell == null ? '' : String(cell);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  container.appendChild(table);
}

/** Sandboxed iframe for untrusted HTML previews (blocks scripts). */
export function createSandboxedPreviewFrame(host: HTMLElement): {
  iframe: HTMLIFrameElement;
  body: HTMLElement;
} {
  const iframe = document.createElement('iframe');
  // Same-origin so the parent can inject HTML; scripts stay blocked without allow-scripts.
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.className = 'docx-preview-frame';
  iframe.style.width = '100%';
  iframe.style.border = 'none';
  iframe.style.minHeight = '480px';
  host.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    throw new Error('Preview frame unavailable');
  }
  const head = doc.createElement('head');
  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  head.appendChild(meta);
  const body = doc.createElement('body');
  doc.documentElement.replaceChildren(head, body);

  return { iframe, body: doc.body };
}
