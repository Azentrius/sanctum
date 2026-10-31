// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { DAVCalendar } from 'tsdav';

import { DavWriteError } from '../http/dav-write.error';
import { PreconditionFailedError } from '../http/precondition-failed.error';
import { isCaldavAuthFailure, isCaldavCalendarReadOnly } from './caldav.status';

const calendarWithPrivileges = (privileges: unknown): DAVCalendar =>
  ({ url: 'https://x/cal/', projectedProps: { currentUserPrivilegeSet: privileges } }) as unknown as DAVCalendar;

describe('isCaldavAuthFailure', () => {
  it('returns false for non-Error values', () => {
    expect(isCaldavAuthFailure('401')).toBe(false);
    expect(isCaldavAuthFailure(null)).toBe(false);
    expect(isCaldavAuthFailure({ message: '401' })).toBe(false);
  });

  it('detects a standalone 401 status code', () => {
    expect(isCaldavAuthFailure(new Error('Request failed with status code 401'))).toBe(true);
    expect(isCaldavAuthFailure(new Error('HTTP 401'))).toBe(true);
    expect(isCaldavAuthFailure(new Error('401'))).toBe(true);
  });

  it('detects unauthorized / invalid-credentials phrases (case-insensitive)', () => {
    expect(isCaldavAuthFailure(new Error('Unauthorized'))).toBe(true);
    expect(isCaldavAuthFailure(new Error('Invalid credentials'))).toBe(true);
    expect(isCaldavAuthFailure(new Error('INVALID CREDENTIALS provided'))).toBe(true);
  });

  it('does not match 401 embedded in a larger number', () => {
    expect(isCaldavAuthFailure(new Error('Error code 1401'))).toBe(false);
    expect(isCaldavAuthFailure(new Error('status 40123'))).toBe(false);
  });

  it('does not match unrelated errors', () => {
    expect(isCaldavAuthFailure(new Error('Network request failed'))).toBe(false);
    expect(isCaldavAuthFailure(new Error('authorized'))).toBe(false);
    expect(isCaldavAuthFailure(new Error('500 Internal Server Error'))).toBe(false);
  });

  it('decides typed DAV errors by status, not by message text', () => {
    const url = 'https://x/remote.php/dav/calendars/alice/personal/401.ics';
    expect(isCaldavAuthFailure(new DavWriteError(401, 'PUT', url))).toBe(true);
    expect(isCaldavAuthFailure(new DavWriteError(403, 'PUT', url))).toBe(false);
    expect(isCaldavAuthFailure(new PreconditionFailedError(url, 'PUT'))).toBe(false);
  });
});

describe('isCaldavCalendarReadOnly', () => {
  it('treats absent privilege metadata as writable', () => {
    expect(isCaldavCalendarReadOnly(calendarWithPrivileges(undefined))).toBe(false);
    expect(isCaldavCalendarReadOnly(calendarWithPrivileges(null))).toBe(false);
  });

  it('is writable when privileges grant write, bind or all', () => {
    expect(isCaldavCalendarReadOnly(calendarWithPrivileges([{ '{DAV:}write': {} }]))).toBe(false);
    expect(isCaldavCalendarReadOnly(calendarWithPrivileges([{ '{DAV:}bind': {} }]))).toBe(false);
    expect(isCaldavCalendarReadOnly(calendarWithPrivileges([{ '{DAV:}all': {} }]))).toBe(false);
    expect(
      isCaldavCalendarReadOnly(
        calendarWithPrivileges([{ '{DAV:}read': {} }, { '{DAV:}write-content': {} }]),
      ),
    ).toBe(false);
  });

  it('is read-only when only read privileges are present', () => {
    expect(isCaldavCalendarReadOnly(calendarWithPrivileges([{ '{DAV:}read': {} }]))).toBe(true);
    expect(
      isCaldavCalendarReadOnly(
        calendarWithPrivileges([{ '{DAV:}read': {} }, { '{DAV:}read-current-user-privilege-set': {} }]),
      ),
    ).toBe(true);
  });
});
