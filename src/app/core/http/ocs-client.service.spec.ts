// SPDX-License-Identifier: GPL-3.0-or-later
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';

import { AccountService } from '../accounts/account.service';
import { TokenService } from '../auth/token.service';
import { OcsClientService } from './ocs-client.service';

const ACCOUNT_ID = 'acc-1';
const SERVER = 'https://cloud.example.com';

let service: OcsClientService;
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
      OcsClientService,
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: AccountService,
        useValue: { getAccount },
      },
      {
        provide: TokenService,
        useValue: { getPassword },
      },
    ],
  });

  service = TestBed.inject(OcsClientService);
  httpMock = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  httpMock.verify();
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

describe('OcsClientService', () => {
  it('sends OCS headers and parses data on GET success', async () => {
    const promise = service.request<{ token: string }[]>(
      ACCOUNT_ID,
      'GET',
      'apps/spreed/api/v4/room',
    );

    await flushMicrotasks();

    const req = httpMock.expectOne(
      '/nextcloud-proxy/ocs/v2.php/apps/spreed/api/v4/room',
    );
    expect(req.request.headers.get('OCS-APIRequest')).toBe('true');
    expect(req.request.headers.get('Accept')).toBe('application/json');
    expect(req.request.headers.get('X-Nextcloud-Server')).toBe(SERVER);
    expect(req.request.headers.get('Authorization')).toMatch(/^Basic /);

    req.flush({
      ocs: {
        meta: { status: 'ok', statuscode: 200 },
        data: [{ token: 'abc' }],
      },
    });

    const data = await promise;
    expect(data).toEqual([{ token: 'abc' }]);
  });

  it('throws on OCS 404/997', async () => {
    const promise = service.request(
      ACCOUNT_ID,
      'GET',
      'apps/spreed/api/v4/room/missing',
    );

    await flushMicrotasks();

    const req = httpMock.expectOne(
      '/nextcloud-proxy/ocs/v2.php/apps/spreed/api/v4/room/missing',
    );
    req.flush({
      ocs: {
        meta: { status: 'failure', statuscode: 997, message: 'Not found' },
        data: [],
      },
    });

    await expect(promise).rejects.toThrow(/Not found/i);
  });

  it('throws German message on HTTP 401', async () => {
    const promise = service.request(
      ACCOUNT_ID,
      'GET',
      'apps/spreed/api/v4/room',
    );

    await flushMicrotasks();

    const req = httpMock.expectOne(
      '/nextcloud-proxy/ocs/v2.php/apps/spreed/api/v4/room',
    );
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    await expect(promise).rejects.toThrow(/Sitzung abgelaufen/i);
  });

  it('rejects when the account is missing', async () => {
    getAccount.mockResolvedValue(null);
    await expect(service.request(ACCOUNT_ID, 'GET', 'x')).rejects.toThrow(/Konto nicht gefunden/i);
  });

  it('rejects when no app password is stored', async () => {
    getPassword.mockResolvedValue(null);
    await expect(service.request(ACCOUNT_ID, 'GET', 'x')).rejects.toThrow(/App-Passwort/i);
  });

  it('encodes query parameters and skips undefined values', async () => {
    const promise = service.request(ACCOUNT_ID, 'GET', 'apps/spreed/api/v4/room', undefined, {
      limit: 10,
      cursor: undefined,
      flag: true,
    });
    await flushMicrotasks();

    const req = httpMock.expectOne(
      '/nextcloud-proxy/ocs/v2.php/apps/spreed/api/v4/room?limit=10&flag=true',
    );
    expect(req.request.urlWithParams).toBe(
      '/nextcloud-proxy/ocs/v2.php/apps/spreed/api/v4/room?limit=10&flag=true',
    );
    expect(req.request.urlWithParams).not.toContain('cursor');
    req.flush({ ocs: { meta: { status: 'ok', statuscode: 200 }, data: [] } });
    await promise;
  });

  it('sends the body on a POST request', async () => {
    const promise = service.request(ACCOUNT_ID, 'POST', 'apps/spreed/api/v4/room', {
      roomName: 'Team',
    });
    await flushMicrotasks();

    const req = httpMock.expectOne('/nextcloud-proxy/ocs/v2.php/apps/spreed/api/v4/room');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ roomName: 'Team' });
    req.flush({ ocs: { meta: { status: 'ok', statuscode: 200 }, data: { token: 'x' } } });
    await promise;
  });

  it('maps HTTP 403 and network errors to German messages', async () => {
    const forbidden = service.request(ACCOUNT_ID, 'GET', 'a');
    await flushMicrotasks();
    httpMock.expectOne('/nextcloud-proxy/ocs/v2.php/a').flush('no', { status: 403, statusText: 'Forbidden' });
    await expect(forbidden).rejects.toThrow(/Keine Berechtigung/i);

    const offline = service.request(ACCOUNT_ID, 'GET', 'b');
    await flushMicrotasks();
    httpMock.expectOne('/nextcloud-proxy/ocs/v2.php/b').flush('', { status: 0, statusText: 'Unknown' });
    await expect(offline).rejects.toThrow(/Netzwerkfehler/i);
  });
});

