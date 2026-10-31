// SPDX-License-Identifier: GPL-3.0-or-later
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountService } from '../accounts/account.service';
import { TokenService } from '../auth/token.service';
import { NotesConflictError } from './notes-conflict.error';
import { NotesApiClientService } from './notes-api-client.service';
import { ApiNote } from './notes.model';

const ACCOUNT_ID = 'acc-1';
const SERVER = 'https://cloud.example.com';

const RAW: ApiNote = {
  id: 7,
  etag: 'etag-1',
  readonly: false,
  modified: 1_700_000_000,
  title: 'Hello',
  category: 'work',
  content: 'Body',
  favorite: false,
};

let service: NotesApiClientService;
let httpMock: HttpTestingController;
const getAccount = vi.fn();
const getPassword = vi.fn();

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  getAccount.mockResolvedValue({
    id: ACCOUNT_ID,
    serverUrl: SERVER,
    username: 'alice',
    displayName: 'Alice',
    color: '#0082c9',
    isActive: true,
    sortOrder: 0,
    addedAt: 0,
  });
  getPassword.mockResolvedValue('app-password');
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);

  TestBed.configureTestingModule({
    providers: [
      NotesApiClientService,
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AccountService, useValue: { getAccount } },
      { provide: TokenService, useValue: { getPassword } },
    ],
  });

  service = TestBed.inject(NotesApiClientService);
  httpMock = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  httpMock.verify();
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

describe('NotesApiClientService', () => {
  it('lists notes via the dev proxy with auth headers', async () => {
    const promise = service.listNotes(ACCOUNT_ID, { exclude: 'content' });
    await flushMicrotasks();

    const req = httpMock.expectOne(
      '/nextcloud-proxy/index.php/apps/notes/api/v1/notes?exclude=content',
    );
    expect(req.request.headers.get('Accept')).toBe('application/json');
    expect(req.request.headers.get('X-Nextcloud-Server')).toBe(SERVER);
    expect(req.request.headers.get('Authorization')).toMatch(/^Basic /);
    req.flush([RAW]);

    const notes = await promise;
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Hello');
  });

  it('creates and updates notes with JSON body', async () => {
    const createPromise = service.createNote(ACCOUNT_ID, { title: 'New' });
    await flushMicrotasks();
    const createReq = httpMock.expectOne(
      '/nextcloud-proxy/index.php/apps/notes/api/v1/notes',
    );
    expect(createReq.request.method).toBe('POST');
    expect(createReq.request.body).toEqual({ title: 'New' });
    createReq.flush(RAW);
    await createPromise;

    const updatePromise = service.updateNote(
      ACCOUNT_ID,
      7,
      { title: 'Updated' },
      'etag-1',
    );
    await flushMicrotasks();
    const updateReq = httpMock.expectOne(
      '/nextcloud-proxy/index.php/apps/notes/api/v1/notes/7',
    );
    expect(updateReq.request.method).toBe('PUT');
    expect(updateReq.request.headers.get('If-Match')).toBe('etag-1');
    updateReq.flush({ ...RAW, title: 'Updated' });
    const updated = await updatePromise;
    expect(updated.title).toBe('Updated');
  });

  it('deletes a note', async () => {
    const promise = service.deleteNote(ACCOUNT_ID, 7);
    await flushMicrotasks();
    const req = httpMock.expectOne(
      '/nextcloud-proxy/index.php/apps/notes/api/v1/notes/7',
    );
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 200, statusText: 'OK' });
    await promise;
  });

  it('throws NotesConflictError on HTTP 412', async () => {
    const promise = service.updateNote(ACCOUNT_ID, 7, { title: 'X' }, 'etag-1');
    await flushMicrotasks();
    const req = httpMock.expectOne(
      '/nextcloud-proxy/index.php/apps/notes/api/v1/notes/7',
    );
    req.flush(RAW, { status: 412, statusText: 'Precondition Failed' });

    await expect(promise).rejects.toBeInstanceOf(NotesConflictError);
  });

  it('maps common HTTP errors to German messages', async () => {
    for (const [status, pattern] of [
      [401, /Sitzung abgelaufen/i],
      [403, /Berechtigung/i],
      [404, /nicht gefunden/i],
      [500, /Serverfehler/i],
    ] as const) {
      const promise = service.getNote(ACCOUNT_ID, 7);
      await flushMicrotasks();
      const req = httpMock.expectOne(
        '/nextcloud-proxy/index.php/apps/notes/api/v1/notes/7',
      );
      req.flush(null, { status, statusText: 'Error' });
      await expect(promise).rejects.toThrow(pattern);
    }
  });

  it('rejects when account or password is missing', async () => {
    getAccount.mockResolvedValueOnce(null);
    await expect(service.getNote(ACCOUNT_ID, 1)).rejects.toThrow(/Konto nicht gefunden/i);

    getPassword.mockResolvedValueOnce(null);
    await expect(service.getNote(ACCOUNT_ID, 1)).rejects.toThrow(/App-Passwort/i);
  });

  it('returns an empty list when the API response is not an array', async () => {
    const promise = service.listNotes(ACCOUNT_ID);
    await flushMicrotasks();
    const req = httpMock.expectOne(
      '/nextcloud-proxy/index.php/apps/notes/api/v1/notes',
    );
    req.flush(null);
    await expect(promise).resolves.toEqual([]);
  });
});
