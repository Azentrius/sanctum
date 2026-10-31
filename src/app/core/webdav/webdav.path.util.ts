// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pure helpers for manipulating account-relative WebDAV paths and building the
 * absolute, URL-encoded DAV URLs the server expects. Paths handled here are the
 * *decoded* account-relative form used in {@link FileItem.path}: leading slash,
 * directories with a trailing slash, root = "/".
 */

/** Collapses duplicate slashes and guarantees a single leading slash. */
function collapseSlashes(path: string): string {
  return `/${path}`.replace(/\/+/g, '/');
}

/** Normalises a value to a directory path: leading + trailing slash. */
export function normalizeDirPath(path: string | null | undefined): string {
  const collapsed = collapseSlashes(path ?? '/');
  return collapsed.endsWith('/') ? collapsed : `${collapsed}/`;
}

/** The parent directory of a path (file or folder). Root's parent is root. */
export function parentPath(path: string): string {
  const collapsed = collapseSlashes(path).replace(/\/$/, '');
  const idx = collapsed.lastIndexOf('/');
  if (idx <= 0) {
    return '/';
  }
  return `${collapsed.slice(0, idx)}/`;
}

/** Decoded last segment of a path. Root returns ''. */
export function basename(path: string): string {
  const trimmed = collapseSlashes(path).replace(/\/$/, '');
  const idx = trimmed.lastIndexOf('/');
  return trimmed.slice(idx + 1);
}

/** Per-segment URL encoding that preserves the slash structure. */
export function encodePath(path: string): string {
  return collapseSlashes(path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Resolves an account-relative path against the absolute files-root URL into an
 * absolute, URL-encoded DAV URL. `rootUrl` must end with a slash.
 */
export function toAbsoluteUrl(rootUrl: string, relativePath: string): string {
  const encoded = encodePath(relativePath).replace(/^\//, '');
  return `${rootUrl}${encoded}`;
}

export interface Breadcrumb {
  name: string;
  path: string;
}

/**
 * Builds breadcrumb segments for a directory path, each carrying the cumulative
 * path to navigate to. The root crumb is the caller's responsibility; this
 * returns only the named segments below root.
 */
export function buildBreadcrumb(path: string): Breadcrumb[] {
  const segments = collapseSlashes(path)
    .split('/')
    .filter((segment) => segment.length > 0);

  const crumbs: Breadcrumb[] = [];
  let cumulative = '';
  for (const segment of segments) {
    cumulative = `${cumulative}/${segment}`;
    crumbs.push({ name: segment, path: `${cumulative}/` });
  }
  return crumbs;
}
