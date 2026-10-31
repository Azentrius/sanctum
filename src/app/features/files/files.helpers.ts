// SPDX-License-Identifier: GPL-3.0-or-later
import type { FileItem } from '../../core/webdav/file.model';

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic']);
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'log', 'json', 'csv', 'xml',
  'yml', 'yaml', 'ini', 'conf', 'ts', 'js', 'html', 'css',
]);

/** Which in-app preview, if any, a file supports. */
export type PreviewKind = 'image' | 'text' | 'pdf' | 'docx' | 'xlsx' | 'none';

/**
 * Decides which in-app preview a file supports, based on its MIME type first
 * and its extension as a fallback. Rich types (pdf/docx/xlsx) take priority;
 * everything else ('none') is handed to the OS "open with".
 */
export function previewKind(item: Pick<FileItem, 'name' | 'mimeType' | 'isDirectory'>): PreviewKind {
  if (item.isDirectory) {
    return 'none';
  }

  const mime = item.mimeType ?? '';
  const ext = item.name.split('.').pop()?.toLowerCase() ?? '';

  if (mime === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }
  if (mime.includes('wordprocessingml.document') || ext === 'docx') {
    return 'docx';
  }
  if (mime.includes('spreadsheetml.sheet') || ext === 'xlsx' || ext === 'xls') {
    return 'xlsx';
  }
  if (mime.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) {
    return 'image';
  }
  if (mime.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) {
    return 'text';
  }
  return 'none';
}

/**
 * Human-readable file size in German notation (comma decimal). Returns '' for
 * zero/unknown sizes so the UI can omit it for folders.
 */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) {
    return '';
  }

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded.toString().replace('.', ',')} ${SIZE_UNITS[unit]}`;
}

const FALLBACK_ICON = 'document-outline';

/**
 * File-extension → Ionicon (outline) mapping, grouped by kind. All icons are
 * monochrome `-outline` variants to match the rest of the app (tab bar, lists).
 * Office formats (incl. ODF / OnlyOffice) get distinct document/grid/easel
 * icons so Word, Excel and PowerPoint are tellable apart at a glance.
 */
const ICON_GROUPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  // Documents & PDF
  ['reader-outline', ['pdf']],
  ['document-text-outline', ['doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'markdown', 'log', 'pages']],
  // Spreadsheets
  ['grid-outline', ['xls', 'xlsx', 'ods', 'csv', 'tsv', 'numbers']],
  // Presentations
  ['easel-outline', ['ppt', 'pptx', 'odp', 'key']],
  // Images
  ['image-outline', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'tiff', 'tif', 'avif', 'ico']],
  // Audio / video
  ['videocam-outline', ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'mpg', 'mpeg', 'wmv', 'flv']],
  ['musical-notes-outline', ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'opus', 'aiff']],
  // Archives
  ['archive-outline', ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz']],
  // Code
  ['code-slash-outline', ['js', 'ts', 'jsx', 'tsx', 'html', 'htm', 'css', 'scss', 'sass', 'json', 'xml', 'yaml', 'yml', 'py', 'rb', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'php', 'sh', 'swift', 'kt', 'sql']],
  // Misc well-known kinds
  ['book-outline', ['epub', 'mobi', 'azw', 'azw3']],
  ['disc-outline', ['iso', 'dmg', 'img']],
  ['calendar-outline', ['ics']],
  ['person-outline', ['vcf']],
  ['text-outline', ['ttf', 'otf', 'woff', 'woff2', 'eot']],
];

const EXTENSION_ICONS: Record<string, string> = Object.fromEntries(
  ICON_GROUPS.flatMap(([icon, extensions]) => extensions.map((ext) => [ext, icon])),
);

/** Falls back to the MIME type when the extension is unknown/missing. */
function iconForMime(mime: string): string | undefined {
  if (mime.startsWith('image/')) {
    return 'image-outline';
  }
  if (mime.startsWith('video/')) {
    return 'videocam-outline';
  }
  if (mime.startsWith('audio/')) {
    return 'musical-notes-outline';
  }
  if (mime === 'application/pdf') {
    return 'reader-outline';
  }
  if (mime.includes('wordprocessingml') || mime === 'application/msword' || mime.includes('opendocument.text')) {
    return 'document-text-outline';
  }
  if (mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel' || mime.includes('opendocument.spreadsheet')) {
    return 'grid-outline';
  }
  if (mime.includes('presentationml') || mime === 'application/vnd.ms-powerpoint' || mime.includes('opendocument.presentation')) {
    return 'easel-outline';
  }
  if (mime.includes('zip') || mime.includes('compressed') || mime.includes('tar') || mime.includes('gzip')) {
    return 'archive-outline';
  }
  if (mime.startsWith('text/')) {
    return 'document-text-outline';
  }
  return undefined;
}

/**
 * Picks an Ionicon (outline) name for a file or folder, by extension first and
 * MIME type as a fallback, defaulting to a generic document icon.
 */
export function fileIcon(item: Pick<FileItem, 'isDirectory' | 'name' | 'mimeType'>): string {
  if (item.isDirectory) {
    return 'folder-outline';
  }

  const ext = item.name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_ICONS[ext] ?? iconForMime(item.mimeType ?? '') ?? FALLBACK_ICON;
}
