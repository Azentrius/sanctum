// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import type { FileItem } from '../../core/webdav/file.model';
import { fileIcon, formatFileSize, previewKind } from './files.helpers';

describe('formatFileSize', () => {
  it('returns an empty string for zero/unknown sizes', () => {
    expect(formatFileSize(0)).toBe('');
    expect(formatFileSize(-1)).toBe('');
  });

  it('formats bytes with German comma notation', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('1,5 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatFileSize(3 * 1024 * 1024 * 1024)).toBe('3 GB');
  });
});

describe('fileIcon', () => {
  const base: Pick<FileItem, 'isDirectory' | 'name' | 'mimeType'> = {
    isDirectory: false,
    name: 'x',
  };

  it('uses a folder icon for directories', () => {
    expect(fileIcon({ ...base, isDirectory: true, name: 'Docs' })).toBe('folder-outline');
  });

  it('maps documents, PDF and the office trio by extension', () => {
    expect(fileIcon({ ...base, name: 'report.pdf' })).toBe('reader-outline');
    expect(fileIcon({ ...base, name: 'Letter.docx' })).toBe('document-text-outline');
    expect(fileIcon({ ...base, name: 'notes.odt' })).toBe('document-text-outline');
    expect(fileIcon({ ...base, name: 'Budget.xlsx' })).toBe('grid-outline');
    expect(fileIcon({ ...base, name: 'data.csv' })).toBe('grid-outline');
    expect(fileIcon({ ...base, name: 'Pitch.pptx' })).toBe('easel-outline');
    expect(fileIcon({ ...base, name: 'Slides.odp' })).toBe('easel-outline');
  });

  it('maps media, archives, code and misc kinds by extension', () => {
    expect(fileIcon({ ...base, name: 'photo.JPG' })).toBe('image-outline');
    expect(fileIcon({ ...base, name: 'clip.mov' })).toBe('videocam-outline');
    expect(fileIcon({ ...base, name: 'song.mp3' })).toBe('musical-notes-outline');
    expect(fileIcon({ ...base, name: 'archive.zip' })).toBe('archive-outline');
    expect(fileIcon({ ...base, name: 'main.ts' })).toBe('code-slash-outline');
    expect(fileIcon({ ...base, name: 'novel.epub' })).toBe('book-outline');
    expect(fileIcon({ ...base, name: 'event.ics' })).toBe('calendar-outline');
    expect(fileIcon({ ...base, name: 'contact.vcf' })).toBe('person-outline');
  });

  it('falls back to the MIME type when the extension is unknown', () => {
    expect(fileIcon({ ...base, name: 'blob', mimeType: 'image/png' })).toBe('image-outline');
    expect(fileIcon({ ...base, name: 'blob', mimeType: 'application/pdf' })).toBe('reader-outline');
    expect(
      fileIcon({
        ...base,
        name: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }),
    ).toBe('easel-outline');
    expect(fileIcon({ ...base, name: 'blob', mimeType: 'video/mp4' })).toBe('videocam-outline');
    expect(fileIcon({ ...base, name: 'blob', mimeType: 'audio/mpeg' })).toBe('musical-notes-outline');
    expect(fileIcon({ ...base, name: 'blob', mimeType: 'application/msword' })).toBe(
      'document-text-outline',
    );
    expect(fileIcon({ ...base, name: 'blob', mimeType: 'application/vnd.ms-excel' })).toBe(
      'grid-outline',
    );
    expect(fileIcon({ ...base, name: 'blob', mimeType: 'application/vnd.ms-powerpoint' })).toBe(
      'easel-outline',
    );
    expect(fileIcon({ ...base, name: 'blob', mimeType: 'application/zip' })).toBe('archive-outline');
    expect(fileIcon({ ...base, name: 'blob', mimeType: 'text/plain' })).toBe('document-text-outline');
  });

  it('defaults to a generic document icon', () => {
    expect(fileIcon({ ...base, name: 'unknown.bin' })).toBe('document-outline');
    expect(fileIcon({ ...base, name: 'noextension' })).toBe('document-outline');
  });
});

describe('previewKind', () => {
  const base = { isDirectory: false, name: 'x' };

  it('never previews directories', () => {
    expect(previewKind({ isDirectory: true, name: 'Docs' })).toBe('none');
  });

  it('detects images by MIME or extension', () => {
    expect(previewKind({ ...base, mimeType: 'image/png', name: 'a.png' })).toBe('image');
    expect(previewKind({ ...base, name: 'photo.JPG' })).toBe('image');
  });

  it('detects text/markdown by MIME or extension', () => {
    expect(previewKind({ ...base, mimeType: 'text/plain', name: 'a' })).toBe('text');
    expect(previewKind({ ...base, name: 'README.md' })).toBe('text');
    expect(previewKind({ ...base, name: 'data.json' })).toBe('text');
  });

  it('detects pdf, docx and xlsx as their own kinds', () => {
    expect(previewKind({ ...base, mimeType: 'application/pdf', name: 'a.pdf' })).toBe('pdf');
    expect(previewKind({ ...base, name: 'Letter.docx' })).toBe('docx');
    expect(previewKind({ ...base, name: 'Budget.xlsx' })).toBe('xlsx');
    expect(previewKind({ ...base, name: 'old.xls' })).toBe('xlsx');
  });

  it('leaves powerpoint and unknown binary types to "open with"', () => {
    expect(previewKind({ ...base, name: 'slides.pptx' })).toBe('none');
    expect(previewKind({ ...base, name: 'archive.zip' })).toBe('none');
  });
});
