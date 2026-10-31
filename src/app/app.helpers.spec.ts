// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { isHardwareBackExitRoute, shouldNavigateToAppLock } from './app.helpers';

describe('isHardwareBackExitRoute', () => {
  it('exits at navigation roots', () => {
    expect(isHardwareBackExitRoute('/tabs/home')).toBe(true);
    expect(isHardwareBackExitRoute('/app-lock')).toBe(true);
    expect(isHardwareBackExitRoute('/login')).toBe(true);
    expect(isHardwareBackExitRoute('/storage-unavailable')).toBe(true);
    expect(isHardwareBackExitRoute('/secure-state-recovery')).toBe(true);
    expect(isHardwareBackExitRoute('/cert-pin-mismatch')).toBe(true);
  });

  it('defers (pops) on spokes and detail pages', () => {
    expect(isHardwareBackExitRoute('/tabs/calendar')).toBe(false);
    expect(isHardwareBackExitRoute('/tabs/files')).toBe(false);
    expect(isHardwareBackExitRoute('/tabs/talk')).toBe(false);
    expect(isHardwareBackExitRoute('/tasks')).toBe(false);
    expect(isHardwareBackExitRoute('/contacts')).toBe(false);
    expect(isHardwareBackExitRoute('/tabs/talk/room/acc/token')).toBe(false);
  });

  it('ignores query and fragment when matching', () => {
    expect(isHardwareBackExitRoute('/tabs/home?foo=1')).toBe(true);
    expect(isHardwareBackExitRoute('/tabs/home#section')).toBe(true);
  });
});

describe('shouldNavigateToAppLock', () => {
  it('redirects only when lock is enabled and the user is locked', () => {
    expect(shouldNavigateToAppLock('/tabs/home', true, true)).toBe(true);
    expect(shouldNavigateToAppLock('/tabs/home', false, true)).toBe(false);
    expect(shouldNavigateToAppLock('/tabs/home', true, false)).toBe(false);
  });

  it('skips redirect on login and app-lock routes', () => {
    expect(shouldNavigateToAppLock('/login', true, true)).toBe(false);
    expect(shouldNavigateToAppLock('/app-lock', true, true)).toBe(false);
  });
});
