// SPDX-License-Identifier: GPL-3.0-or-later
import type { DAVCalendar } from 'tsdav';

import { davErrorAuthVerdict } from '../http/dav-write.error';

export function isCaldavAuthFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const typedVerdict = davErrorAuthVerdict(error);
  if (typedVerdict !== undefined) {
    return typedVerdict;
  }
  const message = error.message;
  return (
    /(^|\D)401(\D|$)/.test(message) ||
    /\bunauthorized\b/i.test(message) ||
    /invalid credentials/i.test(message)
  );
}

export function isCaldavCalendarReadOnly(calendar: DAVCalendar): boolean {
  const privileges = calendar.projectedProps?.['currentUserPrivilegeSet'];

  if (privileges === undefined || privileges === null) {
    return false;
  }

  const serialized = JSON.stringify(privileges).toLowerCase();
  const canWrite =
    serialized.includes('write') ||
    serialized.includes('bind') ||
    serialized.includes('all');
  return !canWrite;
}
