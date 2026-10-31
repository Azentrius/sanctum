// SPDX-License-Identifier: GPL-3.0-or-later
const certPinRequest = vi.hoisted(() => vi.fn());
const certPinCapturePin = vi.hoisted(() => vi.fn());
const certPinSyncPins = vi.hoisted(() => vi.fn());
const isNativePlatform = vi.hoisted(() => vi.fn(() => true));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform },
  registerPlugin: vi.fn(() => ({
    request: certPinRequest,
    capturePin: certPinCapturePin,
    syncPins: certPinSyncPins,
  })),
}));

// observability.ts (pulled in transitively) loads `* as Sentry from
// '@sentry/capacitor'`, whose module init calls Capacitor.getPlatform(). Mock it
// so the real wrapper never evaluates against this spec's minimal Capacitor mock.
vi.mock('@sentry/capacitor', () => ({
  init: vi.fn(),
  setTag: vi.fn(),
  close: vi.fn(async () => true),
}));

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SecureCredentialStore } from '../auth/secure-credential-store.service';
import { CERT_PIN_MISMATCH_CODE, CertPinMismatchError } from './cert-pin.error';
import { CertPinMismatchService } from './cert-pin-mismatch.service';
import { CertPinService } from './cert-pin.service';
import { notifyCertPinTransportError } from './cert-pin-transport.hook';

describe('CertPinService', () => {
  let service: CertPinService;
  const setCertPin = vi.fn();
  const getCertPin = vi.fn();
  const removeCertPin = vi.fn();

  beforeEach(() => {
    isNativePlatform.mockReturnValue(true);
    certPinRequest.mockReset();
    certPinCapturePin.mockReset();
    certPinSyncPins.mockReset();
    certPinCapturePin.mockResolvedValue({ hashes: ['sha256/abc', 'sha256/def'] });
    certPinSyncPins.mockResolvedValue(undefined);
    setCertPin.mockReset();
    getCertPin.mockReset();
    removeCertPin.mockReset();
    getCertPin.mockResolvedValue(null);
    setCertPin.mockImplementation(async (accountId: string, value: string) => {
      getCertPin.mockImplementation(async (id: string) => (id === accountId ? value : null));
    });
    removeCertPin.mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        CertPinService,
        CertPinMismatchService,
        {
          provide: SecureCredentialStore,
          useValue: { setCertPin, getCertPin, removeCertPin },
        },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });

    service = TestBed.inject(CertPinService);
  });

  it('captures and stores TOFU pins after first login', async () => {
    await service.establishTofuPin('acc-1', 'https://cloud.example.com');

    expect(certPinCapturePin).toHaveBeenCalledWith({
      url: 'https://cloud.example.com/status.php',
    });
    expect(setCertPin).toHaveBeenCalledWith(
      'acc-1',
      JSON.stringify({
        host: 'cloud.example.com',
        hashes: ['sha256/abc', 'sha256/def'],
      }),
    );
    expect(certPinSyncPins).toHaveBeenCalledWith({
      pins: [{ host: 'cloud.example.com', hashes: ['sha256/abc', 'sha256/def'] }],
    });
  });

  it('skips capture when a pin already exists for the host', async () => {
    getCertPin.mockResolvedValue(
      JSON.stringify({ host: 'cloud.example.com', hashes: ['sha256/stored'] }),
    );

    await service.establishTofuPin('acc-1', 'https://cloud.example.com');

    expect(certPinCapturePin).not.toHaveBeenCalled();
    expect(certPinSyncPins).toHaveBeenCalled();
  });

  it('syncs stored pins for all accounts on init', async () => {
    getCertPin.mockResolvedValue(
      JSON.stringify({ host: 'cloud.example.com', hashes: ['sha256/stored'] }),
    );

    await service.initForAccounts([
      { id: 'acc-1', serverUrl: 'https://cloud.example.com' },
    ]);

    expect(certPinSyncPins).toHaveBeenCalledWith({
      pins: [{ host: 'cloud.example.com', hashes: ['sha256/stored'] }],
    });
  });

  it('treats a generic TLS failure (e.g. expired cert) as a normal error, not a pin mismatch', () => {
    const mismatchService = TestBed.inject(CertPinMismatchService);
    const setMismatch = vi.spyOn(mismatchService, 'setMismatch');

    expect(() =>
      service.handleTransportError(
        new Error('The certificate for this server is invalid (expired)'),
        'https://cloud.example.com/remote.php/dav',
      ),
    ).not.toThrow();
    expect(setMismatch).not.toHaveBeenCalled();
  });

  it('flags a real pin mismatch and rethrows CertPinMismatchError', () => {
    const mismatchService = TestBed.inject(CertPinMismatchService);
    const setMismatch = vi
      .spyOn(mismatchService, 'setMismatch')
      .mockImplementation(() => undefined);

    expect(() =>
      service.handleTransportError(
        { code: CERT_PIN_MISMATCH_CODE },
        'https://cloud.example.com/remote.php/dav',
      ),
    ).toThrow(CertPinMismatchError);
    expect(setMismatch).toHaveBeenCalledWith({
      host: 'cloud.example.com',
      serverUrl: 'https://cloud.example.com/remote.php/dav',
    });
  });

  it('uses unknown host when mismatch has no request URL', () => {
    const mismatchService = TestBed.inject(CertPinMismatchService);
    const setMismatch = vi
      .spyOn(mismatchService, 'setMismatch')
      .mockImplementation(() => undefined);

    expect(() => service.handleTransportError({ code: CERT_PIN_MISMATCH_CODE })).toThrow(
      CertPinMismatchError,
    );
    expect(setMismatch).toHaveBeenCalledWith({
      host: 'unknown',
      serverUrl: '',
    });
  });

  it('skips storing when capture returns no hashes', async () => {
    certPinCapturePin.mockResolvedValue({ hashes: [] });

    await service.establishTofuPin('acc-1', 'https://cloud.example.com');

    expect(setCertPin).not.toHaveBeenCalled();
    expect(certPinSyncPins).not.toHaveBeenCalled();
  });

  it('ignores invalid stored pin payloads during sync', async () => {
    getCertPin.mockResolvedValue('not-json');

    await service.initForAccounts([
      { id: 'acc-1', serverUrl: 'https://cloud.example.com' },
    ]);

    expect(certPinSyncPins).toHaveBeenCalledWith({ pins: [] });
  });

  it('ignores stored pins with an invalid shape', async () => {
    getCertPin.mockResolvedValue(JSON.stringify({ host: 'cloud.example.com' }));

    await service.initForAccounts([
      { id: 'acc-1', serverUrl: 'https://cloud.example.com' },
    ]);

    expect(certPinSyncPins).toHaveBeenCalledWith({ pins: [] });
  });

  it('skips pins when the stored host does not match the account server', async () => {
    getCertPin.mockResolvedValue(
      JSON.stringify({ host: 'other.example.com', hashes: ['sha256/stored'] }),
    );

    await service.syncNativePins([
      { id: 'acc-1', serverUrl: 'https://cloud.example.com' },
    ]);

    expect(certPinSyncPins).toHaveBeenCalledWith({ pins: [] });
  });

  it('removes stored pins without syncing native state', async () => {
    await service.removePin('acc-1');
    expect(removeCertPin).toHaveBeenCalledWith('acc-1');
  });

  it('handles pin mismatches via the registered transport hook', () => {
    const mismatchService = TestBed.inject(CertPinMismatchService);
    const setMismatch = vi
      .spyOn(mismatchService, 'setMismatch')
      .mockImplementation(() => undefined);

    expect(() =>
      notifyCertPinTransportError(
        { code: CERT_PIN_MISMATCH_CODE },
        'https://cloud.example.com/remote.php/dav',
      ),
    ).toThrow(CertPinMismatchError);
    expect(setMismatch).toHaveBeenCalled();
  });

  it('no-ops establishTofuPin on web', async () => {
    isNativePlatform.mockReturnValue(false);

    await service.establishTofuPin('acc-1', 'https://cloud.example.com');

    expect(certPinCapturePin).not.toHaveBeenCalled();
    expect(setCertPin).not.toHaveBeenCalled();
  });

  it('no-ops initForAccounts on web', async () => {
    isNativePlatform.mockReturnValue(false);

    await service.initForAccounts([
      { id: 'acc-1', serverUrl: 'https://cloud.example.com' },
    ]);

    expect(certPinSyncPins).not.toHaveBeenCalled();
  });

  it('no-ops syncNativePins on web', async () => {
    isNativePlatform.mockReturnValue(false);

    await service.syncNativePins([
      { id: 'acc-1', serverUrl: 'https://cloud.example.com' },
    ]);

    expect(certPinSyncPins).not.toHaveBeenCalled();
  });

  it('skips accounts with empty hash lists during sync', async () => {
    getCertPin.mockResolvedValue(
      JSON.stringify({ host: 'cloud.example.com', hashes: [] }),
    );

    await service.syncNativePins([
      { id: 'acc-1', serverUrl: 'https://cloud.example.com' },
    ]);

    expect(certPinSyncPins).toHaveBeenCalledWith({ pins: [] });
  });
});
