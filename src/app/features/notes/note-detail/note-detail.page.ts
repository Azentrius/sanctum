// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, AlertController, NavController, ToastController } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, firstValueFrom, take } from 'rxjs';

import { Note } from '../../../core/notes/notes.model';
import { NotesService } from '../../../core/notes/notes.service';
import { ConnectivityService } from '../../../core/connectivity/connectivity.service';
import { isOfflineWriteBlockedError } from '../../../core/connectivity/offline-write-blocked.error';
import { MarkdownViewComponent } from '../../../shared/components/markdown-view/markdown-view.component';
import { formatNoteModified } from '../notes.helpers';

@Component({
  selector: 'app-note-detail',
  templateUrl: './note-detail.page.html',
  styleUrls: ['./note-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslatePipe, MarkdownViewComponent],
})
export class NoteDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly navController = inject(NavController);
  private readonly notesService = inject(NotesService);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);
  private readonly translate = inject(TranslateService);
  private readonly connectivity = inject(ConnectivityService);

  note$!: Observable<Note | undefined>;
  contentLoading = false;

  get writesEnabled(): boolean {
    return this.connectivity.isOnline();
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.note$ = this.notesService.getNoteById(id);
    void this.loadContent(id);
  }

  modified(note: Note): string {
    return formatNoteModified(note.modified);
  }

  async edit(note: Note): Promise<void> {
    await this.navController.navigateForward(['/notes/edit', note.id]);
  }

  async delete(note: Note): Promise<void> {
    const alert = await this.alertController.create({
      header: this.translate.instant('notes.DELETE_TITLE'),
      message: this.translate.instant('notes.DELETE_CONFIRM'),
      buttons: [
        { text: this.translate.instant('APP.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('notes.DELETE_ACTION'),
          role: 'destructive',
          handler: () => {
            void this.confirmDelete(note);
          },
        },
      ],
    });
    await alert.present();
  }

  private async loadContent(id: string): Promise<void> {
    const note = await firstValueFrom(this.notesService.getNoteById(id).pipe(take(1)));
    if (!note || note.content.trim()) {
      return;
    }
    this.contentLoading = true;
    try {
      await this.notesService.loadNoteContent(note.accountId, note.noteId);
    } finally {
      this.contentLoading = false;
    }
  }

  private async confirmDelete(note: Note): Promise<void> {
    try {
      await this.notesService.deleteNote(note.id);
      const toast = await this.toastController.create({
        message: this.translate.instant('notes.DELETED'),
        duration: 2500,
        color: 'success',
      });
      await toast.present();
      await this.navController.navigateBack('/notes');
    } catch (error) {
      const message = this.deleteErrorMessage(error);
      const toast = await this.toastController.create({
        message,
        duration: 3000,
        color: 'danger',
      });
      await toast.present();
    }
  }

  private deleteErrorMessage(error: unknown): string {
    if (isOfflineWriteBlockedError(error)) {
      return this.translate.instant('offline.WRITE_DISABLED');
    }
    if (error instanceof Error) {
      return error.message;
    }
    return this.translate.instant('notes.DELETE_FAILED');
  }
}
