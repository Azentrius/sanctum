// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, NavController, ToastController, ActionSheetController } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { firstValueFrom, take } from 'rxjs';

import { AccountCalendar, CalendarEvent } from '../../../core/accounts/account.model';
import { CalendarService } from '../../../core/caldav/calendar.service';
import { EventService } from '../../../core/caldav/event.service';
import type { EventWriteOptions } from '../../../core/caldav/event.service';
import { ConnectivityService } from '../../../core/connectivity/connectivity.service';
import { isOfflineWriteBlockedError } from '../../../core/connectivity/offline-write-blocked.error';
import { TranslationService } from '../../../core/i18n/translation.service';
import { toLocalDateTimeString } from '../../../utils/timezone.util';
import { AriaLabelDirective } from '../../../shared/directives/aria-label.directive';
import {
  isSeriesOccurrence,
  resolveRecurrenceId,
  type SeriesEditScope,
} from '../series-scope.util';

/**
 * Routed create/edit screen for calendar events: the page replacement for the
 * former EventModalComponent bottom sheet. New vs edit is driven by the route:
 *   /tabs/calendar/event/new?start=&end=&allDay=
 *   /tabs/calendar/event/edit?id=
 */
@Component({
  selector: 'app-event-edit',
  templateUrl: './event-edit.page.html',
  styleUrls: ['./event-edit.page.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonicModule, TranslatePipe, AriaLabelDirective],
})export class EventEditPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly navController = inject(NavController);
  private readonly calendarService = inject(CalendarService);
  private readonly eventService = inject(EventService);
  private readonly translationService = inject(TranslationService);
  private readonly translate = inject(TranslateService);
  private readonly toastController = inject(ToastController);
  private readonly connectivity = inject(ConnectivityService);
  private readonly actionSheetController = inject(ActionSheetController);

  form!: FormGroup;
  isEdit = false;
  calendars: AccountCalendar[] = [];

  get writesEnabled(): boolean {
    return this.connectivity.isOnline();
  }

  private event: CalendarEvent | null = null;

  get datetimeLocale(): string {
    return this.translationService.datetimeLocale;
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const id = params.get('id');
    this.isEdit = !!id;

    const defaultStart = params.get('start') ? new Date(params.get('start')!) : new Date();
    const defaultEnd = params.get('end')
      ? new Date(params.get('end')!)
      : new Date(Date.now() + 3_600_000);
    const allDayParam = params.get('allDay') === 'true';

    // Build the form synchronously so the template never binds an undefined
    // form (which would error/flash on open). Calendars and the edited event
    // are loaded right after and patched in.
    this.form = this.fb.group({
      title: ['', Validators.required],
      start: [toLocalDateTimeString(defaultStart), Validators.required],
      end: [toLocalDateTimeString(defaultEnd), Validators.required],
      allDay: [allDayParam],
      calendarId: ['', Validators.required],
      description: [''],
      tzid: [Intl.DateTimeFormat().resolvedOptions().timeZone],
    });

    void this.loadData(id);
  }

  private async loadData(id: string | null): Promise<void> {
    this.calendars = await firstValueFrom(
      this.calendarService.enabledCalendars.pipe(take(1)),
    );

    if (id) {
      this.event = await this.eventService.getById(id);
    }

    if (this.event) {
      const tzid = this.event.tzid;
      this.form.patchValue({
        title: this.event.title,
        start: toLocalDateTimeString(this.event.start, tzid),
        end: toLocalDateTimeString(this.event.end, tzid),
        allDay: this.event.allDay,
        calendarId: this.event.calendarId,
        description: this.event.description ?? '',
        tzid: tzid ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    } else {
      this.form.patchValue({ calendarId: this.calendars[0]?.id ?? '' });
    }
  }

  calendarColor(id: string): string {
    return this.calendars.find((calendar) => calendar.id === id)?.color ?? '#0082c9';
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      return;
    }

    const value = this.form.value;
    const calendar = this.calendars.find((item) => item.id === value.calendarId);
    if (!calendar) {
      await this.toast(this.translate.instant('ERRORS.CALENDAR_NOT_FOUND'), 'danger');
      return;
    }

    const start = new Date(value.start);
    const end = value.allDay ? new Date(value.start) : new Date(value.end);

    try {
      if (this.isEdit && this.event) {
        await this.saveExistingEvent(calendar, value, start, end);
      } else {
        await this.saveNewEvent(calendar, value, start, end);
      }
      this.navController.navigateBack('/tabs/calendar');
    } catch (error) {
      await this.handleEventActionError(error);
    }
  }

  private async saveExistingEvent(
    calendar: AccountCalendar,
    value: {
      calendarId: string;
      title: string;
      allDay: boolean;
      description: string;
      tzid: string;
    },
    start: Date,
    end: Date,
  ): Promise<void> {
    if (!this.event) {
      return;
    }
    const scope = await this.resolveSeriesScope('edit');
    if (!scope) {
      return;
    }
    const timeChanged =
      value.allDay !== this.event.allDay ||
      start.getTime() !== this.event.start.getTime() ||
      (!value.allDay && end.getTime() !== this.event.end.getTime());
    const writeOptions: EventWriteOptions =
      scope === 'single'
        ? { scope, recurrenceId: resolveRecurrenceId(this.event) }
        : { scope, skipTimeUpdate: !timeChanged };
    await this.eventService.updateEvent(
      {
        ...this.event,
        accountId: calendar.accountId,
        calendarId: value.calendarId,
        title: value.title.trim(),
        start,
        end,
        allDay: value.allDay,
        description: value.description,
        tzid: value.tzid,
      },
      writeOptions,
    );
    await this.toast(this.translate.instant('EVENT.UPDATED'), 'success');
  }

  private async saveNewEvent(
    calendar: AccountCalendar,
    value: {
      calendarId: string;
      title: string;
      allDay: boolean;
      description: string;
      tzid: string;
    },
    start: Date,
    end: Date,
  ): Promise<void> {
    await this.eventService.createEvent(calendar.accountId, value.calendarId, {
      title: value.title.trim(),
      start,
      end,
      allDay: value.allDay,
      description: value.description,
      tzid: value.tzid,
    });
    await this.toast(this.translate.instant('EVENT.CREATED'), 'success');
  }

  private async handleEventActionError(error: unknown): Promise<void> {
    if (isOfflineWriteBlockedError(error)) {
      await this.toast(this.translate.instant('offline.WRITE_DISABLED'), 'warning');
      return;
    }
    const message =
      error instanceof Error ? error.message : this.translate.instant('EVENT.ACTION_FAILED');
    await this.toast(message, 'danger');
  }

  async delete(): Promise<void> {
    if (!this.event) {
      return;
    }
    try {
      const scope = await this.resolveSeriesScope('delete');
      if (!scope) {
        return;
      }
      const writeOptions: EventWriteOptions =
        scope === 'single'
          ? { scope, recurrenceId: resolveRecurrenceId(this.event) }
          : { scope };
      await this.eventService.deleteEvent(this.event, writeOptions);
      await this.toast(this.translate.instant('EVENT.DELETED'), 'medium');
      this.navController.navigateBack('/tabs/calendar');
    } catch (error) {
      await this.handleEventActionError(error);
    }
  }

  private async resolveSeriesScope(
    action: 'edit' | 'delete',
  ): Promise<SeriesEditScope | null> {
    if (!this.event || !isSeriesOccurrence(this.event)) {
      return 'all';
    }

    const headerKey =
      action === 'edit'
        ? 'CALENDAR.SERIES_SCOPE_EDIT_HEADER'
        : 'CALENDAR.SERIES_SCOPE_DELETE_HEADER';

    return new Promise<SeriesEditScope | null>((resolve) => {
      void this.actionSheetController
        .create({
          header: this.translate.instant(headerKey),
          cssClass: 'series-scope-action-sheet',
          buttons: [
            {
              text: this.translate.instant('CALENDAR.SERIES_SCOPE_THIS'),
              handler: () => resolve('single'),
            },
            {
              text: this.translate.instant('CALENDAR.SERIES_SCOPE_ALL'),
              handler: () => resolve('all'),
            },
            {
              text: this.translate.instant('APP.CANCEL'),
              role: 'cancel',
              handler: () => resolve(null),
            },
          ],
        })
        .then((sheet) => sheet.present());
    });
  }

  private async toast(message: string, color: string): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 2500,
      color,
      position: 'bottom',
    });
    await toast.present();
  }
}
