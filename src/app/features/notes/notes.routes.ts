// SPDX-License-Identifier: GPL-3.0-or-later
import { Routes } from '@angular/router';

import { NoteDetailPage } from './note-detail/note-detail.page';
import { NoteEditPage } from './note-edit/note-edit.page';
import { NotesPage } from './notes.page';

export const notesRoutes: Routes = [
  { path: '', component: NotesPage },
  { path: 'new', component: NoteEditPage },
  { path: 'edit/:id', component: NoteEditPage },
  { path: ':id', component: NoteDetailPage },
];
