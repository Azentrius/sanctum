// SPDX-License-Identifier: GPL-3.0-or-later
const prefKeys = vi.hoisted(() => vi.fn());
const prefRemove = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    keys: prefKeys,
    remove: prefRemove,
    get: vi.fn(),
    set: vi.fn(),
  },
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Storage } from '@ionic/storage-angular';

import type { AccountCalendar, CalendarEvent, Task } from '../accounts/account.model';
import type { AddressBook, Contact } from '../carddav/contact.model';
import type { TalkConversation, TalkMessage } from '../talk/talk.model';
import { LocalDbService } from './local-db.service';
import { EncryptedCacheStorageService } from './encrypted-cache-storage.service';

const createStorageMock = () => {
  const store = new Map<string, unknown>();
  return {
    store,
    create: vi.fn(async () => undefined),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    get: vi.fn(async (key: string) => store.get(key)),
    remove: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    keys: vi.fn(async () => Array.from(store.keys())),
  };
};

const baseEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'occ-1',
  uid: 'evt-1',
  accountId: 'acc-1',
  calendarId: 'cal-1',
  url: 'https://cloud.example.com/evt.ics',
  title: 'Standup',
  start: new Date('2024-01-15T09:00:00Z'),
  end: new Date('2024-01-15T10:00:00Z'),
  allDay: false,
  ...overrides,
});

const baseContact = (overrides: Partial<Contact> = {}): Contact => ({
  id: 'contact-1',
  accountId: 'acc-1',
  addressBookId: 'book-1',
  url: 'https://cloud.example.com/c.vcf',
  displayName: 'Alice',
  phones: [],
  emails: [],
  addresses: [],
  ...overrides,
});

let service: LocalDbService;
let storage: ReturnType<typeof createStorageMock>;

beforeEach(() => {
  storage = createStorageMock();
  prefKeys.mockReset();
  prefRemove.mockClear();
  prefKeys.mockResolvedValue({ keys: [] });

  TestBed.configureTestingModule({
    providers: [
      LocalDbService,
      { provide: Storage, useValue: storage },
      {
        provide: EncryptedCacheStorageService,
        useValue: { ensureReady: vi.fn(async () => undefined) },
      },
    ],
  });
  service = TestBed.inject(LocalDbService);
});

describe('LocalDbService events', () => {
  it('upserts events by id when saving', async () => {
    await service.saveEvents('acc-1', [baseEvent({ id: 'occ-1', title: 'A' })]);
    await service.saveEvents('acc-1', [baseEvent({ id: 'occ-1', title: 'B' })]);

    const events = await service.getEvents('acc-1');
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('B');
  });

  it('filters events by calendar id', async () => {
    await service.saveEvents('acc-1', [
      baseEvent({ id: '1', calendarId: 'cal-a' }),
      baseEvent({ id: '2', calendarId: 'cal-b' }),
    ]);

    const filtered = await service.getEvents('acc-1', 'cal-a');
    expect(filtered.map((event) => event.id)).toEqual(['1']);
  });

  it('returns events overlapping a range across accounts', async () => {
    await service.saveEvents('acc-1', [
      baseEvent({
        id: 'in-range',
        start: new Date('2024-06-12T00:00:00Z'),
        end: new Date('2024-06-13T00:00:00Z'),
      }),
    ]);
    await service.saveEvents('acc-2', [
      baseEvent({
        id: 'out-range',
        accountId: 'acc-2',
        start: new Date('2024-07-01T00:00:00Z'),
        end: new Date('2024-07-02T00:00:00Z'),
      }),
    ]);

    const events = await service.getEventsForRange(
      ['acc-1', 'acc-2'],
      new Date('2024-06-10T00:00:00Z'),
      new Date('2024-06-20T00:00:00Z'),
    );

    expect(events.map((event) => event.id)).toEqual(['in-range']);
  });

  it('deletes an event by uid', async () => {
    await service.saveEvents('acc-1', [
      baseEvent({ id: 'keep', uid: 'keep' }),
      baseEvent({ id: 'drop', uid: 'drop' }),
    ]);

    await service.deleteEvent('acc-1', 'drop');

    const events = await service.getEvents('acc-1');
    expect(events.map((event) => event.uid)).toEqual(['keep']);
  });

  it('aggregates all stored events and finds one by id', async () => {
    await service.saveEvents('acc-1', [baseEvent({ id: 'global-1' })]);
    await service.saveEvents('acc-2', [baseEvent({ id: 'global-2', accountId: 'acc-2' })]);

    const all = await service.getAllEvents();
    expect(all).toHaveLength(2);
    expect(await service.getEvent('global-2')).toMatchObject({ accountId: 'acc-2' });
    expect(await service.getEvent('missing')).toBeNull();
  });
});

describe('LocalDbService calendars and sync metadata', () => {
  const calendar = (): AccountCalendar => ({
    id: 'cal-1',
    accountId: 'acc-1',
    url: 'https://cloud.example.com/cal',
    displayName: 'Personal',
    color: '#0082c9',
    enabled: true,
    supportedComponents: ['VEVENT'],
    readOnly: false,
  });

  it('stores and retrieves calendars per account', async () => {
    await service.saveCalendars('acc-1', [calendar()]);
    expect(await service.getCalendars('acc-1')).toHaveLength(1);
    expect(await service.getCalendars('missing')).toEqual([]);
  });

  it('aggregates calendars across accounts', async () => {
    await service.saveCalendars('acc-1', [calendar()]);
    await service.saveCalendars('acc-2', [{ ...calendar(), id: 'cal-2', accountId: 'acc-2' }]);

    expect(await service.getAllCalendars()).toHaveLength(2);
  });

  it('round-trips last-sync timestamps', async () => {
    const when = new Date('2024-06-01T12:00:00Z');
    await service.saveLastSync('acc-1', when);
    expect((await service.getLastSync('acc-1'))?.toISOString()).toBe(when.toISOString());
    expect(await service.getLastSync('acc-1-missing')).toBeNull();
  });

  it('returns null for invalid sync timestamps', async () => {
    storage.store.set('db:sync:acc-1', 'not-a-date');
    expect(await service.getLastSync('acc-1')).toBeNull();
  });
});

describe('LocalDbService contacts and address books', () => {
  const book = (): AddressBook => ({
    id: 'book-1',
    accountId: 'acc-1',
    url: 'https://cloud.example.com/book',
    displayName: 'Contacts',
    enabled: true,
    readOnly: false,
  });

  it('strips bulky vCard blobs from persisted contacts', async () => {
    await service.saveContacts('acc-1', [
      baseContact({
        rawVCard: 'BEGIN:VCARD\nEND:VCARD',
        photoUrl: 'data:image/png;base64,AAAA',
      }),
    ]);

    const stored = storage.store.get('db:contacts:acc-1') as Record<string, unknown>[];
    expect(stored[0]).not.toHaveProperty('rawVCard');
    expect(stored[0]).not.toHaveProperty('photoUrl');
    expect(await service.getContacts('acc-1')).toMatchObject([{ displayName: 'Alice' }]);
  });

  it('upserts contacts by id when saving', async () => {
    await service.saveContacts('acc-1', [baseContact({ id: 'c-1', displayName: 'A' })]);
    await service.saveContacts('acc-1', [baseContact({ id: 'c-1', displayName: 'B' })]);

    const contacts = await service.getContacts('acc-1');
    expect(contacts).toHaveLength(1);
    expect(contacts[0].displayName).toBe('B');
  });

  it('replaces the full contact cache for an account', async () => {
    await service.saveContacts('acc-1', [baseContact({ id: 'old' })]);
    await service.replaceContactsForAccount('acc-1', [baseContact({ id: 'new' })]);

    const contacts = await service.getContacts('acc-1');
    expect(contacts.map((contact) => contact.id)).toEqual(['new']);
  });

  it('filters contacts by address book and aggregates across accounts', async () => {
    await service.saveContacts('acc-1', [
      baseContact({ id: '1', addressBookId: 'book-a' }),
      baseContact({ id: '2', addressBookId: 'book-b' }),
    ]);
    await service.saveContacts('acc-2', [baseContact({ id: '3', accountId: 'acc-2' })]);

    expect((await service.getContacts('acc-1', 'book-a')).map((c) => c.id)).toEqual(['1']);
    expect(await service.getAllContacts()).toHaveLength(3);
  });

  it('deletes a contact by id', async () => {
    await service.saveContacts('acc-1', [
      baseContact({ id: 'keep' }),
      baseContact({ id: 'drop' }),
    ]);

    await service.deleteContact('acc-1', 'drop');

    expect((await service.getContacts('acc-1')).map((contact) => contact.id)).toEqual(['keep']);
  });

  it('serializes birthdays when persisting contacts', async () => {
    const birthday = new Date('1990-05-17T00:00:00Z');
    await service.saveContacts('acc-1', [baseContact({ birthday })]);

    const [stored] = await service.getContacts('acc-1');
    expect(stored.birthday?.toISOString()).toBe(birthday.toISOString());
  });

  it('stores and aggregates address books', async () => {
    await service.saveAddressBooks('acc-1', [book()]);
    await service.saveAddressBooks('acc-2', [{ ...book(), id: 'book-2', accountId: 'acc-2' }]);

    expect(await service.getAddressBooks('acc-1')).toHaveLength(1);
    expect(await service.getAllAddressBooks()).toHaveLength(2);
  });
});

describe('LocalDbService tasks and task sync', () => {
  const baseTask = (overrides: Partial<Task> = {}): Task => ({
    id: 'task-1',
    uid: 'uid-1',
    accountId: 'acc-1',
    listId: 'list-1',
    url: 'https://cloud.example.com/t.ics',
    title: 'Buy milk',
    completed: false,
    due: new Date('2024-08-01T09:00:00Z'),
    ...overrides,
  });

  it('upserts tasks by id and round-trips date fields', async () => {
    await service.saveTasks('acc-1', [baseTask({ id: 't-1', title: 'A' })]);
    await service.saveTasks('acc-1', [baseTask({ id: 't-1', title: 'B' })]);

    const tasks = await service.getTasks('acc-1');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('B');
    expect(tasks[0].due?.toISOString()).toBe('2024-08-01T09:00:00.000Z');
  });

  it('replaces the full task cache for an account', async () => {
    await service.saveTasks('acc-1', [baseTask({ id: 'old' })]);
    await service.replaceTasksForAccount('acc-1', [baseTask({ id: 'new' })]);

    expect((await service.getTasks('acc-1')).map((t) => t.id)).toEqual(['new']);
  });

  it('filters tasks by list id', async () => {
    await service.saveTasks('acc-1', [
      baseTask({ id: '1', listId: 'list-a' }),
      baseTask({ id: '2', listId: 'list-b' }),
    ]);

    expect((await service.getTasks('acc-1', 'list-a')).map((t) => t.id)).toEqual(['1']);
  });

  it('aggregates tasks across accounts and finds/deletes by id/uid', async () => {
    await service.saveTasks('acc-1', [baseTask({ id: 'g-1', uid: 'u-1' })]);
    await service.saveTasks('acc-2', [baseTask({ id: 'g-2', uid: 'u-2', accountId: 'acc-2' })]);

    expect(await service.getTasksForAccounts(['acc-1', 'acc-2'])).toHaveLength(2);
    expect(await service.getAllTasks()).toHaveLength(2);
    expect(await service.getTask('g-2')).toMatchObject({ accountId: 'acc-2' });
    expect(await service.getTask('missing')).toBeNull();

    await service.deleteTask('acc-1', 'u-1');
    expect(await service.getTasks('acc-1')).toEqual([]);
  });

  it('round-trips the tasks-sync timestamp', async () => {
    const when = new Date('2024-09-09T08:00:00Z');
    await service.saveTasksSync('acc-1', when);
    expect((await service.getTasksSync('acc-1'))?.toISOString()).toBe(when.toISOString());
    expect(await service.getTasksSync('acc-missing')).toBeNull();
  });
});

describe('LocalDbService talk storage', () => {
  const conversation = (overrides: Partial<TalkConversation> = {}): TalkConversation => ({
    id: 'acc-1:room-1',
    accountId: 'acc-1',
    token: 'room-1',
    displayName: 'General',
    type: 'group',
    unreadCount: 2,
    readOnly: false,
    lastActivity: new Date('2024-05-01T10:00:00Z'),
    lastMessage: {
      id: 9,
      actorDisplayName: 'Alice',
      message: 'Hi',
      timestamp: new Date('2024-05-01T09:59:00Z'),
    },
    ...overrides,
  });

  const message = (overrides: Partial<TalkMessage> = {}): TalkMessage => ({
    id: 1,
    accountId: 'acc-1',
    token: 'room-1',
    actorId: 'alice',
    actorDisplayName: 'Alice',
    message: 'Hello',
    timestamp: new Date('2024-05-01T09:00:00Z'),
    messageType: 'comment',
    ...overrides,
  });

  it('round-trips conversations with date fields and aggregates across accounts', async () => {
    await service.saveConversations('acc-1', [conversation()]);
    await service.saveConversations('acc-2', [
      conversation({ id: 'acc-2:r', accountId: 'acc-2', token: 'r' }),
    ]);

    const [conv] = await service.getConversations('acc-1');
    expect(conv.lastActivity).toBeInstanceOf(Date);
    expect(conv.lastActivity.toISOString()).toBe('2024-05-01T10:00:00.000Z');
    expect(conv.lastMessage?.timestamp).toBeInstanceOf(Date);
    expect(await service.getConversations('missing')).toEqual([]);
    expect(await service.getAllConversations()).toHaveLength(2);
  });

  it('round-trips messages per room and the talk-sync timestamp', async () => {
    await service.saveMessages('acc-1', 'room-1', [message(), message({ id: 2 })]);

    const stored = await service.getMessages('acc-1', 'room-1');
    expect(stored.map((m) => m.id)).toEqual([1, 2]);
    expect(stored[0].timestamp).toBeInstanceOf(Date);
    expect(await service.getMessages('acc-1', 'empty')).toEqual([]);

    const when = new Date('2024-05-02T00:00:00Z');
    await service.saveTalkSync('acc-1', when);
    expect((await service.getTalkSync('acc-1'))?.toISOString()).toBe(when.toISOString());
    expect(await service.getTalkSync('missing')).toBeNull();
  });
});

describe('LocalDbService.clearAccountData', () => {
  it('removes all account-scoped storage keys and preference entries', async () => {
    await service.saveEvents('acc-1', [baseEvent()]);
    await service.saveCalendars('acc-1', []);
    await service.saveContacts('acc-1', [baseContact()]);
    await service.saveAddressBooks('acc-1', []);
    await service.saveLastSync('acc-1', new Date());
    prefKeys.mockResolvedValue({
      keys: ['data:acc-1:foo', 'data:acc-2:bar', 'other'],
    });

    await service.clearAccountData('acc-1');

    expect(await service.getEvents('acc-1')).toEqual([]);
    expect(await service.getCalendars('acc-1')).toEqual([]);
    expect(await service.getContacts('acc-1')).toEqual([]);
    expect(await service.getAddressBooks('acc-1')).toEqual([]);
    expect(await service.getLastSync('acc-1')).toBeNull();
    expect(prefRemove).toHaveBeenCalledWith({ key: 'data:acc-1:foo' });
    expect(prefRemove).not.toHaveBeenCalledWith({ key: 'data:acc-2:bar' });
  });

  it('sweeps per-room talk message keys and per-directory file keys', async () => {
    storage.store.set('db:talk:messages:acc-1:room-a', [{ id: 1 }]);
    storage.store.set('db:talk:messages:acc-1:room-b', [{ id: 2 }]);
    storage.store.set('db:talk:messages:acc-2:room-c', [{ id: 3 }]);
    storage.store.set('db:files:acc-1:/Documents', [{ name: 'a' }]);
    storage.store.set('db:files:acc-2:/Photos', [{ name: 'b' }]);
    prefKeys.mockResolvedValue({ keys: [] });

    await service.clearAccountData('acc-1');

    expect(storage.store.has('db:talk:messages:acc-1:room-a')).toBe(false);
    expect(storage.store.has('db:talk:messages:acc-1:room-b')).toBe(false);
    expect(storage.store.has('db:talk:messages:acc-2:room-c')).toBe(true);
    expect(storage.store.has('db:files:acc-1:/Documents')).toBe(false);
    expect(storage.store.has('db:files:acc-2:/Photos')).toBe(true);
  });
});
