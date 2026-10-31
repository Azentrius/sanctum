// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import {
  BehaviorSubject,
  Subject,
  combineLatest,
  firstValueFrom,
  take,
  takeUntil,
} from 'rxjs';

import { AccountService } from '../../core/accounts/account.service';
import { Note } from '../../core/notes/notes.model';
import { NotesService } from '../../core/notes/notes.service';
import { ConnectivityService } from '../../core/connectivity/connectivity.service';
import { OfflineReadFacade } from '../../core/connectivity/offline-read.facade';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { OfflineBannerComponent } from '../../shared/components/offline-banner/offline-banner.component';
import { SanctumVirtualListComponent } from '../../shared/components/sanctum-virtual-list/sanctum-virtual-list.component';
import { SanctumSpinnerComponent } from '../../shared/components/sanctum-spinner/sanctum-spinner.component';
import { resolveOfflineBanner } from '../../shared/offline/offline-banner.helpers';
import {
  NotesFilter,
  accountColorForNote,
  extractCategories,
  filterNotes,
  formatNoteModified,
  notePreview,
} from './notes.helpers';

@Component({
  selector: 'app-notes',
  templateUrl: './notes.page.html',
  styleUrls: ['./notes.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    IonicModule,
    TranslatePipe,
    PageHeaderComponent,
    SanctumSpinnerComponent,
    OfflineBannerComponent,
    SanctumVirtualListComponent,
  ],
})
export class NotesPage implements OnInit, OnDestroy, ViewWillEnter {
  notes: Note[] = [];
  categories: string[] = [];
  searchTerm = '';
  selectedCategory = '';
  favoritesOnly = false;
  isInitialLoad = true;
  offlineBannerVisible = false;
  offlineBannerMessage = '';

  private readonly notesService = inject(NotesService);
  private readonly accountService = inject(AccountService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly offlineRead = inject(OfflineReadFacade);
  private readonly cdr = inject(ChangeDetectorRef);

  private readonly filter$ = new BehaviorSubject<NotesFilter>({
    search: '',
    category: '',
    favoritesOnly: false,
  });
  private colorByAccount = new Map<string, string>();
  private hasLoaded = false;
  private readonly destroy$ = new Subject<void>();

  get writesEnabled(): boolean {
    return this.connectivity.isOnline();
  }

  ngOnInit(): void {
    this.accountService.accounts.pipe(takeUntil(this.destroy$)).subscribe((accounts) => {
      this.colorByAccount = new Map(accounts.map((account) => [account.id, account.color]));
      this.cdr.markForCheck();
    });

    combineLatest([this.notesService.allNotes, this.filter$])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([notes, filter]) => {
        this.categories = extractCategories(notes);
        this.notes = filterNotes(notes, filter);
        this.cdr.markForCheck();
      });

    if (globalThis.window !== undefined) {
      globalThis.window.addEventListener('online', () => void this.refreshOfflineBanner());
      globalThis.window.addEventListener('offline', () => void this.refreshOfflineBanner());
    }
  }

  ionViewWillEnter(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async load(): Promise<void> {
    this.isInitialLoad = !this.hasLoaded;
    this.cdr.markForCheck();

    await this.notesService.loadFromCache();
    if (this.connectivity.isOnline()) {
      try {
        await this.notesService.syncAll();
      } catch {
        // Keep cached notes when sync fails.
      }
    }

    this.hasLoaded = true;
    this.isInitialLoad = false;
    await this.refreshOfflineBanner();
    this.cdr.markForCheck();
  }

  async doRefresh(event: CustomEvent): Promise<void> {
    try {
      await this.notesService.syncAll({ force: true });
    } finally {
      (event.target as HTMLIonRefresherElement).complete();
    }
  }

  onSearch(value: string | null | undefined): void {
    this.searchTerm = value ?? '';
    this.pushFilter();
  }

  onCategoryChange(value: string | null | undefined): void {
    this.selectedCategory = value ?? '';
    this.pushFilter();
  }

  toggleFavoritesOnly(): void {
    this.favoritesOnly = !this.favoritesOnly;
    this.pushFilter();
  }

  accountColor(note: Note): string {
    return accountColorForNote(note, this.colorByAccount);
  }

  preview(note: Note): string {
    return notePreview(note.content);
  }

  modified(note: Note): string {
    return formatNoteModified(note.modified);
  }

  trackByNote(_index: number, note: Note): string {
    return note.id;
  }

  private pushFilter(): void {
    this.filter$.next({
      search: this.searchTerm,
      category: this.selectedCategory,
      favoritesOnly: this.favoritesOnly,
    });
  }

  private async refreshOfflineBanner(): Promise<void> {
    const accounts = await firstValueFrom(this.accountService.activeAccounts.pipe(take(1)));
    const accountIds = accounts.map((account) => account.id);
    const banner = await resolveOfflineBanner(this.offlineRead, 'notes', accountIds);
    this.offlineBannerVisible = banner.visible;
    this.offlineBannerMessage = banner.message;
    this.cdr.markForCheck();
  }
}
