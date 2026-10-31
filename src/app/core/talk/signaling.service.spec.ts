// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { AccountService } from '../accounts/account.service';
import { TokenService } from '../auth/token.service';
import { CallService } from './call.service';
import { SignalingService } from './signaling.service';

let service: SignalingService;
let joinCall: ReturnType<typeof vi.fn>;
let leaveCall: ReturnType<typeof vi.fn>;

beforeEach(() => {
  joinCall = vi.fn();
  leaveCall = vi.fn().mockResolvedValue(undefined);

  TestBed.configureTestingModule({
    providers: [
      SignalingService,
      {
        provide: CallService,
        useValue: {
          joinCall,
          leaveCall,
          getSignalingSettings: vi.fn(),
        },
      },
      { provide: AccountService, useValue: { getAccount: vi.fn() } },
      { provide: TokenService, useValue: { getPassword: vi.fn() } },
    ],
  });
  service = TestBed.inject(SignalingService);
});

describe('SignalingService', () => {
  it('notifies session listeners and allows unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = service.onSessionChange(listener);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'idle', error: null }),
    );

    unsubscribe();
    service.toggleAudio(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('toggles local audio and video tracks when a stream is present', () => {
    const audioTrack = { enabled: true };
    const videoTrack = { enabled: true };
    const listener = vi.fn();

    (
      service as unknown as { localStream: MediaStream | null }
    ).localStream = {
      getAudioTracks: () => [audioTrack as MediaStreamTrack],
      getVideoTracks: () => [videoTrack as MediaStreamTrack],
    } as MediaStream;

    service.onSessionChange(listener);
    service.toggleAudio(false);
    service.toggleVideo(false);

    expect(audioTrack.enabled).toBe(false);
    expect(videoTrack.enabled).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it('ends the call best-effort and moves to closed state', async () => {
    (
      service as unknown as { accountId: string; token: string }
    ).accountId = 'acc-1';
    (
      service as unknown as { token: string }
    ).token = 'room1';

    const listener = vi.fn();
    service.onSessionChange(listener);

    await service.endCall();

    expect(leaveCall).toHaveBeenCalledWith('acc-1', 'room1');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'closed' }),
    );
  });
});
