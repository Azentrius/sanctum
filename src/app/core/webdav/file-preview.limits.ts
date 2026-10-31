// SPDX-License-Identifier: GPL-3.0-or-later
/** Maximum bytes loaded into memory for an in-app file preview. */
export const MAX_PREVIEW_BYTES = 15 * 1024 * 1024;

export class PreviewTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`Preview exceeds ${MAX_PREVIEW_BYTES} bytes`);
    this.name = 'PreviewTooLargeError';
  }
}

export function assertPreviewSize(bytes: number): void {
  if (bytes > MAX_PREVIEW_BYTES) {
    throw new PreviewTooLargeError(bytes);
  }
}
