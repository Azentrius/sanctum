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
import { Subject, firstValueFrom, take, takeUntil } from 'rxjs';

import { AccountCalendar } from '../../core/accounts/account.model';
import { CalendarService } from '../../core/caldav/calendar.service';
import { EventService } from '../../core/caldav/event.service';
import { SyncService, SyncStatus } from '../../core/caldav/sync.service';
import { ConnectivityService } from '../../core/connectivity/connectivity.service';
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
  private readonly calendarService = inject(CalendarService);
  private readonly eventService = inject(EventService);
  private readonly syncService = inject(SyncService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toastCtrl = inject(ToastController);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly translate = inject(TranslateService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly offlineRead = inject(OfflineReadFacade);

  @ViewChild('fullCalendar') fullCalendarComponent!: FullCalendarComponent;

  offlineBannerVisible = false;
  offlineBannerMessage = '';

  get writesEnabled(): boolean {
    return this.connectivity.isOnline();
  }

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

    this.calendarService.enabledCalendars$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        void this.reloadEvents();
      });

    this.eventService.allEvents
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        void this.reloadEvents();
      });

    this.calendarService.allCalendars$
      .pipe(takeUntil(this.destroy$))
      .subscribe((calendars) => {
        this.calendars = calendars.filter((calendar) =>
          calendar.supportedComponents.includes('VEVENT'),
        );
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

    await this.calendarService.loadFromCache();
    const rangeStart = getBufferedRangeStart(new Date());
    const rangeEnd = getBufferedRangeEnd(new Date());
    await this.eventService.loadFromCache(rangeStart, rangeEnd);
    await this.reloadEvents();

    this.hasLoaded = true;
    this.isInitialLoad = false;
    await this.refreshOfflineBanner();
    this.cdr.markForCheck();
  }

  /** Full-range stale sync when the calendar tab is opened. */
  private async syncCalendarIfStale(): Promise<void> {
    try {
      await this.syncService.syncCalendar();
      await this.reloadEvents();
    } catch {
      // Background refresh: errors are surfaced via sync status / pull-to-refresh.
    }
  }

  async doRefresh(event: CustomEvent): Promise<void> {
    this.isSyncing = true;
    try {
      await this.syncService.syncCalendar({ force: true });
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

      const rawEvents = await firstValueFrom(
        this.eventService.getEventsForRange(rangeStart, rangeEnd).pipe(take(1))
      );
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
    void this.calendarService.toggleCalendar(calendarId);
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
