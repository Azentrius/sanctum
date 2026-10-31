// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
import { IonicModule, NavController } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';

import { AriaLabelDirective } from '../../directives/aria-label.directive';
import {
  SearchContentResult,
  SearchNavDestination,
  SearchResults,
} from '../../../core/search/search.model';
import { QuickSwitcherFacade } from '../../../core/search/quick-switcher.facade';
import { SEARCH_DEBOUNCE_MS } from '../../../core/search/search.helpers';
import { SearchService } from '../../../core/search/search.service';

type SearchRow =
  | { kind: 'section'; id: string; labelKey: string }
  | { kind: 'nav'; id: string; destination: SearchNavDestination }
  | { kind: 'content'; id: string; result: SearchContentResult };

const CONTENT_ICONS: Record<SearchContentResult['kind'], string> = {
  event: 'calendar-outline',
  contact: 'person-outline',
  task: 'checkbox-outline',
  note: 'document-text-outline',
  file: 'document-outline',
};

@Component({
  selector: 'app-quick-switcher',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslatePipe, AriaLabelDirective],
  templateUrl: './quick-switcher.component.html',
  styleUrls: ['./quick-switcher.component.scss'],
})
export class QuickSwitcherComponent implements OnInit, OnDestroy {
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLIonSearchbarElement>;

  isOpen = false;
  query = '';
  isSearching = false;
  results: SearchResults = { navigation: [], content: [], contentTruncated: false };
  rows: SearchRow[] = [];
  activeIndex = -1;

  private readonly facade = inject(QuickSwitcherFacade);
  private readonly searchService = inject(SearchService);
  private readonly navController = inject(NavController);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  private readonly query$ = new Subject<string>();
  private readonly destroy$ = new Subject<void>();
  private searchGeneration = 0;

  ngOnInit(): void {
    this.facade.isOpen$
      .pipe(takeUntil(this.destroy$))
      .subscribe((open) => {
        this.isOpen = open;
        if (open) {
          this.resetState();
          void this.focusSearchInput();
        }
        this.cdr.markForCheck();
      });

    this.query$
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((term) => {
        void this.runSearch(term);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onDismiss(): void {
    this.facade.close();
  }

  onQueryInput(event: CustomEvent): void {
    const value = String(event.detail.value ?? '');
    this.query = value;
    this.activeIndex = -1;
    this.query$.next(value);
    this.cdr.markForCheck();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.facade.close();
      return;
    }

    if (this.rows.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex = Math.min(this.activeIndex + 1, this.selectableRows().length - 1);
      this.cdr.markForCheck();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex = Math.max(this.activeIndex - 1, 0);
      this.cdr.markForCheck();
      return;
    }

    if (event.key === 'Enter' && this.activeIndex >= 0) {
      event.preventDefault();
      const row = this.selectableRows()[this.activeIndex];
      if (row) {
        void this.activateRow(row);
      }
    }
  }

  activateAt(index: number): void {
    const row = this.selectableRows()[index];
    if (row) {
      void this.activateRow(row);
    }
  }

  isRowActive(index: number): boolean {
    return this.activeIndex === index;
  }

  selectableIndex(row: SearchRow): number {
    return this.selectableRows().findIndex((candidate) => candidate.id === row.id);
  }

  contentIcon(result: SearchContentResult): string {
    return CONTENT_ICONS[result.kind];
  }

  contentLabelKey(result: SearchContentResult): string {
    return `search.KIND_${result.kind.toUpperCase()}`;
  }

  optionDomId(index: number): string {
    return `search-option-${index}`;
  }

  activeOptionId(): string | null {
    if (this.activeIndex < 0) {
      return null;
    }
    return this.optionDomId(this.activeIndex);
  }

  private resetState(): void {
    this.query = '';
    this.isSearching = false;
    this.results = { navigation: [], content: [], contentTruncated: false };
    this.rows = this.buildRows(this.results);
    this.activeIndex = -1;
    void this.runSearch('');
  }

  private async focusSearchInput(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const el = this.searchInput?.nativeElement;
    if (!el) {
      return;
    }
    await el.setFocus();
  }

  private async runSearch(term: string): Promise<void> {
    const generation = ++this.searchGeneration;
    this.isSearching = true;
    this.cdr.markForCheck();

    try {
      const results = await this.searchService.search(term);
      if (generation !== this.searchGeneration) {
        return;
      }
      this.results = results;
      this.rows = this.buildRows(results);
      if (this.activeIndex >= this.selectableRows().length) {
        this.activeIndex = this.selectableRows().length - 1;
      }
    } finally {
      if (generation === this.searchGeneration) {
        this.isSearching = false;
        this.cdr.markForCheck();
      }
    }
  }

  private buildRows(results: SearchResults): SearchRow[] {
    const rows: SearchRow[] = [];

    if (results.navigation.length > 0) {
      rows.push({ kind: 'section', id: 'section-nav', labelKey: 'search.SECTION_NAV' });
      for (const destination of results.navigation) {
        rows.push({ kind: 'nav', id: `nav:${destination.id}`, destination });
      }
    }

    if (results.content.length > 0) {
      rows.push({ kind: 'section', id: 'section-content', labelKey: 'search.SECTION_CONTENT' });
      for (const result of results.content) {
        rows.push({ kind: 'content', id: result.id, result });
      }
    }

    return rows;
  }

  private selectableRows(): SearchRow[] {
    return this.rows.filter((row) => row.kind === 'nav' || row.kind === 'content');
  }

  private async activateRow(row: SearchRow): Promise<void> {
    this.facade.close();

    if (row.kind === 'nav') {
      await this.navController.navigateForward(row.destination.route);
      return;
    }

    if (row.kind === 'content') {
      await this.router.navigate(row.result.route, {
        queryParams: row.result.queryParams,
      });
    }
  }
}
