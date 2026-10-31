// SPDX-License-Identifier: GPL-3.0-or-later
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  },
}));

vi.mock('@capacitor/device', () => ({
  Device: {
    getInfo: vi.fn(async () => ({ model: 'Pixel 6 Pro' })),
  },
}));

import { AccountService } from '../accounts/account.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { CertPinService } from '../security/cert-pin.service';

const SERVER = 'https://cloud.example.com';

let service: AuthService;
let httpMock: HttpTestingController;
const addAccount = vi.fn();
const setPassword = vi.fn();
const getPassword = vi.fn();
const clearPassword = vi.fn();
const removeAccount = vi.fn();
const establishTofuPin = vi.fn();
const navigate = vi.fn();
let accountCount$: BehaviorSubject<number>;
let accounts$: BehaviorSubject<{ id: string }[]>;

beforeEach(() => {
  addAccount.mockResolvedValue({
    id: 'new-acc',
    serverUrl: SERVER,
    username: 'alice',
    displayName: 'alice',
    color: '#0082c9',
    isActive: true,
    sortOrder: 0,
    addedAt: 0,
  });
  setPassword.mockResolvedValue(undefined);
  establishTofuPin.mockResolvedValue(undefined);
  getPassword.mockResolvedValue('app-password');
  clearPassword.mockResolvedValue(undefined);
  removeAccount.mockResolvedValue(undefined);
  navigate.mockReset();
  navigate.mockResolvedValue(true);
  clearPassword.mockClear();
  removeAccount.mockClear();
  accountCount$ = new BehaviorSubject(1);
  accounts$ = new BehaviorSubject([{ id: 'acc-1' }]);
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);

  TestBed.configureTestingModule({
    providers: [
      AuthService,
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: AccountService,
        useValue: {
          accountCount: accountCount$.asObservable(),
          accounts: accounts$.asObservable(),
          addAccount,
          removeAccount,
        },
      },
      {
        provide: TokenService,
        useValue: { setPassword, getPassword, clearPassword },
      },
      {
        provide: CertPinService,
        useValue: { establishTofuPin },
      },
      { provide: Router, useValue: { navigate } },
    ],
  });

  service = TestBed.inject(AuthService);
  httpMock = TestBed.inject(HttpTestingController);
  vi.useFakeTimers();
});

afterEach(() => {
  (service as unknown as { stopPolling(): void }).stopPolling();
  httpMock.verify();
  vi.useRealTimers();
  TestBed.resetTestingModule();
});

describe('AuthService.startLogin (web)', () => {
  it('rejects a non-HTTPS server URL', async () => {
    await expect(service.startLogin('http://cloud.example.com')).rejects.toThrow(
      /Nur HTTPS-Server werden unterstützt/,
    );
    httpMock.expectNone('/nextcloud-proxy/index.php/login/v2');
  });

  it('rejects a login flow whose poll endpoint is on another host', async () => {
    const loginPromise = service.startLogin(SERVER);

    const initReq = httpMock.expectOne('/nextcloud-proxy/index.php/login/v2');
    expect(initReq.request.headers.get('X-Nextcloud-Server')).toBe(SERVER);
    initReq.flush({
      login: `${SERVER}/index.php/login/v2`,
      poll: {
        endpoint: 'https://evil.example.com/index.php/login/v2/poll/abc',
        token: 'poll-token',
      },
    });

    await expect(loginPromise).rejects.toThrow(/passt nicht zur eingegebenen Adresse/);
  });

  it('persists credentials after a successful poll on web', async () => {
    const loginPromise = service.startLogin(SERVER);

    const initReq = httpMock.expectOne('/nextcloud-proxy/index.php/login/v2');
    initReq.flush({
      login: `${SERVER}/index.php/login/v2`,
      poll: {
        endpoint: `${SERVER}/index.php/login/v2/poll/abc`,
        token: 'poll-token',
      },
    });

    await vi.advanceTimersByTimeAsync(2000);

    const pollReq = httpMock.expectOne('/nextcloud-proxy/index.php/login/v2/poll/abc');
    expect(pollReq.request.body).toBe('token=poll-token');
    pollReq.flush({
      server: SERVER,
      loginName: 'alice',
      appPassword: 'app-password',
    });

    await loginPromise;

    expect(addAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        serverUrl: SERVER,
        username: 'alice',
        isActive: true,
      }),
    );
    expect(setPassword).toHaveBeenCalledWith('new-acc', 'app-password');
  });

  it('rejects an invalid login-flow init payload', async () => {
    const loginPromise = service.startLogin(SERVER);

    httpMock.expectOne('/nextcloud-proxy/index.php/login/v2').flush({ login: SERVER });

    await expect(loginPromise).rejects.toThrow(/ungültige Antwort/);
  });

  it('maps non-404 poll failures to a German HTTP error', async () => {
    const loginPromise = service.startLogin(SERVER);

    httpMock.expectOne('/nextcloud-proxy/index.php/login/v2').flush({
      login: `${SERVER}/index.php/login/v2`,
      poll: {
        endpoint: `${SERVER}/index.php/login/v2/poll/abc`,
        token: 'poll-token',
      },
    });

    await vi.advanceTimersByTimeAsync(2000);
    httpMock.expectOne('/nextcloud-proxy/index.php/login/v2/poll/abc').flush(
      'Server error',
      { status: 500, statusText: 'Internal Server Error' },
    );

    await expect(loginPromise).rejects.toThrow(/HTTP 500/);
  });

  it('times out when polling exceeds the limit', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    const loginPromise = service.startLogin(SERVER);
    const rejected = expect(loginPromise).rejects.toThrow(/Login-Timeout/);

    httpMock.expectOne('/nextcloud-proxy/index.php/login/v2').flush({
      login: `${SERVER}/index.php/login/v2`,
      poll: {
        endpoint: `${SERVER}/index.php/login/v2/poll/abc`,
        token: 'poll-token',
      },
    });

    await vi.advanceTimersByTimeAsync(2000);
    httpMock
      .expectOne('/nextcloud-proxy/index.php/login/v2/poll/abc')
      .flush('Not found', { status: 404, statusText: 'Not Found' });

    now.mockReturnValue(300_001);
    await vi.advanceTimersByTimeAsync(2000);

    await rejected;
    now.mockRestore();
  });

  it('tolerates Browser.close failures on web after a successful poll', async () => {
    vi.mocked(Browser.close).mockRejectedValueOnce(new Error('browser not open'));
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    const loginPromise = service.startLogin(SERVER);

    httpMock.expectOne('/nextcloud-proxy/index.php/login/v2').flush({
      login: `${SERVER}/index.php/login/v2`,
      poll: {
        endpoint: `${SERVER}/index.php/login/v2/poll/abc`,
        token: 'poll-token',
      },
    });

    await vi.advanceTimersByTimeAsync(2000);
    httpMock.expectOne('/nextcloud-proxy/index.php/login/v2/poll/abc').flush({
      server: SERVER,
      loginName: 'alice',
      appPassword: 'app-password',
    });

    await loginPromise;
    expect(setPassword).toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('maps a network outage during polling to a German network error', async () => {
    const loginPromise = service.startLogin(SERVER);

    httpMock.expectOne('/nextcloud-proxy/index.php/login/v2').flush({
      login: `${SERVER}/index.php/login/v2`,
      poll: {
        endpoint: `${SERVER}/index.php/login/v2/poll/abc`,
        token: 'poll-token',
      },
    });

    await vi.advanceTimersByTimeAsync(2000);
    httpMock
      .expectOne('/nextcloud-proxy/index.php/login/v2/poll/abc')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

    await expect(loginPromise).rejects.toThrow(/Netzwerkfehler/);
  });

  it('ignores 404 poll responses until credentials arrive', async () => {
    const loginPromise = service.startLogin(SERVER);

    httpMock.expectOne('/nextcloud-proxy/index.php/login/v2').flush({
      login: `${SERVER}/index.php/login/v2`,
      poll: {
        endpoint: `${SERVER}/index.php/login/v2/poll/abc`,
        token: 'poll-token',
      },
    });

    await vi.advanceTimersByTimeAsync(2000);
    httpMock.expectOne('/nextcloud-proxy/index.php/login/v2/poll/abc').flush(
      'Not found',
      { status: 404, statusText: 'Not Found' },
    );

    await vi.advanceTimersByTimeAsync(2000);
    httpMock.expectOne('/nextcloud-proxy/index.php/login/v2/poll/abc').flush({
      server: SERVER,
      loginName: 'alice',
      appPassword: 'app-password',
    });

    await loginPromise;
    expect(setPassword).toHaveBeenCalled();
  });
});

describe('AuthService.startLogin (native)', () => {
  it('opens the system browser for the login URL', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(service as unknown as { postNative: () => Promise<unknown> }, 'postNative')
      .mockResolvedValue({
        login: `${SERVER}/index.php/login/v2`,
        poll: {
          endpoint: `${SERVER}/index.php/login/v2/poll/abc`,
          token: 'poll-token',
        },
      });
    vi.spyOn(service as unknown as { pollNative: () => Promise<unknown> }, 'pollNative')
      .mockResolvedValue({
        server: SERVER,
        loginName: 'alice',
        appPassword: 'app-password',
      });

    const loginPromise = service.startLogin(SERVER);
    await vi.advanceTimersByTimeAsync(2000);
    await loginPromise;

    expect(Browser.open).toHaveBeenCalledWith({ url: `${SERVER}/index.php/login/v2` });
    expect(Browser.close).toHaveBeenCalled();
  });

  it('persists credentials after native HTTP poll succeeds', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const postNative = vi
      .spyOn(service as unknown as { postNative: () => Promise<unknown> }, 'postNative')
      .mockResolvedValue({
        login: `${SERVER}/index.php/login/v2`,
        poll: {
          endpoint: `${SERVER}/index.php/login/v2/poll/abc`,
          token: 'poll-token',
        },
      });
    const pollNative = vi
      .spyOn(service as unknown as { pollNative: () => Promise<unknown> }, 'pollNative')
      .mockResolvedValue({
        server: SERVER,
        loginName: 'alice',
        appPassword: 'app-password',
      });

    const loginPromise = service.startLogin(SERVER);
    await vi.advanceTimersByTimeAsync(2000);
    await loginPromise;

    expect(postNative).toHaveBeenCalledTimes(1);
    expect(pollNative).toHaveBeenCalledTimes(1);
    expect(setPassword).toHaveBeenCalledWith('new-acc', 'app-password');
    httpMock.expectNone('/nextcloud-proxy/index.php/login/v2');
  });

  it('sends the app User-Agent with device model on the native init POST', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const postNative = vi
      .spyOn(service as unknown as { postNative: () => Promise<unknown> }, 'postNative')
      .mockResolvedValue({
        login: `${SERVER}/index.php/login/v2`,
        poll: {
          endpoint: `${SERVER}/index.php/login/v2/poll/abc`,
          token: 'poll-token',
        },
      });
    vi.spyOn(service as unknown as { pollNative: () => Promise<unknown> }, 'pollNative')
      .mockResolvedValue({
        server: SERVER,
        loginName: 'alice',
        appPassword: 'app-password',
      });

    const loginPromise = service.startLogin(SERVER);
    await vi.advanceTimersByTimeAsync(2000);
    await loginPromise;

    expect(postNative).toHaveBeenCalledWith(
      expect.any(String),
      '',
      expect.objectContaining({
        'User-Agent': 'Sanctum - Nextcloud Superapp (Pixel 6 Pro)',
      }),
    );
  });
});

describe('AuthService.getValidToken', () => {
  it('returns the stored app password', async () => {
    await expect(service.getValidToken('acc-1')).resolves.toBe('app-password');
  });

  it('throws when no password is stored', async () => {
    getPassword.mockResolvedValue(null);
    await expect(service.getValidToken('acc-1')).rejects.toThrow(/Kein App-Passwort/);
  });
});

describe('AuthService.logout', () => {
  it('removes the account and navigates to login when no accounts remain', async () => {
    accountCount$.next(0);

    await service.logout('acc-1');

    expect(removeAccount).toHaveBeenCalledWith('acc-1');
    expect(navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
  });

  it('does not navigate when other accounts remain', async () => {
    accountCount$.next(2);

    await service.logout('acc-1');

    expect(removeAccount).toHaveBeenCalledWith('acc-1');
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('AuthService.logoutAll', () => {
  it('removes every account and navigates to login', async () => {
    accounts$.next([{ id: 'acc-1' }, { id: 'acc-2' }]);

    await service.logoutAll();

    expect(removeAccount).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
  });
});

describe('AuthService.hasAccounts', () => {
  it('reflects the current account count', async () => {
    accountCount$.next(0);
    await expect(service.hasAccounts()).resolves.toBe(false);
    accountCount$.next(1);
    await expect(service.hasAccounts()).resolves.toBe(true);
  });
});
