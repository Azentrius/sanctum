// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, NavController, ToastController } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject, firstValueFrom, take } from 'rxjs';

import { NextcloudAccount } from '../../../core/accounts/account.model';
import { AccountService } from '../../../core/accounts/account.service';
import { Note } from '../../../core/notes/notes.model';
import { NotesService } from '../../../core/notes/notes.service';
import { ConnectivityService } from '../../../core/connectivity/connectivity.service';
import { isNotesConflictError } from '../../../core/notes/notes-conflict.error';
import { isOfflineWriteBlockedError } from '../../../core/connectivity/offline-write-blocked.error';
import { MarkdownViewComponent } from '../../../shared/components/markdown-view/markdown-view.component';

@Component({
  selector: 'app-note-edit',
  templateUrl: './note-edit.page.html',
  styleUrls: ['./note-edit.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonicModule,
    TranslatePipe,
    MarkdownViewComponent,
  ],
})
export class NoteEditPage implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly navController = inject(NavController);
  private readonly notesService = inject(NotesService);
  private readonly accountService = inject(AccountService);
  private readonly toastController = inject(ToastController);
  private readonly translate = inject(TranslateService);
  private readonly connectivity = inject(ConnectivityService);

  readonly form = this.fb.nonNullable.group({
    accountId: ['', Validators.required],
    title: [''],
    category: [''],
    content: [''],
    favorite: [false],
  });

  isEdit = false;
  previewMode = false;
  saving = false;
  activeAccounts: NextcloudAccount[] = [];
  original: Note | null = null;
  private readonly destroy$ = new Subject<void>();

  get writesEnabled(): boolean {
    return this.connectivity.isOnline();
  }

  ngOnInit(): void {
    void this.init();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  togglePreview(): void {
    this.previewMode = !this.previewMode;
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving) {
      return;
    }
    this.saving = true;
    const value = this.form.getRawValue();
    const payload = {
      title: value.title.trim(),
      category: value.category.trim(),
      content: value.content,
      favorite: value.favorite,
    };

    try {
      if (this.isEdit && this.original) {
        await this.notesService.updateNote(this.original.id, payload, this.original.etag);
      } else {
        await this.notesService.createNote(value.accountId, payload);
      }
      const toast = await this.toastController.create({
        message: this.translate.instant(this.isEdit ? 'notes.SAVED' : 'notes.CREATED'),
        duration: 2500,
        color: 'success',
      });
      await toast.present();
      await this.navController.navigateBack('/notes');
    } catch (error) {
      const message = this.errorMessage(error);
      const toast = await this.toastController.create({
        message,
        duration: 3500,
        color: 'danger',
      });
      await toast.present();
      if (isNotesConflictError(error)) {
        this.original = error.serverNote;
        this.patchForm(error.serverNote);
      }
    } finally {
      this.saving = false;
    }
  }

  private async init(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    this.isEdit = !!id;

    this.activeAccounts = await firstValueFrom(
      this.accountService.activeAccounts.pipe(take(1)),
    );

    if (id) {
      const note = await firstValueFrom(this.notesService.getNoteById(id).pipe(take(1)));
      if (note) {
        if (note.content.trim()) {
          this.original = note;
          this.patchForm(note);
        } else {
          await this.notesService.loadNoteContent(note.accountId, note.noteId);
          const loaded = await firstValueFrom(this.notesService.getNoteById(id).pipe(take(1)));
          if (loaded) {
            this.original = loaded;
            this.patchForm(loaded);
          }
        }
      }
    } else {
      this.form.patchValue({
        accountId: this.activeAccounts[0]?.id ?? '',
      });
    }
  }

  private patchForm(note: Note): void {
    this.form.patchValue({
      accountId: note.accountId,
      title: note.title,
      category: note.category,
      content: note.content,
      favorite: note.favorite,
    });
  }

  private errorMessage(error: unknown): string {
    if (isOfflineWriteBlockedError(error)) {
      return this.translate.instant('offline.WRITE_DISABLED');
    }
    if (isNotesConflictError(error)) {
      return this.translate.instant('notes.CONFLICT');
    }
    if (error instanceof Error) {
      return error.message;
    }
    return this.translate.instant('notes.SAVE_FAILED');
  }
}
