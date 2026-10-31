// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Storage } from '@ionic/storage-angular';
import { Preferences } from '@capacitor/preferences';

import { AccountCalendar, CalendarEvent, Task } from '../accounts/account.model';
import { AddressBook, Contact } from '../carddav/contact.model';
import { Note } from '../notes/notes.model';
import { TalkConversation, TalkMessage } from '../talk/talk.model';
import { FileItem } from '../webdav/file.model';
import { EncryptedCacheStorageService } from './encrypted-cache-storage.service';
import { StorageUnavailableService } from './storage-unavailable.service';

interface StoredCalendarEvent
  extends Omit<CalendarEvent, 'start' | 'end' | 'lastModified'> {
  start: string;
  end: string;
  lastModified?: string;
}

interface StoredContact extends Omit<Contact, 'birthday'> {
  birthday?: string;
}

interface StoredTask
  extends Omit<Task, 'due' | 'completedAt' | 'lastModified'> {
  due?: string;
  completedAt?: string;
  lastModified?: string;
}

interface StoredFileItem extends Omit<FileItem, 'lastModified'> {
  lastModified?: string;
}

interface StoredTalkConversation
  extends Omit<TalkConversation, 'lastActivity' | 'lastMessage'> {
  lastActivity: string;
  lastMessage?: {
    id: number;
    actorDisplayName: string;
    message: string;
    timestamp: string;
  };
}

interface StoredTalkMessage extends Omit<TalkMessage, 'timestamp'> {
  timestamp: string;
}

interface StoredNote extends Omit<Note, 'modified'> {
  modified: string;
}

@Injectable({ providedIn: 'root' })
export class LocalDbService {
  private readonly storage = inject(Storage);
  private readonly encryptedCache = inject(EncryptedCacheStorageService);
  private readonly storageUnavailable = inject(StorageUnavailableService);

  private readonly dataKeyPrefix = 'data:';
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.storageUnavailable.isUnavailable()) {
      return;
    }
    this.initPromise ??= this.encryptedCache.ensureReady();
    await this.initPromise;
  }

  async saveEvents(accountId: string, events: CalendarEvent[]): Promise<void> {
    await this.init();
    const existing = await this.getEvents(accountId);
    const byId = new Map(existing.map((event) => [event.id, event]));
    events.forEach((event) => byId.set(event.id, event));
    await this.storage.set(
      `db:events:${accountId}`,
      this.serializeEvents(Array.from(byId.values()))
    );
  }

  async getEvents(
    accountId: string,
    calendarId?: string
  ): Promise<CalendarEvent[]> {
    await this.init();
    const stored = (await this.storage.get(`db:events:${accountId}`)) as
      | StoredCalendarEvent[]
      | null;
    const events = stored ? this.deserializeEvents(stored) : [];
    if (!calendarId) {
      return events;
    }
    return events.filter((event) => event.calendarId === calendarId);
  }

  async getEventsForRange(
    accountIds: string[],
    start: Date,
    end: Date
  ): Promise<CalendarEvent[]> {
    const allEvents: CalendarEvent[] = [];
    for (const accountId of accountIds) {
      const events = await this.getEvents(accountId);
      allEvents.push(
        ...events.filter((event) => this.eventOverlapsRange(event, start, end))
      );
    }
    return allEvents;
  }

  async deleteEvent(accountId: string, uid: string): Promise<void> {
    await this.init();
    const events = await this.getEvents(accountId);
    const filtered = events.filter((event) => event.uid !== uid);
    await this.storage.set(
      `db:events:${accountId}`,
      this.serializeEvents(filtered)
    );
  }

  async clearAccountData(accountId: string): Promise<void> {
    await this.init();
    await Promise.all([
      this.storage.remove(`db:events:${accountId}`),
      this.storage.remove(`db:tasks:${accountId}`),
      this.storage.remove(`db:calendars:${accountId}`),
      this.storage.remove(`db:contacts:${accountId}`),
      this.storage.remove(`db:addressbooks:${accountId}`),
      this.storage.remove(`db:sync:${accountId}`),
      this.storage.remove(`db:talk:conversations:${accountId}`),
      this.storage.remove(`db:talk:sync:${accountId}`),
    ]);

    const messageKeyPrefix = `db:talk:messages:${accountId}:`;
    const storageKeysForTalk = await this.storage.keys();
    await Promise.all(
      storageKeysForTalk
        .filter((key) => key.startsWith(messageKeyPrefix))
        .map((key) => this.storage.remove(key)),
    );

    // File listings are keyed per directory, so sweep every matching key.
    const fileKeyPrefix = `db:files:${accountId}:`;
    const storageKeys = await this.storage.keys();
    await Promise.all(
      storageKeys
        .filter((key) => key.startsWith(fileKeyPrefix))
        .map((key) => this.storage.remove(key)),
    );

    const prefix = `${this.dataKeyPrefix}${accountId}:`;
    const { keys } = await Preferences.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(prefix))
        .map((key) => Preferences.remove({ key }))
    );
  }

  async saveCalendars(
    accountId: string,
    calendars: AccountCalendar[]
  ): Promise<void> {
    await this.init();
    await this.storage.set(`db:calendars:${accountId}`, calendars);
  }

  async getCalendars(accountId: string): Promise<AccountCalendar[]> {
    await this.init();
    return (
      ((await this.storage.get(`db:calendars:${accountId}`)) as
        | AccountCalendar[]
        | null) ?? []
    );
  }

  async getAllCalendars(): Promise<AccountCalendar[]> {
    await this.init();
    const keys = await this.storage.keys();
    const calendarKeys = keys.filter((key) => key.startsWith('db:calendars:'));
    const results = await Promise.all(
      calendarKeys.map(
        (key) => this.storage.get(key) as Promise<AccountCalendar[] | null>
      )
    );
    return results.reduce<AccountCalendar[]>(
      (all, calendars) => all.concat(calendars ?? []),
      []
    );
  }

  async getEvent(id: string): Promise<CalendarEvent | null> {
    await this.init();
    const all = await this.getAllEvents();
    return all.find((event) => event.id === id) ?? null;
  }

  async getAllEvents(): Promise<CalendarEvent[]> {
    await this.init();
    const keys = await this.storage.keys();
    const eventKeys = keys.filter((key) => key.startsWith('db:events:'));
    const results = await Promise.all(
      eventKeys.map(
        (key) => this.storage.get(key) as Promise<StoredCalendarEvent[] | null>
      )
    );
    return results.reduce<CalendarEvent[]>(
      (all, events) => all.concat(events ? this.deserializeEvents(events) : []),
      []
    );
  }

  async saveLastSync(accountId: string, date: Date): Promise<void> {
    await this.init();
    await this.storage.set(`db:sync:${accountId}`, date.toISOString());
  }

  async getLastSync(accountId: string): Promise<Date | null> {
    await this.init();
    return this.parseSyncDate(
      await this.storage.get(`db:sync:${accountId}`)
    );
  }

  async saveCalendarSync(accountId: string, date: Date): Promise<void> {
    await this.init();
    await this.storage.set(
      `db:sync:calendar:${accountId}`,
      date.toISOString()
    );
  }

  async getCalendarSync(accountId: string): Promise<Date | null> {
    await this.init();
    return this.parseSyncDate(
      await this.storage.get(`db:sync:calendar:${accountId}`)
    );
  }

  async saveContactsSync(accountId: string, date: Date): Promise<void> {
    await this.init();
    await this.storage.set(
      `db:sync:contacts:${accountId}`,
      date.toISOString()
    );
  }

  async getContactsSync(accountId: string): Promise<Date | null> {
    await this.init();
    return this.parseSyncDate(
      await this.storage.get(`db:sync:contacts:${accountId}`)
    );
  }

  async saveTasksSync(accountId: string, date: Date): Promise<void> {
    await this.init();
    await this.storage.set(`db:sync:tasks:${accountId}`, date.toISOString());
  }

  async getTasksSync(accountId: string): Promise<Date | null> {
    await this.init();
    return this.parseSyncDate(
      await this.storage.get(`db:sync:tasks:${accountId}`),
    );
  }

  // --- Tasks ---------------------------------------------------------------

  async saveTasks(accountId: string, tasks: Task[]): Promise<void> {
    await this.init();
    const existing = await this.getTasks(accountId);
    const byId = new Map(existing.map((task) => [task.id, task]));
    tasks.forEach((task) => byId.set(task.id, task));
    await this.storage.set(
      `db:tasks:${accountId}`,
      this.serializeTasks(Array.from(byId.values())),
    );
  }

  async replaceTasksForAccount(accountId: string, tasks: Task[]): Promise<void> {
    await this.init();
    await this.storage.set(`db:tasks:${accountId}`, this.serializeTasks(tasks));
  }

  async getTasks(accountId: string, listId?: string): Promise<Task[]> {
    await this.init();
    const stored = (await this.storage.get(`db:tasks:${accountId}`)) as
      | StoredTask[]
      | null;
    const tasks = stored ? this.deserializeTasks(stored) : [];
    if (!listId) {
      return tasks;
    }
    return tasks.filter((task) => task.listId === listId);
  }

  async getTasksForAccounts(accountIds: string[]): Promise<Task[]> {
    const all: Task[] = [];
    for (const accountId of accountIds) {
      all.push(...(await this.getTasks(accountId)));
    }
    return all;
  }

  async getAllTasks(): Promise<Task[]> {
    await this.init();
    const keys = await this.storage.keys();
    const taskKeys = keys.filter((key) => key.startsWith('db:tasks:'));
    const results = await Promise.all(
      taskKeys.map(
        (key) => this.storage.get(key) as Promise<StoredTask[] | null>,
      ),
    );
    return results.reduce<Task[]>(
      (all, tasks) => all.concat(tasks ? this.deserializeTasks(tasks) : []),
      [],
    );
  }

  async getTask(id: string): Promise<Task | null> {
    await this.init();
    const all = await this.getAllTasks();
    return all.find((task) => task.id === id) ?? null;
  }

  async deleteTask(accountId: string, uid: string): Promise<void> {
    await this.init();
    const tasks = await this.getTasks(accountId);
    const filtered = tasks.filter((task) => task.uid !== uid);
    await this.storage.set(
      `db:tasks:${accountId}`,
      this.serializeTasks(filtered),
    );
  }

  private serializeTasks(tasks: Task[]): StoredTask[] {
    return tasks.map((task) => ({
      ...task,
      due: task.due?.toISOString(),
      completedAt: task.completedAt?.toISOString(),
      lastModified: task.lastModified?.toISOString(),
    }));
  }

  private deserializeTasks(tasks: StoredTask[]): Task[] {
    return tasks.map((task) => ({
      ...task,
      due: task.due ? new Date(task.due) : undefined,
      completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
      lastModified: task.lastModified ? new Date(task.lastModified) : undefined,
    }));
  }

  private parseSyncDate(value: unknown): Date | null {
    if (typeof value !== 'string') {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // --- Contacts -------------------------------------------------------------

  /** Upserts the given contacts, keeping any others already cached. */
  async saveContacts(accountId: string, contacts: Contact[]): Promise<void> {
    await this.init();
    const existing = await this.getContacts(accountId);
    const byId = new Map(existing.map((contact) => [contact.id, contact]));
    contacts.forEach((contact) => byId.set(contact.id, contact));
    await this.storage.set(
      `db:contacts:${accountId}`,
      this.serializeContacts(Array.from(byId.values()))
    );
  }

  /**
   * Replaces the whole account cache with the given set, so contacts deleted
   * on the server disappear locally. Used after a full account fetch.
   */
  async replaceContactsForAccount(
    accountId: string,
    contacts: Contact[]
  ): Promise<void> {
    await this.init();
    await this.storage.set(
      `db:contacts:${accountId}`,
      this.serializeContacts(contacts)
    );
  }

  async getContacts(
    accountId: string,
    addressBookId?: string
  ): Promise<Contact[]> {
    await this.init();
    const stored = (await this.storage.get(`db:contacts:${accountId}`)) as
      | StoredContact[]
      | null;
    const contacts = stored ? this.deserializeContacts(stored) : [];
    if (!addressBookId) {
      return contacts;
    }
    return contacts.filter((contact) => contact.addressBookId === addressBookId);
  }

  async getAllContacts(): Promise<Contact[]> {
    await this.init();
    const keys = await this.storage.keys();
    const contactKeys = keys.filter((key) => key.startsWith('db:contacts:'));
    const results = await Promise.all(
      contactKeys.map(
        (key) => this.storage.get(key) as Promise<StoredContact[] | null>
      )
    );
    return results.reduce<Contact[]>(
      (all, contacts) =>
        all.concat(contacts ? this.deserializeContacts(contacts) : []),
      []
    );
  }

  async deleteContact(accountId: string, id: string): Promise<void> {
    await this.init();
    const contacts = await this.getContacts(accountId);
    const filtered = contacts.filter((contact) => contact.id !== id);
    await this.storage.set(
      `db:contacts:${accountId}`,
      this.serializeContacts(filtered)
    );
  }

  // --- Address books --------------------------------------------------------

  async saveAddressBooks(
    accountId: string,
    books: AddressBook[]
  ): Promise<void> {
    await this.init();
    await this.storage.set(`db:addressbooks:${accountId}`, books);
  }

  async getAddressBooks(accountId: string): Promise<AddressBook[]> {
    await this.init();
    return (
      ((await this.storage.get(`db:addressbooks:${accountId}`)) as
        | AddressBook[]
        | null) ?? []
    );
  }

  async getAllAddressBooks(): Promise<AddressBook[]> {
    await this.init();
    const keys = await this.storage.keys();
    const bookKeys = keys.filter((key) => key.startsWith('db:addressbooks:'));
    const results = await Promise.all(
      bookKeys.map(
        (key) => this.storage.get(key) as Promise<AddressBook[] | null>
      )
    );
    return results.reduce<AddressBook[]>(
      (all, books) => all.concat(books ?? []),
      []
    );
  }

  // --- Files ----------------------------------------------------------------

  /** Caches the listing of a single directory (replacing any prior listing). */
  async saveFiles(
    accountId: string,
    path: string,
    items: FileItem[],
  ): Promise<void> {
    await this.init();
    await this.storage.set(
      `db:files:${accountId}:${path}`,
      this.serializeFiles(items),
    );
  }

  /** Returns the cached listing of a directory, or [] if none is cached. */
  async getFiles(accountId: string, path: string): Promise<FileItem[]> {
    await this.init();
    const stored = (await this.storage.get(`db:files:${accountId}:${path}`)) as
      | StoredFileItem[]
      | null;
    return stored ? this.deserializeFiles(stored) : [];
  }

  async saveFilesListingSync(
    accountId: string,
    path: string,
    syncedAt: Date,
  ): Promise<void> {
    await this.init();
    await this.storage.set(
      `db:files-sync:${accountId}:${path}`,
      syncedAt.toISOString(),
    );
  }

  async getFilesListingSync(
    accountId: string,
    path: string,
  ): Promise<Date | null> {
    await this.init();
    const stored = (await this.storage.get(
      `db:files-sync:${accountId}:${path}`,
    )) as string | null;
    return stored ? new Date(stored) : null;
  }

  private serializeFiles(items: FileItem[]): StoredFileItem[] {
    return items.map((item) => ({
      ...item,
      lastModified: item.lastModified?.toISOString(),
    }));
  }

  private deserializeFiles(items: StoredFileItem[]): FileItem[] {
    return items.map((item) => ({
      ...item,
      lastModified: item.lastModified ? new Date(item.lastModified) : undefined,
    }));
  }

  private serializeContacts(contacts: Contact[]): StoredContact[] {
    return contacts.map(({ rawVCard: _raw, photoUrl: _photo, birthday, ...contact }) => ({
      ...contact,
      birthday: birthday?.toISOString(),
    }));
  }

  private deserializeContacts(contacts: StoredContact[]): Contact[] {
    return contacts.map((contact) => ({
      ...contact,
      birthday: contact.birthday ? new Date(contact.birthday) : undefined,
    }));
  }

  private serializeEvents(events: CalendarEvent[]): StoredCalendarEvent[] {
    return events.map((event) => ({
      ...event,
      start: event.start.toISOString(),
      end: event.end.toISOString(),
      lastModified: event.lastModified?.toISOString(),
    }));
  }

  private deserializeEvents(events: StoredCalendarEvent[]): CalendarEvent[] {
    return events.map((event) => ({
      ...event,
      start: new Date(event.start),
      end: new Date(event.end),
      lastModified: event.lastModified
        ? new Date(event.lastModified)
        : undefined,
    }));
  }

  private eventOverlapsRange(
    event: CalendarEvent,
    start: Date,
    end: Date
  ): boolean {
    return event.start < end && event.end > start;
  }

  // --- Talk -----------------------------------------------------------------

  async saveConversations(
    accountId: string,
    conversations: TalkConversation[],
  ): Promise<void> {
    await this.init();
    await this.storage.set(
      `db:talk:conversations:${accountId}`,
      this.serializeTalkConversations(conversations),
    );
  }

  async getConversations(accountId: string): Promise<TalkConversation[]> {
    await this.init();
    const stored = (await this.storage.get(
      `db:talk:conversations:${accountId}`,
    )) as StoredTalkConversation[] | null;
    return stored ? this.deserializeTalkConversations(stored) : [];
  }

  async getAllConversations(): Promise<TalkConversation[]> {
    await this.init();
    const keys = await this.storage.keys();
    const convKeys = keys.filter((key) =>
      key.startsWith('db:talk:conversations:'),
    );
    const results = await Promise.all(
      convKeys.map(
        (key) =>
          this.storage.get(key) as Promise<StoredTalkConversation[] | null>,
      ),
    );
    return results.reduce<TalkConversation[]>(
      (all, convs) =>
        all.concat(convs ? this.deserializeTalkConversations(convs) : []),
      [],
    );
  }

  async saveTalkSync(accountId: string, date: Date): Promise<void> {
    await this.init();
    await this.storage.set(
      `db:talk:sync:${accountId}`,
      date.toISOString(),
    );
  }

  async getTalkSync(accountId: string): Promise<Date | null> {
    await this.init();
    return this.parseSyncDate(
      await this.storage.get(`db:talk:sync:${accountId}`),
    );
  }

  async saveMessages(
    accountId: string,
    token: string,
    messages: TalkMessage[],
  ): Promise<void> {
    await this.init();
    await this.storage.set(
      `db:talk:messages:${accountId}:${token}`,
      this.serializeTalkMessages(messages),
    );
  }

  async getMessages(accountId: string, token: string): Promise<TalkMessage[]> {
    await this.init();
    const stored = (await this.storage.get(
      `db:talk:messages:${accountId}:${token}`,
    )) as StoredTalkMessage[] | null;
    return stored ? this.deserializeTalkMessages(stored) : [];
  }

  private serializeTalkConversations(
    conversations: TalkConversation[],
  ): StoredTalkConversation[] {
    return conversations.map((conv) => ({
      ...conv,
      lastActivity: conv.lastActivity.toISOString(),
      lastMessage: conv.lastMessage
        ? {
            ...conv.lastMessage,
            timestamp: conv.lastMessage.timestamp.toISOString(),
          }
        : undefined,
    }));
  }

  private deserializeTalkConversations(
    conversations: StoredTalkConversation[],
  ): TalkConversation[] {
    return conversations.map((conv) => ({
      ...conv,
      lastActivity: new Date(conv.lastActivity),
      lastMessage: conv.lastMessage
        ? {
            ...conv.lastMessage,
            timestamp: new Date(conv.lastMessage.timestamp),
          }
        : undefined,
    }));
  }

  private serializeTalkMessages(messages: TalkMessage[]): StoredTalkMessage[] {
    return messages.map((message) => ({
      ...message,
      timestamp: message.timestamp.toISOString(),
    }));
  }

  private deserializeTalkMessages(
    messages: StoredTalkMessage[],
  ): TalkMessage[] {
    return messages.map((message) => ({
      ...message,
      timestamp: new Date(message.timestamp),
    }));
  }

  // --- Notes ---------------------------------------------------------------

  async saveNotes(accountId: string, notes: Note[]): Promise<void> {
    await this.init();
    const existing = await this.getNotes(accountId);
    const byId = new Map(existing.map((note) => [note.noteId, note]));
    notes.forEach((note) => byId.set(note.noteId, note));
    await this.storage.set(
      `db:notes:${accountId}`,
      this.serializeNotes(Array.from(byId.values())),
    );
  }

  async replaceNotesForAccount(accountId: string, notes: Note[]): Promise<void> {
    await this.init();
    await this.storage.set(`db:notes:${accountId}`, this.serializeNotes(notes));
  }

  async getNotes(accountId: string): Promise<Note[]> {
    await this.init();
    const stored = (await this.storage.get(`db:notes:${accountId}`)) as
      | StoredNote[]
      | null;
    return stored ? this.deserializeNotes(stored) : [];
  }

  async getAllNotes(): Promise<Note[]> {
    await this.init();
    const keys = await this.storage.keys();
    const noteKeys = keys.filter((key) => key.startsWith('db:notes:'));
    const results = await Promise.all(
      noteKeys.map(
        (key) => this.storage.get(key) as Promise<StoredNote[] | null>,
      ),
    );
    return results.reduce<Note[]>(
      (all, notes) => all.concat(notes ? this.deserializeNotes(notes) : []),
      [],
    );
  }

  async getNote(id: string): Promise<Note | null> {
    await this.init();
    const all = await this.getAllNotes();
    return all.find((note) => note.id === id) ?? null;
  }

  async deleteNote(accountId: string, noteId: number): Promise<void> {
    await this.init();
    const notes = await this.getNotes(accountId);
    const filtered = notes.filter((note) => note.noteId !== noteId);
    await this.storage.set(
      `db:notes:${accountId}`,
      this.serializeNotes(filtered),
    );
  }

  async saveNotesSync(accountId: string, date: Date): Promise<void> {
    await this.init();
    await this.storage.set(`db:sync:notes:${accountId}`, date.toISOString());
  }

  async getNotesSync(accountId: string): Promise<Date | null> {
    await this.init();
    return this.parseSyncDate(
      await this.storage.get(`db:sync:notes:${accountId}`),
    );
  }

  private serializeNotes(notes: Note[]): StoredNote[] {
    return notes.map((note) => ({
      ...note,
      modified: note.modified.toISOString(),
    }));
  }

  private deserializeNotes(notes: StoredNote[]): Note[] {
    return notes.map((note) => ({
      ...note,
      modified: new Date(note.modified),
    }));
  }
}
