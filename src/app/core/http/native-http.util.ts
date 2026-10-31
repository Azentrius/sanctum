// SPDX-License-Identifier: GPL-3.0-or-later
import { Capacitor, CapacitorHttp, HttpOptions, HttpResponse } from '@capacitor/core';

import { CertPin } from '../security/cert-pin.plugin';
import { notifyCertPinTransportError } from '../security/cert-pin-transport.hook';
import { isCertPinMismatchError } from '../security/cert-pin.util';

/**
 * Native HTTP via Capacitor core's CapacitorHttp, used for the Nextcloud login
 * flow (POST/JSON). Native requests bypass the WebView's CORS restrictions.
 *
 * CalDAV/WebDAV does NOT go through here: CapacitorHttp (Android's
 * HttpURLConnection) cannot deliver a request body for WebDAV verbs
 * (PROPFIND/REPORT) to Nextcloud, so that traffic uses the native DavHttp
 * plugin instead: see dav-http.plugin.ts and native-fetch.util.ts.
 *
 * On native platforms login/OCS traffic is routed through the CertPin plugin so
 * TOFU pinning applies consistently with DavHttp.
 *
 * The empty-object/string fallbacks are defensive and keep the call shape
 * identical across platforms.
 */
/** Normalizes options before CapacitorHttp: tested without mocking @capacitor/core. */
export function normalizeNativeHttpOptions(options: HttpOptions): HttpOptions {
  return {
    ...options,
    headers: options.headers ?? {},
    params: options.params ?? {},
    data: options.data ?? '',
  };
}

export async function nativeHttpRequest(options: HttpOptions): Promise<HttpResponse> {
  const normalized = normalizeNativeHttpOptions(options);
  try {
    const response = Capacitor.isNativePlatform()
      ? await CertPin.request(normalized)
      : await CapacitorHttp.request(normalized);
    return response;
  } catch (error: unknown) {
    if (isCertPinMismatchError(error)) {
      notifyCertPinTransportError(error, normalized.url);
    }
    throw error;
  }
}
