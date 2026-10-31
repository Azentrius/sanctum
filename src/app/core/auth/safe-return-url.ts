// SPDX-License-Identifier: GPL-3.0-or-later
const DEFAULT_RETURN = '/tabs/home';

/**
 * Accepts only in-app tab routes as post-login navigation targets.
 * Rejects external URLs, protocol-relative paths, and auth screens.
 */
export function safeReturnUrl(candidate: unknown, fallback = DEFAULT_RETURN): string {
  if (typeof candidate !== 'string') {
    return fallback;
  }

  const trimmed = candidate.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return fallback;
  }

  const path = trimmed.split(/[?#]/)[0];
  if (
    path === '/tabs' ||
    path.startsWith('/tabs/') ||
    path === '/tasks' ||
    path.startsWith('/tasks/') ||
    path === '/contacts' ||
    path.startsWith('/contacts/')
  ) {
    return path;
  }

  return fallback;
}
