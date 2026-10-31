// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { PushService } from '../push/push.service';
import { TalkPushService } from './talk-push.service';

let service: TalkPushService;
const pushInit = vi.fn();
const pushRegister = vi.fn();
const pushNavigate = vi.fn();
const pushParse = vi.fn();

beforeEach(() => {
  pushInit.mockReset();
  pushRegister.mockReset();
  pushNavigate.mockReset();
  pushParse.mockReset();
  pushInit.mockResolvedValue(undefined);
  pushRegister.mockResolvedValue(undefined);
  pushParse.mockReturnValue(null);

  TestBed.configureTestingModule({
    providers: [
      TalkPushService,
      {
        provide: PushService,
        useValue: {
          init: pushInit,
          registerForAllAccounts: pushRegister,
          navigateToRoom: pushNavigate,
          parseDeepLink: pushParse,
        },
      },
      { provide: Router, useValue: { navigate: vi.fn() } },
    ],
  });
  service = TestBed.inject(TalkPushService);
});

describe('TalkPushService', () => {
  it('delegates init to PushService', async () => {
    await service.init();
    expect(pushInit).toHaveBeenCalled();
  });

  it('delegates registerForAllAccounts to PushService', async () => {
    await service.registerForAllAccounts();
    expect(pushRegister).toHaveBeenCalled();
  });

  it('builds registration payload with device public key', () => {
    const payload = service.buildRegistrationPayload(
      'acc-1',
      'push-token-xyz',
      'device-id',
      'android',
      'Pixel 8',
      'PUBLIC-KEY-PEM',
    );

    expect(payload['devicePublicKey']).toBe('PUBLIC-KEY-PEM');
    expect(payload['pushToken']).toBe('push-token-xyz');
  });

  it('delegates navigation to PushService', () => {
    service.navigateToRoom('acc-1', 'roomtoken');
    expect(pushNavigate).toHaveBeenCalledWith('acc-1', 'roomtoken');
  });

  it('parses deep links locally', () => {
    expect(service.parseDeepLink('sanctum://talk/acc-1/token')).toEqual({
      accountId: 'acc-1',
      token: 'token',
    });
  });
});
