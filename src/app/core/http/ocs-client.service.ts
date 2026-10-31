// SPDX-License-Identifier: GPL-3.0-or-later
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
  HttpParams,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { getBasicAuthHeaders } from 'tsdav';
import { firstValueFrom } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { TokenService } from '../auth/token.service';
import { trimTrailingSlashes } from '../string/string.util';
import { nativeHttpRequest } from './native-http.util';
import { normalizeNativeHttpBody } from './ocs-response.util';
import { OcsRequestOptions, OcsResponse } from './ocs.types';

const OCS_PREFIX = '/ocs/v2.php/';
const PROXY_PREFIX = '/nextcloud-proxy';
const SERVER_HEADER = 'X-Nextcloud-Server';
const DEFAULT_TIMEOUT_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class OcsClientService {
  private readonly http = inject(HttpClient);
  private readonly accountService = inject(AccountService);
  private readonly tokenService = inject(TokenService);

  /**
   * Authenticated OCS JSON request. `path` is relative to `/ocs/v2.php/`, e.g.
   * `apps/spreed/api/v4/room`.
   */
  async request<T>(
    accountId: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
    options: OcsRequestOptions = {},
  ): Promise<T> {
    const account = await this.accountService.getAccount(accountId);
    if (!account) {
      throw new Error('Konto nicht gefunden.');
    }

    const password = await this.tokenService.getPassword(accountId);
    if (!password) {
      throw new Error('Kein App-Passwort vorhanden. Bitte erneut anmelden.');
    }

    const serverUrl = trimTrailingSlashes(account.serverUrl);
    const authHeaders = getBasicAuthHeaders({
      username: account.username,
      password,
    });
    const headers: Record<string, string> = {
      ...authHeaders,
      'OCS-APIRequest': 'true',
      Accept: 'application/json',
      ...options.headers,
    };

    const url = this.buildUrl(serverUrl, path, query);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const raw = Capacitor.isNativePlatform()
      ? await this.requestNative(method, url, headers, body, timeoutMs)
      : await this.requestWeb(method, url, serverUrl, headers, body, timeoutMs);

    return this.parseOcsResponse<T>(raw, method, path);
  }

  private buildUrl(
    serverUrl: string,
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const normalizedPath = path.replace(/^\/+/, '');
    const base = Capacitor.isNativePlatform()
      ? `${serverUrl}${OCS_PREFIX}${normalizedPath}`
      : `${PROXY_PREFIX}${OCS_PREFIX}${normalizedPath}`;

    if (!query) {
      return base;
    }

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        params.set(key, String(value));
      }
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  private async requestNative(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await nativeHttpRequest({
        method,
        url,
        headers,
        data: body ?? '',
        responseType: 'json',
      });

      if (response.status === 401) {
        throw new Error('Sitzung abgelaufen. Bitte erneut anmelden.');
      }
      if (response.status === 403) {
        throw new Error('Keine Berechtigung. Bitte Talk-Rechte prüfen.');
      }
      if (response.status >= 400) {
        throw new Error(`Serverfehler (HTTP ${response.status}).`);
      }

      return normalizeNativeHttpBody(response.data);
    } catch (error) {
      throw this.toGermanError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  private async requestWeb(
    method: string,
    url: string,
    serverUrl: string,
    headers: Record<string, string>,
    body: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const httpHeaders = new HttpHeaders({
      ...headers,
      [SERVER_HEADER]: serverUrl,
    });

    const options: {
      headers: HttpHeaders;
      body?: unknown;
      params?: HttpParams;
    } = { headers: httpHeaders };

    if (body !== undefined && method !== 'GET') {
      options.body = body;
    }

    try {
      const response = await firstValueFrom(
        this.http.request<unknown>(method, url, {
          ...options,
          observe: 'body',
          responseType: 'json',
          // Angular HttpClient has no per-request timeout; rely on server long-poll.
        }),
      );
      return response;
    } catch (error) {
      this.throwWebRequestError(error, timeoutMs);
    }
  }

  private throwWebRequestError(error: unknown, timeoutMs: number): never {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401) {
        throw new Error('Sitzung abgelaufen. Bitte erneut anmelden.');
      }
      if (error.status === 403) {
        throw new Error('Keine Berechtigung. Bitte Talk-Rechte prüfen.');
      }
      if (error.status === 0) {
        throw new Error('Netzwerkfehler. Keine Verbindung zum Server.');
      }
      throw new Error(`Serverfehler (HTTP ${error.status}).`);
    }
    if (timeoutMs > 0 && error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('Zeitüberschreitung bei der Serveranfrage.');
    }
    throw this.toGermanError(error);
  }

  private parseOcsResponse<T>(
    raw: unknown,
    method: string,
    path: string,
  ): T {
    const envelope = raw as OcsResponse<T>;
    const meta = envelope?.ocs?.meta;
    if (!meta) {
      throw new Error('Ungültige OCS-Antwort vom Server.');
    }

    if (meta.statuscode === 401) {
      throw new Error('Sitzung abgelaufen. Bitte erneut anmelden.');
    }
    if (meta.statuscode === 403) {
      throw new Error('Keine Berechtigung. Bitte Talk-Rechte prüfen.');
    }
    if (meta.statuscode === 404 || meta.statuscode === 997) {
      throw new Error(meta.message ?? 'Ressource nicht gefunden.');
    }
    if (meta.statuscode !== 200 && meta.status !== 'ok') {
      throw new Error(
        meta.message ?? `Talk-Anfrage fehlgeschlagen (${method} ${path}).`,
      );
    }

    return envelope.ocs.data;
  }

  private toGermanError(error: unknown): Error {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return new Error('Zeitüberschreitung bei der Serveranfrage.');
      }
      return error;
    }
    return new Error('Netzwerkfehler. Keine Verbindung zum Server.');
  }
}
