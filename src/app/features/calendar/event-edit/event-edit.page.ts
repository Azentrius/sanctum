// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, NavController, ToastController, ActionSheetController } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { firstValueFrom, take } from 'rxjs';

import { AccountCalendar, CalendarEvent } from '../../../core/accounts/account.model';
import type { EventWriteOptions } from '../../../core/caldav/event.service';
import { CALENDAR_SOURCE, EventDraft } from '../../../core/calendar-source/calendar-source';
import { ConnectivityService } from '../../../core/connectivity/connectivity.service';
import { isOfflineWriteBlockedError } from '../../../core/connectivity/offline-write-blocked.error';
import { TranslationService } from '../../../core/i18n/translation.service';
import { toLocalDateTimeString } from '../../../utils/timezone.util';
import { AriaLabelDirective } from '../../../shared/directives/aria-label.directive';
import {
  allDayEnd,
  isSeriesOccurrence,
  resolveRecurrenceId,
  type SeriesEditScope,
} from '../series-scope.util';
import {
  Label,
  REPEAT_CHOICES,
  RepeatChoice,
  RepeatEnd,
  addableReminders,
  buildRule,
  parseRule,
  reminderLabel,
} from './event-details.helpers';

interface EventFormValue {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarId: string;
  description: string;
  tzid: string;
  location: string;
  repeat: RepeatChoice;
  repeatEnd: RepeatEnd['kind'];
  repeatUntil: string;
  repeatCount: number;
}

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
  private readonly source = inject(CALENDAR_SOURCE);
  private readonly translationService = inject(TranslationService);
  private readonly translate = inject(TranslateService);
  private readonly toastController = inject(ToastController);
  private readonly connectivity = inject(ConnectivityService);
  private readonly actionSheetController = inject(ActionSheetController);

  form!: FormGroup;
  isEdit = false;
  calendars: AccountCalendar[] = [];
  /** The edited event is in a calendar the user may only read. */
  readOnly = false;
  /** Location, repetition, reminders and moving to another calendar (Android). */
  readonly details = this.source.editsDetails;
  repeatChoices: readonly RepeatChoice[] = REPEAT_CHOICES;
  /** Reminders in minutes before the start. */
  reminders: number[] = [];

  get writesEnabled(): boolean {
    return (!this.source.writesNeedNetwork || this.connectivity.isOnline()) && !this.readOnly;
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
      location: [''],
      repeat: ['none' as RepeatChoice],
      repeatEnd: ['never' as RepeatEnd['kind']],
      repeatUntil: [toLocalDateTimeString(defaultStart)],
      repeatCount: [10, [Validators.min(1), Validators.max(999)]],
    });

    // Reminders of timed and all-day events count differently; a switch starts over
    this.form.get('allDay')?.valueChanges.subscribe(() => {
      this.reminders = [];
    });

    void this.loadData(id);
  }

  private async loadData(id: string | null): Promise<void> {
    let calendars = await firstValueFrom(this.source.calendars.pipe(take(1)));
    if (calendars.length === 0) {
      // Opened without the calendar screen before it (a link)
      await this.source.open();
      calendars = await firstValueFrom(this.source.calendars.pipe(take(1)));
    }

    if (id) {
      this.event = await this.source.getEvent(id);
    }

    // New events go to writable calendars; an existing one stays in its calendar
    const eventCalendarId = this.event?.calendarId;
    this.calendars = calendars.filter(
      (calendar) =>
        calendar.id === eventCalendarId || (calendar.enabled && !calendar.readOnly),
    );
    this.readOnly = calendars.some(
      (calendar) => calendar.id === eventCalendarId && calendar.readOnly,
    );
    // Moving needs a source that can; it is also the whole series
    if (this.isEdit && (!this.details || this.readOnly)) {
      this.form.get('calendarId')?.disable();
    }

    if (this.event) {
      const tzid = this.event.tzid;
      const repeat = parseRule(this.event.recurrence, this.event.start);
      if (repeat.choice === 'custom') {
        this.repeatChoices = [...REPEAT_CHOICES, 'custom'];
      }
      this.form.patchValue(
        {
          title: this.event.title,
          start: toLocalDateTimeString(this.event.start, tzid),
          end: toLocalDateTimeString(this.event.end, tzid),
          allDay: this.event.allDay,
          calendarId: this.event.calendarId,
          description: this.event.description ?? '',
          tzid: tzid ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          location: this.event.location ?? '',
          repeat: repeat.choice,
          repeatEnd: repeat.end.kind,
          ...(repeat.end.kind === 'until'
            ? { repeatUntil: toLocalDateTimeString(repeat.end.until) }
            : {}),
          ...(repeat.end.kind === 'count' ? { repeatCount: repeat.end.count } : {}),
        },
        { emitEvent: false },
      );
      // The model keeps seconds relative to the start, negative before it
      this.reminders = (this.event.reminders ?? []).map((seconds) => Math.round(-seconds / 60));
    } else {
      this.form.patchValue({ calendarId: this.calendars[0]?.id ?? '' });
    }
  }

  calendarColor(id: string): string {
    return this.calendars.find((calendar) => calendar.id === id)?.color ?? '#0082c9';
  }

  repeatLabel(choice: RepeatChoice): string {
    return `EVENT.REPEAT_${choice.toUpperCase()}`;
  }

  reminderLabel(minutes: number): Label {
    return reminderLabel(minutes, this.form.value.allDay === true);
  }

  addableReminders(): number[] {
    return addableReminders(this.reminders, this.form.value.allDay === true);
  }

  addReminder(event: CustomEvent): void {
    const minutes = event.detail.value as number | null;
    if (minutes !== null && minutes !== undefined && !this.reminders.includes(minutes)) {
      this.reminders = [...this.reminders, minutes].sort((a, b) => a - b);
    }
    const select = event.target as HTMLIonSelectElement | null;
    if (select) {
      select.value = null;
    }
  }

  removeReminder(minutes: number): void {
    this.reminders = this.reminders.filter((item) => item !== minutes);
  }

  /** A changed repetition or calendar of a date in a series concerns the whole series. */
  get changesWholeSeries(): boolean {
    if (!this.event || !isSeriesOccurrence(this.event)) {
      return false;
    }
    const value = this.form.getRawValue() as EventFormValue;
    return (
      value.calendarId !== this.event.calendarId ||
      this.ruleOf(value) !== (this.event.recurrence ?? null)
    );
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      return;
    }

    // The calendar of an edited event is a disabled control, which form.value leaves out
    const value = this.form.getRawValue() as EventFormValue;
    const calendar = this.calendars.find((item) => item.id === value.calendarId);
    if (!calendar) {
      await this.toast(this.translate.instant('ERRORS.CALENDAR_NOT_FOUND'), 'danger');
      return;
    }

    const start = new Date(value.start);
    const draft: EventDraft = {
      title: value.title.trim(),
      description: value.description,
      start,
      end: value.allDay ? allDayEnd(start, this.event) : new Date(value.end),
      allDay: value.allDay,
      tzid: value.tzid,
      calendarId: value.calendarId,
      location: value.location.trim(),
      rrule: this.ruleOf(value),
      reminders: this.reminders,
    };

    try {
      if (this.isEdit && this.event) {
        await this.saveExistingEvent(this.event, draft);
      } else {
        await this.source.createEvent(calendar, draft);
        await this.toast(this.translate.instant('EVENT.CREATED'), 'success');
      }
      this.navController.navigateBack('/tabs/calendar');
    } catch (error) {
      await this.handleEventActionError(error);
    }
  }

  private async saveExistingEvent(event: CalendarEvent, draft: EventDraft): Promise<void> {
    const scope = this.changesWholeSeries ? 'all' : await this.resolveSeriesScope('edit');
    if (!scope) {
      return;
    }
    const timeChanged =
      draft.allDay !== event.allDay ||
      draft.start.getTime() !== event.start.getTime() ||
      draft.end.getTime() !== event.end.getTime();
    const writeOptions: EventWriteOptions =
      scope === 'single'
        ? { scope, recurrenceId: resolveRecurrenceId(event) }
        : { scope, skipTimeUpdate: !timeChanged };
    await this.source.updateEvent(event, draft, writeOptions);
    await this.toast(this.translate.instant('EVENT.UPDATED'), 'success');
  }

  /** The rule to save: a rule the editor cannot show stays as it was, unless another is chosen. */
  private ruleOf(value: EventFormValue): string | null {
    if (!this.details) {
      return this.event?.recurrence ?? null;
    }
    if (value.repeat === 'custom') {
      return this.event?.recurrence ?? null;
    }
    // The day only: a date alone would be read as midnight UTC
    const [year, month, day] = value.repeatUntil.slice(0, 10).split('-').map(Number);
    const end: RepeatEnd =
      value.repeatEnd === 'until'
        ? { kind: 'until', until: new Date(year, month - 1, day) }
        : value.repeatEnd === 'count'
          ? { kind: 'count', count: Number(value.repeatCount) || 1 }
          : { kind: 'never' };
    return buildRule({ choice: value.repeat, end }, value.allDay);
  }

  private async handleEventActionError(error: unknown): Promise<void> {
    if (isOfflineWriteBlockedError(error)) {
      await this.toast(this.translate.instant('offline.WRITE_DISABLED'), 'warning');
      return;
    }
    if ((error as { code?: unknown } | null)?.code === 'READ_ONLY') {
      await this.toast(this.translate.instant('EVENT.READ_ONLY'), 'warning');
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
      await this.source.deleteEvent(this.event, writeOptions);
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
