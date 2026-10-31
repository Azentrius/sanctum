// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, take } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { OcsClientService } from '../http/ocs-client.service';
import { ParticipantsService } from './participants.service';

const ACCOUNT_A = 'acc-a';
const TOKEN = 'room1';

let service: ParticipantsService;
let request: ReturnType<typeof vi.fn>;
let getAccount: ReturnType<typeof vi.fn>;

beforeEach(() => {
  request = vi.fn();
  getAccount = vi.fn().mockResolvedValue({
    id: ACCOUNT_A,
    serverUrl: 'https://cloud.example.com',
  });

  TestBed.configureTestingModule({
    providers: [
      ParticipantsService,
      { provide: OcsClientService, useValue: { request } },
      { provide: AccountService, useValue: { getAccount } },
    ],
  });
  service = TestBed.inject(ParticipantsService);
});

describe('ParticipantsService', () => {
  it('loads participants from the Talk API', async () => {
    request.mockResolvedValue([
      {
        attendeeId: 7,
        actorType: 'users',
        actorId: 'alice',
        displayName: 'Alice',
        participantType: 3,
      },
      {
        attendeeId: 8,
        actorType: 'guests',
        actorId: 'guest-1',
        displayName: 'Guest',
        participantType: 1,
      },
    ]);

    const loaded = await service.loadParticipants(ACCOUNT_A, TOKEN);

    expect(request).toHaveBeenCalledWith(
      ACCOUNT_A,
      'GET',
      `apps/spreed/api/v4/room/${TOKEN}/participants`,
    );
    expect(loaded).toHaveLength(2);
    expect(loaded[0].displayName).toBe('Alice');
    expect(loaded[0].avatarUrl).toContain('/avatar/alice/64');
    expect(loaded[1].avatarUrl).toBeUndefined();
  });

  it('exposes participants via observable', async () => {
    request.mockResolvedValue([
      {
        attendeeId: 1,
        actorType: 'users',
        actorId: 'bob',
        displayName: 'Bob',
      },
    ]);

    await service.loadParticipants(ACCOUNT_A, TOKEN);
    const participants = await firstValueFrom(
      service.getParticipants(ACCOUNT_A, TOKEN).pipe(take(1)),
    );
    expect(participants[0].displayName).toBe('Bob');
  });
});
