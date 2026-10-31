// SPDX-License-Identifier: GPL-3.0-or-later
import { registerPlugin } from '@capacitor/core';

/**
 * Local native plugin for WebDAV/CalDAV requests (Android: OkHttp, iOS:
 * URLSession). Capacitor's CapacitorHttp cannot send WebDAV verbs reliably:
 * PROPFIND/REPORT get coerced to POST and the request body does not reach
 * Nextcloud's DAV endpoint. These native clients speak arbitrary methods and
 * deliver the body like curl does.
 *
 * Only WebDAV traffic uses this; the login flow stays on CapacitorHttp.
 */
export interface DavHttpRequestOptions {
  url: string;
  method: string;
  headers?: Record<string, string>;
  data?: string;
  /** Base64-encoded binary request body (e.g. WebDAV PUT of a picked file). */
  dataBase64?: string;
  connectTimeout?: number;
  readTimeout?: number;
}

export interface DavHttpResponse {
  status: number;
  headers: Record<string, string>;
  data: string;
  url: string;
}

export interface DavHttpPlugin {
  request(options: DavHttpRequestOptions): Promise<DavHttpResponse>;
}

export const DavHttp = registerPlugin<DavHttpPlugin>('DavHttp');
