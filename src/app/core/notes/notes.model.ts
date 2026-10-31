// SPDX-License-Identifier: GPL-3.0-or-later
export interface Note {
  id: string;
  accountId: string;
  noteId: number;
  etag: string;
  readonly: boolean;
  modified: Date;
  title: string;
  category: string;
  content: string;
  favorite: boolean;
}

export interface NoteWritePayload {
  title?: string;
  category?: string;
  content?: string;
  favorite?: boolean;
  modified?: number;
}

export interface ApiNote {
  id: number;
  etag?: string;
  readonly?: boolean;
  modified: number;
  title: string;
  category?: string;
  content?: string;
  favorite?: boolean;
}
