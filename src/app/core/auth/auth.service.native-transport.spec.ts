// SPDX-License-Identifier: GPL-3.0-or-later
// Regression coverage for the native login transport: the CertPin plugin
// returns the response body as a RAW STRING regardless of responseType:'json'
// (see android .../CertPinPlugin.java). postNative/pollNative must run it
// through normalizeNativeHttpBody: otherwise startLogin sees a string instead
// of the parsed login-flow payload and throws "ungültige Antwort vom Server".
//
// The existing auth.service.spec.ts native tests spy on postNative/pollNative
// directly, which bypasses exactly this parsing: so this lives in its own file
// and mocks one level deeper, at the @capacitor/core transport (same pattern as
// native-http.util.spec.ts). Mocking a package import (not a relative one)
// keeps Angular's Vitest happy.
const certPinRequest = vi.hoisted(() => vi.fn());
const isNativePlatform = vi.hoisted(() => vi.fn(() => true));

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: { request: vi.fn() },
  Capacitor: { isNativePlatform },
  registerPlugin: vi.fn(() => ({ request: certPinRequest })),
}));

// observability.ts (pulled in transitively) loads `* as Sentry from
// '@sentry/capacitor'`, whose module init calls Capacitor.getPlatform(). Mock it
// so the real wrapper never evaluates against this spec's minimal Capacitor mock.
vi.mock('@sentry/capacitor', () => ({
  init: vi.fn(),
  setTag: vi.fn(),
  close: vi.fn(async () => true),
}));

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountService } from '../accounts/account.service';
import { CertPinService } from '../security/cert-pin.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

type PrivateTransport = {
  postNative<T>(url: string, body: string, headers: Record<string, string>): Promise<T>;
  pollNative(endpoint: string, token: string): Promise<unknown>;
};

let service: AuthService;

beforeEach(() => {
  isNativePlatform.mockReturnValue(true);
  certPinRequest.mockReset();

  TestBed.configureTestingModule({
    providers: [
      AuthService,
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: AccountService,
        useValue: {
          accountCount: new BehaviorSubject(0).asObservable(),
          accounts: new BehaviorSubject([]).asObservable(),
          addAccount: vi.fn(),
          removeAccount: vi.fn(),
        },
      },
      {
        provide: TokenService,
        useValue: { setPassword: vi.fn(), getPassword: vi.fn(), clearPassword: vi.fn() },
      },
      { provide: CertPinService, useValue: { establishTofuPin: vi.fn() } },
      { provide: Router, useValue: { navigate: vi.fn() } },
    ],
  });

  service = TestBed.inject(AuthService);
});

describe('AuthService native CertPin transport', () => {
  it('parses a string JSON init body into the login-flow payload', async () => {
    const payload = {
      login: 'https://cloud.example.com/index.php/login/v2/flow/abc',
      poll: {
        endpoint: 'https://cloud.example.com/index.php/login/v2/poll',
        token: 'poll-token',
      },
    };
    certPinRequest.mockResolvedValue({
      status: 200,
      headers: {},
      data: JSON.stringify(payload), // CertPin hands back a raw string
      url: 'https://cloud.example.com/index.php/login/v2',
    });

    const result = await (service as unknown as PrivateTransport).postNative(
      'https://cloud.example.com/index.php/login/v2',
      '',
      {},
    );

    // Before the fix this resolved to the raw string, so .login was undefined
    // and startLogin threw. It must be the parsed object.
    expect(result).toEqual(payload);
  });

  it('parses a string JSON poll body into credentials', async () => {
    const credentials = {
      server: 'https://cloud.example.com',
      loginName: 'alice',
      appPassword: 'app-password',
    };
    certPinRequest.mockResolvedValue({
      status: 200,
      headers: {},
      data: JSON.stringify(credentials),
      url: 'https://cloud.example.com/index.php/login/v2/poll',
    });

    const result = await (service as unknown as PrivateTransport).pollNative(
      'https://cloud.example.com/index.php/login/v2/poll',
      'poll-token',
    );

    expect(result).toEqual(credentials);
  });
});
