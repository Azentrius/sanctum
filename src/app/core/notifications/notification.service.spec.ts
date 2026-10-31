// SPDX-License-Identifier: GPL-3.0-or-later
const checkPermissions = vi.hoisted(() => vi.fn());
const requestPermissions = vi.hoisted(() => vi.fn());
const getPending = vi.hoisted(() => vi.fn());
const cancel = vi.hoisted(() => vi.fn());
const schedule = vi.hoisted(() => vi.fn());

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { checkPermissions, requestPermissions, getPending, cancel, schedule },
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';

import type { CalendarEvent } from '../accounts/account.model';
import { NotificationService } from './notification.service';

let service: NotificationService;

function event(reminders: number[]): CalendarEvent {
  return {
    id: 'evt-1',
    uid: 'evt-1',
    accountId: 'acc-1',
    calendarId: 'cal-1',
    url: '',
    title: 'Zahnarzt',
    // Far enough in the future to stay inside the window relative to "now".
    start: new Date(Date.now() + 2 * 86_400_000),
    end: new Date(Date.now() + 2 * 86_400_000 + 3_600_000),
    allDay: false,
    reminders,
  };
}

beforeEach(() => {
  [checkPermissions, requestPermissions, getPending, cancel, schedule].forEach((fn) =>
    fn.mockReset(),
  );
  getPending.mockResolvedValue({ notifications: [] });
  cancel.mockResolvedValue(undefined);
  schedule.mockResolvedValue(undefined);

  TestBed.configureTestingModule({ providers: [NotificationService] });
  service = TestBed.inject(NotificationService);
});

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('NotificationService on the web', () => {
  beforeEach(() => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
  });

  it('does not request permission or schedule anything', async () => {
    await service.reschedule([event([-3600])], []);

    expect(await service.ensurePermission()).toBe(false);
    expect(checkPermissions).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe('NotificationService on a native platform', () => {
  beforeEach(() => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
  });

  it('returns true without prompting when permission is already granted', async () => {
    checkPermissions.mockResolvedValue({ display: 'granted' });

    expect(await service.ensurePermission()).toBe(true);
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('prompts when permission is undetermined and honours the answer', async () => {
    checkPermissions.mockResolvedValue({ display: 'prompt' });
    requestPermissions.mockResolvedValue({ display: 'granted' });

    expect(await service.ensurePermission()).toBe(true);
    expect(requestPermissions).toHaveBeenCalled();
  });

  it('does not schedule when permission is denied', async () => {
    checkPermissions.mockResolvedValue({ display: 'denied' });

    await service.reschedule([event([-3600])], []);

    expect(schedule).not.toHaveBeenCalled();
  });

  it('cancels pending notifications and schedules the new set', async () => {
    checkPermissions.mockResolvedValue({ display: 'granted' });
    getPending.mockResolvedValue({ notifications: [{ id: 42 }] });

    await service.reschedule([event([-3600])], []);

    expect(cancel).toHaveBeenCalledWith({ notifications: [{ id: 42 }] });
    expect(schedule).toHaveBeenCalledTimes(1);
    const arg = schedule.mock.calls[0][0];
    expect(arg.notifications).toHaveLength(1);
    expect(arg.notifications[0]).toMatchObject({ title: 'Zahnarzt' });
    expect(arg.notifications[0].schedule.allowWhileIdle).toBe(true);
  });

  it('skips scheduling when nothing is due', async () => {
    checkPermissions.mockResolvedValue({ display: 'granted' });

    await service.reschedule([event([])], []);

    expect(schedule).not.toHaveBeenCalled();
  });
});
