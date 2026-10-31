// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';

import { appendXlsxTable, createSandboxedPreviewFrame } from './file-preview.render';

type RenderKind = 'pdf' | 'docx' | 'xlsx';

/** Caps PDF rendering so huge documents cannot exhaust memory. */
const MAX_PDF_PAGES = 50;

/**
 * pdf.js relies on Promise.try / Promise.withResolvers, which older Android
 * WebViews lack. This shim is prepended to the worker source (the worker runs
 * in its own realm) and applied on the main thread before pdf.js loads.
 */
const PROMISE_SHIM = `
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function () {
    var resolve, reject;
    var promise = new Promise(function (res, rej) { resolve = res; reject = rej; });
    return { promise: promise, resolve: resolve, reject: reject };
  };
}
if (typeof Promise.try !== 'function') {
  Promise.try = function (fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve) { resolve(fn.apply(null, args)); });
  };
}
`;

/**
 * Renders a PDF, Word (.docx) or Excel (.xlsx) file in-app from its raw bytes.
 * The heavy libraries (pdf.js, docx-preview, SheetJS) are dynamically imported
 * so they are code-split into chunks loaded only when a preview is opened.
 */
@Component({
  selector: 'app-file-render',
  standalone: true,
  imports: [CommonModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading) {
      <div class="render-status"><ion-spinner></ion-spinner></div>
    } @else if (error) {
      <div class="render-status">
        <ion-icon name="alert-circle-outline"></ion-icon>
        <p>{{ error }}</p>
      </div>
    }
    <div #host class="render-host"></div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .render-status {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 48px 24px;
        color: var(--ion-color-medium);
      }
      .render-status ion-icon {
        font-size: 40px;
      }
      .render-host {
        padding: 8px;
      }
      .render-host ::ng-deep canvas {
        display: block;
        margin: 0 auto 10px;
        max-width: 100%;
        height: auto;
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
      }
      .render-host ::ng-deep table {
        border-collapse: collapse;
        font-size: 13px;
        background: #fff;
        color: #000;
      }
      .render-host ::ng-deep td,
      .render-host ::ng-deep th {
        border: 1px solid #999;
        padding: 4px 8px;
        white-space: nowrap;
      }
      .render-host ::ng-deep .docx-wrapper {
        background: #fff;
        padding: 8px;
      }
      .render-host ::ng-deep .docx-wrapper > section.docx {
        width: 100% !important;
        min-width: 0 !important;
        padding: 12px !important;
        margin-bottom: 0 !important;
        box-shadow: none !important;
      }
      .sheet-name {
        margin: 14px 8px 4px;
        font-weight: 600;
      }
      .sheet-scroll {
        overflow-x: auto;
      }
    `,
  ],
})
export class FileRenderComponent implements AfterViewInit, OnChanges {
  @Input() kind: RenderKind = 'pdf';
  @Input() bytes: Uint8Array | null = null;

  @ViewChild('host', { static: true }) private readonly host!: ElementRef<HTMLElement>;

  loading = false;
  error: string | null = null;

  private viewReady = false;
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly translate = inject(TranslateService);

  ngAfterViewInit(): void {
    this.viewReady = true;
    void this.render();
  }

  ngOnChanges(): void {
    if (this.viewReady) {
      void this.render();
    }
  }

  private async render(): Promise<void> {
    if (!this.bytes) {
      return;
    }
    this.loading = true;
    this.error = null;
    this.host.nativeElement.innerHTML = '';
    this.cdr.markForCheck();

    try {
      if (this.kind === 'pdf') {
        await this.renderPdf(this.bytes);
      } else if (this.kind === 'docx') {
        await this.renderDocx(this.bytes);
      } else {
        await this.renderXlsx(this.bytes);
      }
    } catch {
      this.error = this.translate.instant('FILES.PREVIEW_FAILED');
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  private async renderPdf(bytes: Uint8Array): Promise<void> {
    this.installPromiseShim();
    const pdfjs = await import('pdfjs-dist');
    // Load the worker through a Blob with an explicit JS MIME type: the
    // Capacitor WebView serves bundled .mjs assets with a MIME the strict
    // module-worker loader rejects, so pointing workerSrc at the asset fails.
    const worker = await this.createPdfWorker();
    pdfjs.GlobalWorkerOptions.workerPort = worker;

    const loadingTask = pdfjs.getDocument({ data: bytes });
    try {
      const doc = await loadingTask.promise;
      const pages = Math.min(doc.numPages, MAX_PDF_PAGES);

      for (let n = 1; n <= pages; n++) {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) {
          continue;
        }
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        this.host.nativeElement.appendChild(canvas);
        await page.render({ canvasContext: context, viewport }).promise;
      }
    } finally {
      await loadingTask.destroy();
      worker.terminate();
    }
  }

  /** Installs the Promise shim on the main thread for older WebViews. */
  private installPromiseShim(): void {
    const promise = Promise as unknown as {
      withResolvers?: unknown;
      try?: unknown;
    };
    if (typeof promise.withResolvers !== 'function') {
      promise.withResolvers = function <T>() {
        let resolve!: (value: T | PromiseLike<T>) => void;
        let reject!: (reason?: unknown) => void;
        const p = new Promise<T>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        return { promise: p, resolve, reject };
      };
    }
    if (typeof promise.try !== 'function') {
      promise.try = (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        Promise.resolve(fn(...args));
    }
  }

  private async createPdfWorker(): Promise<Worker> {
    const response = await fetch('assets/pdf.worker.min.mjs');
    if (!response.ok) {
      throw new Error(`worker load failed (${response.status})`);
    }
    const code = PROMISE_SHIM + '\n' + (await response.text());
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      return new Worker(url, { type: 'module' });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  }

  private async renderDocx(bytes: Uint8Array): Promise<void> {
    const { renderAsync } = await import('docx-preview');
    const { body } = createSandboxedPreviewFrame(this.host.nativeElement);
    const target = body.ownerDocument.createElement('div');
    body.appendChild(target);
    await renderAsync(bytes, target, undefined, {
      inWrapper: true,
      ignoreWidth: true,
      ignoreHeight: true,
      ignoreLastRenderedPageBreak: true,
      breakPages: false,
    });
  }

  private async renderXlsx(bytes: Uint8Array): Promise<void> {
    const mod = await import('xlsx');
    const xlsx = (mod as { read?: unknown }).read
      ? (mod as typeof import('xlsx'))
      : ((mod as { default: typeof import('xlsx') }).default ?? mod);

    const workbook = xlsx.read(bytes, { type: 'array' });
    const container = this.host.nativeElement;

    workbook.SheetNames.forEach((name) => {
      const heading = document.createElement('div');
      heading.className = 'sheet-name';
      heading.textContent = name;
      container.appendChild(heading);

      const scroll = document.createElement('div');
      scroll.className = 'sheet-scroll';
      const rows = xlsx.utils.sheet_to_json<(string | number | boolean | null)[]>(
        workbook.Sheets[name],
        { header: 1, defval: '' },
      );
      appendXlsxTable(scroll, rows);
      container.appendChild(scroll);
    });
  }
}
