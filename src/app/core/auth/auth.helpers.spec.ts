// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';

import { AccountService } from '../accounts/account.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

/**
 * Pure helpers on AuthService: server-URL normalization (scheme defaulting +
 * trailing-slash trimming) and error-to-German mapping. Resolved via TestBed
 * with all injected dependencies stubbed; the helpers touch none of them.
 */
let service: AuthService;

type Internals = {
  normalizeServerUrl(url: string): string;
  toGermanError(error: unknown): Error;
};
const internals = (): Internals => service as unknown as Internals;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      AuthService,
      { provide: HttpClient, useValue: {} },
      { provide: AccountService, useValue: {} },
      { provide: TokenService, useValue: {} },
      { provide: Router, useValue: {} },
    ],
  });
  service = TestBed.inject(AuthService);
});

describe('AuthService.normalizeServerUrl', () => {
  it('delegates HTTPS normalization to server-url.util', () => {
    expect(internals().normalizeServerUrl('cloud.example.com')).toBe('https://cloud.example.com');
    expect(() => internals().normalizeServerUrl('http://cloud.example.com')).toThrow(
      /Nur HTTPS-Server werden unterstützt/,
    );
  });
});

describe('AuthService.toGermanError', () => {
  it('maps a status-0 HttpErrorResponse to a network error', () => {
    const result = internals().toGermanError(new HttpErrorResponse({ status: 0 }));
    expect(result.message).toBe('Netzwerkfehler. Keine Verbindung zum Server.');
  });

  it('includes the HTTP status for other HttpErrorResponses', () => {
    const result = internals().toGermanError(new HttpErrorResponse({ status: 401 }));
    expect(result.message).toBe('Anmeldung fehlgeschlagen. (HTTP 401).');
  });

  it('passes a plain Error through unchanged', () => {
    const original = new Error('boom');
    expect(internals().toGermanError(original)).toBe(original);
  });

  it('falls back to a generic message for non-Error values', () => {
    expect(internals().toGermanError('nope').message).toBe('Anmeldung fehlgeschlagen.');
  });
});
