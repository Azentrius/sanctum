// SPDX-License-Identifier: GPL-3.0-or-later
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { getBasicAuthHeaders } from 'tsdav';
import { firstValueFrom } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { TokenService } from '../auth/token.service';
import { nativeHttpRequest } from '../http/native-http.util';
import { normalizeNativeHttpBody } from '../http/ocs-response.util';
import { trimTrailingSlashes } from '../string/string.util';
import { NotesConflictError } from './notes-conflict.error';
import { mapNote, mapNotes } from './notes.map';
import { ApiNote, Note, NoteWritePayload } from './notes.model';

const NOTES_PREFIX = '/index.php/apps/notes/api/v1/';
const PROXY_PREFIX = '/nextcloud-proxy';
const SERVER_HEADER = 'X-Nextcloud-Server';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface NotesListQuery {
  category?: string;
  exclude?: string;
}

@Injectable({ providedIn: 'root' })
export class NotesApiClientService {
  private readonly http = inject(HttpClient);
  private readonly accountService = inject(AccountService);
  private readonly tokenService = inject(TokenService);

  async listNotes(
    accountId: string,
    query: NotesListQuery = {},
  ): Promise<Note[]> {
    const data = await this.request<ApiNote[]>(
      accountId,
      'GET',
      'notes',
      undefined,
      { exclude: query.exclude, category: query.category },
    );
    return mapNotes(accountId, Array.isArray(data) ? data : []);
  }

  async getNote(accountId: string, noteId: number): Promise<Note> {
    const data = await this.request<ApiNote>(
      accountId,
      'GET',
      `notes/${noteId}`,
    );
    return mapNote(accountId, data);
  }

  async createNote(accountId: string, payload: NoteWritePayload): Promise<Note> {
    const data = await this.request<ApiNote>(
      accountId,
      'POST',
      'notes',
      payload,
    );
    return mapNote(accountId, data);
  }

  async updateNote(
    accountId: string,
    noteId: number,
    payload: NoteWritePayload,
    etag?: string,
  ): Promise<Note> {
    const headers: Record<string, string> = {};
    if (etag) {
      headers['If-Match'] = etag;
    }
    const data = await this.request<ApiNote>(
      accountId,
      'PUT',
      `notes/${noteId}`,
      payload,
      undefined,
      headers,
    );
    return mapNote(accountId, data);
  }

  async deleteNote(accountId: string, noteId: number): Promise<void> {
    await this.request(accountId, 'DELETE', `notes/${noteId}`);
  }

  private async request<T>(
    accountId: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    query?: Record<string, string | undefined>,
    extraHeaders: Record<string, string> = {},
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
      Accept: 'application/json',
      ...extraHeaders,
    };
    if (body !== undefined && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }

    const url = this.buildUrl(serverUrl, path, query);
    const timeoutMs = DEFAULT_TIMEOUT_MS;

    const raw = Capacitor.isNativePlatform()
      ? await this.requestNative(accountId, method, url, headers, body, timeoutMs)
      : await this.requestWeb(accountId, method, url, serverUrl, headers, body, timeoutMs);

    return raw as T;
  }

  private buildUrl(
    serverUrl: string,
    path: string,
    query?: Record<string, string | undefined>,
  ): string {
    const normalizedPath = path.replace(/^\/+/, '');
    const base = Capacitor.isNativePlatform()
      ? `${serverUrl}${NOTES_PREFIX}${normalizedPath}`
      : `${PROXY_PREFIX}${NOTES_PREFIX}${normalizedPath}`;

    if (!query) {
      return base;
    }

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        params.set(key, value);
      }
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  private async requestNative(
    accountId: string,
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

      return this.handleResponse(
        accountId,
        response.status,
        normalizeNativeHttpBody(response.data),
        method,
      );
    } catch (error) {
      throw this.toGermanError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  private async requestWeb(
    accountId: string,
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
    } = { headers: httpHeaders };

    if (body !== undefined && method !== 'GET') {
      options.body = body;
    }

    try {
      const response = await firstValueFrom(
        this.http.request<unknown>(method, url, {
          ...options,
          observe: 'response',
          responseType: 'json',
        }),
      );
      return this.handleResponse(
        accountId,
        response.status,
        response.body,
        method,
      );
    } catch (error) {
      this.throwWebRequestError(accountId, error, timeoutMs);
    }
  }

  private handleResponse(
    accountId: string,
    status: number,
    body: unknown,
    method: string,
  ): unknown {
    if (status === 401) {
      throw new Error('Sitzung abgelaufen. Bitte erneut anmelden.');
    }
    if (status === 403) {
      throw new Error('Keine Berechtigung für diese Notiz.');
    }
    if (status === 404) {
      throw new Error('Notiz nicht gefunden.');
    }
    if (status === 412 && body && typeof body === 'object' && 'id' in body) {
      throw new NotesConflictError(mapNote(accountId, body as ApiNote));
    }
    if (status >= 400) {
      throw new Error(`Serverfehler (HTTP ${status}).`);
    }
    if (method === 'DELETE') {
      return undefined;
    }
    return body;
  }

  private throwWebRequestError(
    accountId: string,
    error: unknown,
    timeoutMs: number,
  ): never {
    if (error instanceof HttpErrorResponse) {
      this.throwHttpErrorResponse(accountId, error);
    }
    if (timeoutMs > 0 && error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('Zeitüberschreitung bei der Serveranfrage.');
    }
    throw this.toGermanError(error);
  }

  private throwHttpErrorResponse(accountId: string, error: HttpErrorResponse): never {
    if (error.status === 412 && error.error && typeof error.error === 'object') {
      const raw = error.error as ApiNote;
      if (typeof raw.id === 'number') {
        throw new NotesConflictError(mapNote(accountId, raw));
      }
    }
    throw this.httpStatusError(error.status);
  }

  private httpStatusError(status: number): never {
    if (status === 401) {
      throw new Error('Sitzung abgelaufen. Bitte erneut anmelden.');
    }
    if (status === 403) {
      throw new Error('Keine Berechtigung für diese Notiz.');
    }
    if (status === 404) {
      throw new Error('Notiz nicht gefunden.');
    }
    if (status === 0) {
      throw new Error('Netzwerkfehler. Keine Verbindung zum Server.');
    }
    throw new Error(`Serverfehler (HTTP ${status}).`);
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
