// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountService } from '../accounts/account.service';
import { CapabilitiesService } from '../capabilities/capabilities.service';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { LocalDbService } from '../storage/local-db.service';
import { mapNote } from './notes.map';
import { NotesApiClientService } from './notes-api-client.service';
import { ApiNote } from './notes.model';
import { NotesService } from './notes.service';

const ACCOUNT_ID = 'acc-1';
const RAW: ApiNote = {
  id: 1,
  etag: 'etag-1',
  readonly: false,
  modified: 1_700_000_000,
  title: 'Test',
  category: '',
  content: 'Hello',
  favorite: false,
};

describe('NotesService', () => {
  let service: NotesService;
  const api = {
    listNotes: vi.fn(),
    getNote: vi.fn(),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
  };
  const localDb = {
    getAllNotes: vi.fn().mockResolvedValue([]),
    getNotes: vi.fn().mockResolvedValue([]),
    replaceNotesForAccount: vi.fn().mockResolvedValue(undefined),
    saveNotes: vi.fn().mockResolvedValue(undefined),
    saveNotesSync: vi.fn().mockResolvedValue(undefined),
    getNote: vi.fn().mockResolvedValue(null),
    deleteNote: vi.fn().mockResolvedValue(undefined),
  };
  const capabilities = {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    isAppAvailable: vi.fn().mockReturnValue(true),
  };
  const connectivity = {
    isOnline: vi.fn().mockReturnValue(true),
  };
  const activeAccounts$ = new BehaviorSubject([{ id: ACCOUNT_ID }]);

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      providers: [
        NotesService,
        { provide: NotesApiClientService, useValue: api },
        { provide: LocalDbService, useValue: localDb },
        { provide: CapabilitiesService, useValue: capabilities },
        { provide: ConnectivityService, useValue: connectivity },
        {
          provide: AccountService,
          useValue: { activeAccounts: activeAccounts$.asObservable() },
        },
      ],
    }).compileComponents();
    service = TestBed.inject(NotesService);
  });

  it('loads notes from API and caches them', async () => {
    api.listNotes.mockResolvedValue([mapNote(ACCOUNT_ID, RAW)]);
    await service.loadNotesForAccount(ACCOUNT_ID, { force: true });
    expect(localDb.replaceNotesForAccount).toHaveBeenCalled();
    const notes = await new Promise((resolve) => {
      service.allNotes.subscribe((value) => resolve(value));
    });
    expect(notes).toHaveLength(1);
  });

  it('falls back to cache on network errors', async () => {
    const cached = [mapNote(ACCOUNT_ID, RAW)];
    localDb.getNotes.mockResolvedValue(cached);
    api.listNotes.mockRejectedValue(new Error('Netzwerkfehler'));
    await service.loadNotesForAccount(ACCOUNT_ID, { force: true });
    const notes = await new Promise((resolve) => {
      service.allNotes.subscribe((value) => resolve(value));
    });
    expect(notes).toEqual(cached);
  });
});
