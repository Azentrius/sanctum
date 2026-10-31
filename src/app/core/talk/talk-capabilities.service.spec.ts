// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { CapabilitiesService } from '../capabilities/capabilities.service';
import { OcsClientService } from '../http/ocs-client.service';
import { TalkCapabilitiesService } from './talk-capabilities.service';

let service: TalkCapabilitiesService;
const request = vi.fn();
const ensureLoaded = vi.fn();
const isAppAvailable = vi.fn();
const getAppCapabilities = vi.fn();
const invalidate = vi.fn();

beforeEach(() => {
  request.mockReset();
  ensureLoaded.mockReset();
  isAppAvailable.mockReset();
  getAppCapabilities.mockReset();
  invalidate.mockReset();

  ensureLoaded.mockResolvedValue({
    accountId: 'acc-1',
    fetchedAt: new Date(),
    version: null,
    apps: {},
    status: null,
  });
  isAppAvailable.mockReturnValue(true);
  getAppCapabilities.mockReturnValue({
    features: ['audio', 'video'],
    config: { 'chat-v2': true, 'signaling-mode': 'internal' },
  });
  invalidate.mockResolvedValue(undefined);

  TestBed.configureTestingModule({
    providers: [
      TalkCapabilitiesService,
      {
        provide: CapabilitiesService,
        useValue: {
          ensureLoaded,
          isAppAvailable,
          getAppCapabilities,
          invalidate,
        },
      },
      {
        provide: OcsClientService,
        useValue: { request },
      },
    ],
  });
  service = TestBed.inject(TalkCapabilitiesService);
});

describe('TalkCapabilitiesService', () => {
  it('detects Talk availability from central capabilities', async () => {
    await expect(service.isTalkAvailable('acc-1')).resolves.toBe(true);
    await expect(service.hasChatV2('acc-1')).resolves.toBe(true);
    await expect(service.getSignalingMode('acc-1')).resolves.toBe('internal');
    expect(ensureLoaded).toHaveBeenCalledWith('acc-1');
  });

  it('checks individual spreed features', async () => {
    getAppCapabilities.mockReturnValue({
      features: ['chat-v2', 'chat-read-last'],
      config: { 'chat-v2': true },
    });

    await expect(service.hasSpreedFeature('acc-1', 'chat-read-last')).resolves.toBe(
      true,
    );
    await expect(service.hasSpreedFeature('acc-1', 'missing-feature')).resolves.toBe(
      false,
    );
  });

  it('returns false when capabilities are empty and room probe fails', async () => {
    isAppAvailable.mockReturnValue(false);
    getAppCapabilities.mockReturnValue(undefined);
    request.mockRejectedValue(new Error('404'));

    await expect(service.isTalkAvailable('acc-2')).resolves.toBe(false);
    expect(request).toHaveBeenCalled();
  });

  it('probes the room list when capabilities are empty but app section exists', async () => {
    isAppAvailable.mockReturnValue(true);
    getAppCapabilities.mockReturnValue({ features: [], config: {} });
    request.mockResolvedValue([{ token: 'room1', type: 2 }]);

    await expect(service.isTalkAvailable('acc-3')).resolves.toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('delegates invalidate to CapabilitiesService', async () => {
    await service.invalidate('acc-4');
    expect(invalidate).toHaveBeenCalledWith('acc-4');
  });
});
