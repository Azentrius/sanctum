// SPDX-License-Identifier: GPL-3.0-or-later
import { ENABLED_MODULES, startRoute } from './core/modules/app-modules';

/** Navigation roots where a hardware back press should exit the app. */
const HARDWARE_BACK_EXIT_ROUTES = new Set([
  startRoute(ENABLED_MODULES),
  '/tabs/home',
  '/app-lock',
  '/login',
  '/storage-unavailable',
  '/secure-state-recovery',
  '/cert-pin-mismatch',
]);

/** Whether a hardware back press at this url should exit the app (root reached). */
export function isHardwareBackExitRoute(url: string): boolean {
  const path = url.split('?')[0].split('#')[0];
  return HARDWARE_BACK_EXIT_ROUTES.has(path);
}

/** Whether the app should redirect to the lock screen after resume. */
export function shouldNavigateToAppLock(
  url: string,
  locked: boolean,
  lockEnabled: boolean,
): boolean {
  if (!lockEnabled || !locked) {
    return false;
  }
  if (url.startsWith('/app-lock') || url.startsWith('/login')) {
    return false;
  }
  return true;
}
