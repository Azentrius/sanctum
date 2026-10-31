// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, firstValueFrom, map, Observable, take } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { CapabilitiesService } from '../capabilities/capabilities.service';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { isOfflineWriteBlockedError, OfflineWriteBlockedError } from '../connectivity/offline-write-blocked.error';
import { LocalDbService } from '../storage/local-db.service';
import { isNotesConflictError } from './notes-conflict.error';
import { parseNoteId } from './notes.map';
import { NotesApiClientService } from './notes-api-client.service';
import { Note, NoteWritePayload } from './notes.model';

export interface NotesLoadOptions {
  force?: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotesService {
  private readonly api = inject(NotesApiClientService);
  private readonly accountService = inject(AccountService);
  private readonly capabilities = inject(CapabilitiesService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly localDb = inject(LocalDbService);

  private readonly notes$ = new BehaviorSubject<Note[]>([]);

  get allNotes(): Observable<Note[]> {
    return this.notes$.asObservable();
  }

  getNoteById(id: string): Observable<Note | undefined> {
    return this.allNotes.pipe(map((notes) => notes.find((note) => note.id === id)));
  }

  async loadFromCache(): Promise<void> {
    const cached = await this.localDb.getAllNotes();
    this.notes$.next(this.sortNotes(cached));
  }

  async loadNotesForAccount(
    accountId: string,
    options: NotesLoadOptions = {},
  ): Promise<void> {
    if (!options.force) {
      const cached = await this.localDb.getNotes(accountId);
      if (cached.length > 0) {
        this.mergeNotesForAccount(accountId, cached);
      }
    }

    await this.capabilities.ensureLoaded(accountId);
    if (!this.capabilities.isAppAvailable(accountId, 'notes')) {
      const cached = await this.localDb.getNotes(accountId);
      this.mergeNotesForAccount(accountId, cached);
      return;
    }

    try {
      const notes = await this.api.listNotes(accountId);
      await this.localDb.replaceNotesForAccount(accountId, notes);
      await this.localDb.saveNotesSync(accountId, new Date());
      this.mergeNotesForAccount(accountId, notes);
    } catch (error) {
      if (this.isNetworkError(error)) {
        const cached = await this.localDb.getNotes(accountId);
        this.mergeNotesForAccount(accountId, cached);
        return;
      }
      throw this.toGermanError(error, 'Notizen konnten nicht geladen werden.');
    }
  }

  async loadNoteContent(accountId: string, noteId: number): Promise<Note> {
    try {
      const note = await this.api.getNote(accountId, noteId);
      await this.localDb.saveNotes(accountId, [note]);
      this.upsertNote(note);
      return note;
    } catch (error) {
      if (this.isNetworkError(error)) {
        const cached = await this.localDb.getNote(`${accountId}:${noteId}`);
        if (cached) {
          return cached;
        }
      }
      throw this.toGermanError(error, 'Notiz konnte nicht geladen werden.');
    }
  }

  async createNote(accountId: string, payload: NoteWritePayload): Promise<Note> {
    this.assertOnlineWrite();
    const note = await this.api.createNote(accountId, payload);
    await this.localDb.saveNotes(accountId, [note]);
    this.upsertNote(note);
    return note;
  }

  async updateNote(
    id: string,
    payload: NoteWritePayload,
    etag?: string,
  ): Promise<Note> {
    this.assertOnlineWrite();
    const parsed = parseNoteId(id);
    if (!parsed) {
      throw new Error('Ungültige Notiz-ID.');
    }
    try {
      const note = await this.api.updateNote(
        parsed.accountId,
        parsed.noteId,
        payload,
        etag,
      );
      await this.localDb.saveNotes(parsed.accountId, [note]);
      this.upsertNote(note);
      return note;
    } catch (error) {
      if (isNotesConflictError(error)) {
        await this.localDb.saveNotes(parsed.accountId, [error.serverNote]);
        this.upsertNote(error.serverNote);
      }
      throw error;
    }
  }

  async deleteNote(id: string): Promise<void> {
    this.assertOnlineWrite();
    const parsed = parseNoteId(id);
    if (!parsed) {
      throw new Error('Ungültige Notiz-ID.');
    }
    await this.api.deleteNote(parsed.accountId, parsed.noteId);
    await this.localDb.deleteNote(parsed.accountId, parsed.noteId);
    this.notes$.next(
      this.notes$.value.filter((note) => note.id !== id),
    );
  }

  async syncAll(options: NotesLoadOptions = {}): Promise<void> {
    const accounts = await firstValueFrom(this.accountService.activeAccounts.pipe(take(1)));
    await Promise.all(
      accounts.map((account) => this.loadNotesForAccount(account.id, options)),
    );
  }

  private mergeNotesForAccount(accountId: string, notes: Note[]): void {
    const others = this.notes$.value.filter((note) => note.accountId !== accountId);
    this.notes$.next(this.sortNotes([...others, ...notes]));
  }

  private upsertNote(note: Note): void {
    const exists = this.notes$.value.some((item) => item.id === note.id);
    const next = exists
      ? this.notes$.value.map((item) => (item.id === note.id ? note : item))
      : [...this.notes$.value, note];
    this.notes$.next(this.sortNotes(next));
  }

  private sortNotes(notes: Note[]): Note[] {
    return [...notes].sort((a, b) => {
      if (a.favorite !== b.favorite) {
        return a.favorite ? -1 : 1;
      }
      return b.modified.getTime() - a.modified.getTime();
    });
  }

  private assertOnlineWrite(): void {
    if (!this.connectivity.isOnline()) {
      throw new OfflineWriteBlockedError();
    }
  }

  private isNetworkError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('netzwerk') ||
        message.includes('network') ||
        message.includes('zeitüberschreitung') ||
        message.includes('timeout')
      );
    }
    return false;
  }

  private toGermanError(error: unknown, fallback: string): Error {
    if (isOfflineWriteBlockedError(error) || isNotesConflictError(error)) {
      return error;
    }
    if (error instanceof Error) {
      return error;
    }
    return new Error(fallback);
  }
}
