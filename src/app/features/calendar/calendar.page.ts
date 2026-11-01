// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import {
  CalendarOptions,
  DateSelectArg,
  EventClickArg,
  EventInput,
} from '@fullcalendar/core';
import deLocale from '@fullcalendar/core/locales/de';
import { FullCalendarComponent, FullCalendarModule } from '@fullcalendar/angular';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import timeGridPlugin from '@fullcalendar/timegrid';
import { IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';

import { AccountCalendar } from '../../core/accounts/account.model';
import { SyncService, SyncStatus } from '../../core/caldav/sync.service';
import { CALENDAR_SOURCE } from '../../core/calendar-source/calendar-source';
import { ConnectivityService } from '../../core/connectivity/connectivity.service';
import { APP_MODULES } from '../../core/modules/app-modules';
import { OfflineReadFacade } from '../../core/connectivity/offline-read.facade';
import {
  getBufferedRangeEnd,
  getBufferedRangeStart,
  mapEventsToFullCalendar,
  resolveFullCalendarLocale,
  syncStatusIcon as syncStatusIconFor,
} from './calendar.helpers';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { OfflineBannerComponent } from '../../shared/components/offline-banner/offline-banner.component';
import { SanctumSpinnerComponent } from '../../shared/components/sanctum-spinner/sanctum-spinner.component';
import { AriaLabelDirective } from '../../shared/directives/aria-label.directive';
import { resolveOfflineBanner } from '../../shared/offline/offline-banner.helpers';

type ViewKey = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek';

@Component({
  selector: 'app-calendar',
  templateUrl: './calendar.page.html',
  styleUrls: ['./calendar.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonicModule,
    TranslatePipe,
    FullCalendarModule,
    PageHeaderComponent,
    SanctumSpinnerComponent,
    OfflineBannerComponent,
    AriaLabelDirective,
  ],
})
export class CalendarPage implements OnInit, OnDestroy, ViewWillEnter {
  private readonly source = inject(CALENDAR_SOURCE);
  private readonly syncService = inject(SyncService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toastCtrl = inject(ToastController);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly translate = inject(TranslateService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly offlineRead = inject(OfflineReadFacade);

  @ViewChild('fullCalendar') fullCalendarComponent!: FullCalendarComponent;

  /** Back to the dashboard when it is shown; otherwise the calendar is the start screen. */
  readonly backHref = inject(APP_MODULES).dashboard ? '/tabs/home' : undefined;

  offlineBannerVisible = false;
  offlineBannerMessage = '';

  get writesEnabled(): boolean {
    return !this.source.writesNeedNetwork || this.connectivity.isOnline();
  }

  /** On Android: the app may not read the Android calendar yet. */
  needsAccess = false;

  readonly views: { key: ViewKey; labelKey: string }[] = [
    { key: 'dayGridMonth', labelKey: 'CALENDAR.VIEW_MONTH' },
    { key: 'timeGridWeek', labelKey: 'CALENDAR.VIEW_WEEK' },
    { key: 'timeGridDay', labelKey: 'CALENDAR.VIEW_DAY' },
    { key: 'listWeek', labelKey: 'CALENDAR.VIEW_AGENDA' },
  ];

  activeView: ViewKey = 'dayGridMonth';
  isSyncing = false;
  isInitialLoad = true;
  eventsLoading = false;
  calendars: AccountCalendar[] = [];
  syncStatusMap = new Map<string, SyncStatus>();

  private hasLoaded = false;

  calendarOptions: CalendarOptions = {
    plugins: [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin],
    locale: deLocale,
    timeZone: 'local',
    initialView: 'dayGridMonth',
    firstDay: 1,
    height: '100%',
    expandRows: true,
    dayMaxEvents: 2,
    fixedWeekCount: false,
    headerToolbar: {
      start: 'prev',
      center: 'title',
      end: 'next',
    },
    selectable: true,
    selectMirror: true,
    editable: false,
    events: [] as EventInput[],
    eventClick: (arg: EventClickArg) => {
      this.onEventClick(arg);
    },
    select: (arg: DateSelectArg) => {
      this.onDateSelect(arg);
    },
    datesSet: () => {
      void this.reloadEvents();
    },
    longPressDelay: 300,
    eventLongPressDelay: 300,
  };

  private readonly destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.applyFullCalendarLocale(this.translate.getCurrentLang() ?? 'de');

    this.translate.onLangChange
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ lang }) => {
        this.applyFullCalendarLocale(lang);
      });

    this.source.changed
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        void this.reloadEvents();
      });

    this.source.calendars
      .pipe(takeUntil(this.destroy$))
      .subscribe((calendars) => {
        this.calendars = calendars;
        this.cdr.markForCheck();
      });

    this.source.needsAccess
      .pipe(takeUntil(this.destroy$))
      .subscribe((needsAccess) => {
        this.needsAccess = needsAccess;
        this.cdr.markForCheck();
      });

    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      if (params.get('create') === '1') {
        this.newEvent();
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { create: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
      // Legacy deep links from dashboard
      if (params.get('mode') === 'tasks') {
        void this.router.navigate(['/tasks'], { replaceUrl: true });
      }
    });

    this.syncService.statusMap$
      .pipe(takeUntil(this.destroy$))
      .subscribe((map) => {
        this.syncStatusMap = map;
        this.cdr.markForCheck();
      });

    if (globalThis.window !== undefined) {
      globalThis.window.addEventListener('online', () => void this.refreshOfflineBanner());
      globalThis.window.addEventListener('offline', () => void this.refreshOfflineBanner());
    }
  }

  ionViewWillEnter(): void {
    void this.initialSync();
    void this.syncCalendarIfStale();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async initialSync(): Promise<void> {
    this.isInitialLoad = !this.hasLoaded;
    this.cdr.markForCheck();

    try {
      await this.source.open();
    } catch {
      // Shown as an empty calendar; pull-to-refresh tries again
    }
    await this.reloadEvents();

    this.hasLoaded = true;
    this.isInitialLoad = false;
    await this.refreshOfflineBanner();
    this.cdr.markForCheck();
  }

  /** Full-range stale sync when the calendar tab is opened. */
  private async syncCalendarIfStale(): Promise<void> {
    try {
      await this.source.refreshIfStale();
      await this.reloadEvents();
    } catch {
      // Background refresh: errors are surfaced via sync status / pull-to-refresh.
    }
  }

  async doRefresh(event: CustomEvent): Promise<void> {
    this.isSyncing = true;
    try {
      await this.source.refresh();
      await this.reloadEvents();
    } catch {
      await this.showToast(
        this.translate.instant('CALENDAR.SYNC_FAILED'),
        'danger'
      );
    } finally {
      this.isSyncing = false;
      (event.target as HTMLIonRefresherElement).complete();
    }
  }

  async reloadEvents(): Promise<void> {
    const api = this.fullCalendarComponent?.getApi();
    if (!api) {
      return;
    }

    this.eventsLoading = true;
    this.cdr.markForCheck();
    try {
      const viewStart = api.view.activeStart;
      const viewEnd = api.view.activeEnd;
      const rangeStart = getBufferedRangeStart(viewStart);
      const rangeEnd = getBufferedRangeEnd(viewEnd);

      const rawEvents = await this.source.eventsForRange(rangeStart, rangeEnd);
      const fcEvents = mapEventsToFullCalendar(
        rawEvents,
        this.calendars,
        this.translate.instant('EVENT.NO_TITLE'),
      );

      this.calendarOptions = {
        ...this.calendarOptions,
        events: fcEvents,
      };
    } finally {
      this.eventsLoading = false;
      this.cdr.markForCheck();
    }
  }

  switchView(view: ViewKey): void {
    this.activeView = view;
    this.fullCalendarComponent?.getApi().changeView(view);
    setTimeout(() => {
      void this.reloadEvents();
    }, 50);
  }

  goToday(): void {
    this.fullCalendarComponent?.getApi().today();
  }

  toggleCalendar(calendarId: string): void {
    void this.source.toggleCalendar(calendarId);
  }

  async grantAccess(): Promise<void> {
    if (!(await this.source.grantAccess())) {
      await this.showToast(this.translate.instant('CALENDAR.ACCESS_DENIED'), 'warning');
    }
    await this.reloadEvents();
  }

  onEventClick(arg: EventClickArg): void {
    const eventId = arg.event.id;
    if (!eventId) {
      return;
    }
    void this.router.navigate(['/tabs/calendar/event/edit'], {
      queryParams: { id: eventId },
    });
  }

  onDateSelect(arg: DateSelectArg): void {
    if (!this.writesEnabled) {
      void this.showOfflineWriteToast();
      this.fullCalendarComponent?.getApi().unselect();
      return;
    }
    void this.router.navigate(['/tabs/calendar/event/new'], {
      queryParams: {
        start: arg.start.toISOString(),
        end: arg.end.toISOString(),
        allDay: arg.allDay,
      },
    });
    this.fullCalendarComponent?.getApi().unselect();
  }

  newEvent(): void {
    if (!this.writesEnabled) {
      void this.showOfflineWriteToast();
      return;
    }
    const start = new Date();
    const end = new Date(Date.now() + 3_600_000);
    void this.router.navigate(['/tabs/calendar/event/new'], {
      queryParams: { start: start.toISOString(), end: end.toISOString(), allDay: false },
    });
  }

  syncStatusIcon(accountId: string): string {
    return syncStatusIconFor(this.syncStatusMap.get(accountId));
  }

  private async refreshOfflineBanner(): Promise<void> {
    if (!this.source.writesNeedNetwork) {
      // The Android calendar works offline; the sync catches up later
      this.offlineBannerVisible = false;
      this.cdr.markForCheck();
      return;
    }
    const accountIds = [...new Set(this.calendars.map((calendar) => calendar.accountId))];
    const banner = await resolveOfflineBanner(this.offlineRead, 'calendar', accountIds);
    this.offlineBannerVisible = banner.visible;
    this.offlineBannerMessage = banner.message;
    this.cdr.markForCheck();
  }

  private async showOfflineWriteToast(): Promise<void> {
    await this.showToast(this.translate.instant('offline.WRITE_DISABLED'), 'warning');
  }

  private applyFullCalendarLocale(lang: string): void {
    const locale = resolveFullCalendarLocale(lang);
    this.calendarOptions = { ...this.calendarOptions, locale };
    this.fullCalendarComponent?.getApi()?.setOption('locale', locale);
    this.cdr.markForCheck();
  }

  private async showToast(message: string, color: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2500,
      color,
      position: 'bottom',
    });
    await toast.present();
  }
}
