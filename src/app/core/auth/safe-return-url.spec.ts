// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { safeReturnUrl } from './safe-return-url';

describe('safeReturnUrl', () => {
  it('returns the fallback for missing or non-string values', () => {
    expect(safeReturnUrl(undefined)).toBe('/tabs/home');
    expect(safeReturnUrl(null)).toBe('/tabs/home');
    expect(safeReturnUrl(42)).toBe('/tabs/home');
  });

  it('accepts /tabs and /tabs/... paths without query or hash', () => {
    expect(safeReturnUrl('/tabs/calendar')).toBe('/tabs/calendar');
    expect(safeReturnUrl('/tabs/calendar/event/new?foo=1#bar')).toBe('/tabs/calendar/event/new');
  });

  it('accepts hub routes outside the tab shell', () => {
    expect(safeReturnUrl('/contacts/edit/abc')).toBe('/contacts/edit/abc');
    expect(safeReturnUrl('/tasks/task/new')).toBe('/tasks/task/new');
  });

  it('rejects external and protocol-relative targets', () => {
    expect(safeReturnUrl('https://evil.example/phish')).toBe('/tabs/home');
    expect(safeReturnUrl('//evil.example/phish')).toBe('/tabs/home');
  });

  it('rejects auth routes and other non-tab paths', () => {
    expect(safeReturnUrl('/login')).toBe('/tabs/home');
    expect(safeReturnUrl('/app-lock')).toBe('/tabs/home');
    expect(safeReturnUrl('/calendar')).toBe('/tabs/home');
  });
});
