// SPDX-License-Identifier: GPL-3.0-or-later
export interface OcsMeta {
  status: string;
  statuscode: number;
  message?: string;
}

export interface OcsResponse<T> {
  ocs: {
    meta: OcsMeta;
    data: T;
  };
}

export interface OcsRequestOptions {
  /** Request timeout in ms (e.g. 30_000 for chat long-poll). */
  timeoutMs?: number;
  /** Extra headers merged into the OCS request. */
  headers?: Record<string, string>;
}
