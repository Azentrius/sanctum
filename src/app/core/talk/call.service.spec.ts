// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { OcsClientService } from '../http/ocs-client.service';
import { CallService } from './call.service';

let service: CallService;
let request: ReturnType<typeof vi.fn>;

beforeEach(() => {
  request = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      CallService,
      { provide: OcsClientService, useValue: { request } },
    ],
  });
  service = TestBed.inject(CallService);
});

describe('CallService', () => {
  it('joins a call with audio/video flags', async () => {
    request.mockResolvedValue({ sessionId: 'sess-1', inCall: 1 });

    const result = await service.joinCall('acc-1', 'room1', {
      audio: true,
      video: true,
    });

    expect(result.sessionId).toBe('sess-1');
    expect(request).toHaveBeenCalledWith(
      'acc-1',
      'POST',
      'apps/spreed/api/v4/call/room1',
      { flags: 3 },
    );
  });

  it('leaves a call via DELETE', async () => {
    request.mockResolvedValue(null);
    await service.leaveCall('acc-1', 'room1');
    expect(request).toHaveBeenCalledWith(
      'acc-1',
      'DELETE',
      'apps/spreed/api/v4/call/room1',
    );
  });

  it('loads signaling settings for a room', async () => {
    request.mockResolvedValue({
      signalingMode: 'internal',
      servers: [{ server: 'nc', url: 'wss://cloud.example.com/ws' }],
    });

    const settings = await service.getSignalingSettings('acc-1', 'room1');

    expect(settings.signalingMode).toBe('internal');
    expect(settings.servers[0].url).toBe('wss://cloud.example.com/ws');
    expect(request).toHaveBeenCalledWith(
      'acc-1',
      'GET',
      'apps/spreed/api/v4/signaling/settings',
      undefined,
      { token: 'room1' },
    );
  });
});
