// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActionSheetController, IonicModule, NavController, ViewWillEnter } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  combineLatest,
  map,
  Observable,
  Subject,
  takeUntil,
} from 'rxjs';

import { CalendarEvent, NextcloudAccount, Task } from '../../core/accounts/account.model';
import { AccountService } from '../../core/accounts/account.service';
import { CapabilitiesService } from '../../core/capabilities/capabilities.service';
import { CalendarService } from '../../core/caldav/calendar.service';
import { EventService } from '../../core/caldav/event.service';
import { SyncService, SyncStatus, dashboardEventRange } from '../../core/caldav/sync.service';
import { TaskListService } from '../../core/caldav/task-list.service';
import { TaskService } from '../../core/caldav/task.service';
import { AddressBookService } from '../../core/carddav/addressbook.service';
import { ContactService } from '../../core/carddav/contact.service';
import { BackgroundSyncService } from '../../core/dav/background-sync.service';
import { ConversationService } from '../../core/talk/conversation.service';
import { TalkSyncService, TalkSyncStatus } from '../../core/talk/talk-sync.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { SanctumSpinnerComponent } from '../../shared/components/sanctum-spinner/sanctum-spinner.component';
import { AriaLabelDirective } from '../../shared/directives/aria-label.directive';
import {
  DashboardBirthday,
  DashboardEvent,
  DashboardTask,
  formatEventDate as formatEventDateHelper,
  formatEventTime as formatEventTimeHelper,
  formatTaskDueDate as formatTaskDueDateHelper,
  getGreetingKey,
  mapDueTasks,
  mapUpcomingBirthdays,
  mapUpcomingEvents,
} from './dashboard.helpers';

export type { DashboardEvent, DashboardTask, DashboardBirthday };

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonicModule,
    TranslatePipe,
    PageHeaderComponent,
    SanctumSpinnerComponent,
    AriaLabelDirective,
  ],
})
export class DashboardPage implements OnInit, OnDestroy, ViewWillEnter {
  private readonly eventService = inject(EventService);
  private readonly taskService = inject(TaskService);
  private readonly taskListService = inject(TaskListService);
  private readonly calendarService = inject(CalendarService);
  private readonly contactService = inject(ContactService);
  private readonly addressBookService = inject(AddressBookService);
  private readonly accountService = inject(AccountService);
  private readonly capabilitiesService = inject(CapabilitiesService);
  private readonly syncService = inject(SyncService);
  private readonly backgroundSync = inject(BackgroundSyncService);
  private readonly conversationService = inject(ConversationService);
  private readonly talkSyncService = inject(TalkSyncService);
  private readonly navController = inject(NavController);
  private readonly actionSheet = inject(ActionSheetController);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly translate = inject(TranslateService);

  upcomingEvents$!: Observable<DashboardEvent[]>;
  dueTasks$!: Observable<DashboardTask[]>;
  birthdays$!: Observable<DashboardBirthday[]>;
  accounts$!: Observable<NextcloudAccount[]>;
  syncStatuses$!: Observable<Map<string, SyncStatus>>;
  totalUnreadTalk$!: Observable<number>;
  talkSyncStatuses$!: Observable<Map<string, TalkSyncStatus>>;

  isSyncing = false;
  isLoading = true;
  greeting = '';
  talkAvailable = false;
  talkChecked = false;
  notesAvailable = false;
  notesChecked = false;

  private readonly destroy$ = new Subject<void>();
  private colorByAccount = new Map<string, string>();

  ngOnInit(): void {
    this.backgroundSync.syncing.pipe(takeUntil(this.destroy$)).subscribe((syncing) => {
      this.isSyncing = syncing;
      this.cdr.markForCheck();
    });
    this.greeting = getGreetingKey();

    this.accountService.accounts.pipe(takeUntil(this.destroy$)).subscribe((accounts) => {
      this.colorByAccount = new Map(accounts.map((account) => [account.id, account.color]));
      this.cdr.markForCheck();
    });

    this.accountService.activeAccounts
      .pipe(takeUntil(this.destroy$))
      .subscribe((accounts) => {
        void this.refreshTalkAvailability(accounts);
        void this.refreshNotesAvailability(accounts);
      });

    const now = new Date();
    const week = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    this.upcomingEvents$ = combineLatest([
      this.eventService.getEventsForRange(now, week),
      this.calendarService.allCalendars,
    ]).pipe(map(([events, calendars]) => mapUpcomingEvents(events, calendars)));

    this.dueTasks$ = combineLatest([
      this.taskService.getOpenTasks(),
      this.taskListService.allTaskLists,
    ]).pipe(map(([tasks, lists]) => mapDueTasks(tasks, lists)));

    this.birthdays$ = this.contactService.allContacts.pipe(
      map((contacts) => {
        const entries = mapUpcomingBirthdays(contacts, 14);
        return entries.map((entry) => ({
          ...entry,
          accountColor: this.colorByAccount.get(entry.contact.accountId) ?? '#0082c9',
        }));
      }),
    );

    this.accounts$ = this.accountService.activeAccounts;
    this.syncStatuses$ = this.syncService.syncStatuses;
    this.talkSyncStatuses$ = this.talkSyncService.syncStatuses;
    this.totalUnreadTalk$ = this.conversationService.totalUnread;
  }

  ionViewWillEnter(): void {
    void this.loadViewData();
  }

  private async loadViewData(): Promise<void> {
    await this.loadFromCache();
    await this.conversationService.loadFromCache();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async refresh(event?: CustomEvent): Promise<void> {
    await this.loadFromCache();
    this.isSyncing = true;
    this.cdr.markForCheck();
    try {
      const range = dashboardEventRange();
      await this.syncService.syncAll({
        force: true,
        eventFrom: range.from,
        eventTo: range.to,
      });
      await this.talkSyncService.syncConversations({ force: true });
      await this.conversationService.loadFromCache();
    } finally {
      this.isSyncing = false;
      this.cdr.markForCheck();
      (event?.target as HTMLIonRefresherElement | undefined)?.complete();
    }
  }

  private async refreshTalkAvailability(accounts: NextcloudAccount[]): Promise<void> {
    if (accounts.length === 0) {
      this.talkAvailable = false;
      this.talkChecked = true;
      this.cdr.markForCheck();
      return;
    }

    this.talkChecked = false;
    this.cdr.markForCheck();

    await Promise.all(
      accounts.map((account) => this.capabilitiesService.ensureLoaded(account.id)),
    );
    this.talkAvailable = accounts.some((account) =>
      this.capabilitiesService.isAppAvailable(account.id, 'spreed'),
    );
    this.talkChecked = true;
    this.cdr.markForCheck();
  }

  private async refreshNotesAvailability(accounts: NextcloudAccount[]): Promise<void> {
    if (accounts.length === 0) {
      this.notesAvailable = false;
      this.notesChecked = true;
      this.cdr.markForCheck();
      return;
    }

    this.notesChecked = false;
    this.cdr.markForCheck();

    await Promise.all(
      accounts.map((account) => this.capabilitiesService.ensureLoaded(account.id)),
    );
    this.notesAvailable = accounts.some((account) =>
      this.capabilitiesService.isAppAvailable(account.id, 'notes'),
    );
    this.notesChecked = true;
    this.cdr.markForCheck();
  }

  private async loadFromCache(): Promise<void> {
    await Promise.all([
      this.calendarService.loadFromCache(),
      this.taskService.loadFromCache(),
      this.addressBookService.loadFromCache(),
      this.contactService.loadFromCache(),
    ]);
    const now = new Date();
    const week = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    await this.eventService.loadFromCache(now, week);
    this.isLoading = false;
    this.cdr.markForCheck();
  }

  // Hub-and-spoke: every module is pushed forward from Home so it gets a back
  // button + native swipe-back gesture (navigateForward enforces the push even
  // for the former tab routes /tabs/calendar, /tabs/files, /tabs/talk).
  goToCalendar(): void {
    void this.navController.navigateForward('/tabs/calendar');
  }

  goToTasks(): void {
    void this.navController.navigateForward('/tasks');
  }

  goToContacts(): void {
    void this.navController.navigateForward('/contacts');
  }

  goToFiles(): void {
    void this.navController.navigateForward('/tabs/files');
  }

  goToTalk(): void {
    void this.navController.navigateForward('/tabs/talk');
  }

  goToNotes(): void {
    void this.navController.navigateForward('/notes');
  }

  async quickCreate(): Promise<void> {
    const sheet = await this.actionSheet.create({
      header: this.translate.instant('QUICK_CREATE.TITLE'),
      buttons: [
        {
          text: this.translate.instant('QUICK_CREATE.EVENT'),
          handler: () => {
            void this.navController.navigateForward('/tabs/calendar', {
              queryParams: { create: 1 },
            });
          },
        },
        {
          text: this.translate.instant('QUICK_CREATE.TASK'),
          handler: () => {
            void this.navController.navigateForward('/tasks', {
              queryParams: { create: 1 },
            });
          },
        },
        {
          text: this.translate.instant('QUICK_CREATE.NOTE'),
          handler: () => {
            void this.navController.navigateForward('/notes/new');
          },
        },
        {
          text: this.translate.instant('APP.CANCEL'),
          role: 'cancel',
        },
      ],
    });
    await sheet.present();
  }

  formatEventTime(event: CalendarEvent): string {
    return formatEventTimeHelper(event);
  }

  formatEventDate(event: CalendarEvent): string {
    return formatEventDateHelper(event, {
      today: this.translate.instant('CALENDAR.TODAY'),
      tomorrow: this.translate.instant('DASHBOARD.TOMORROW'),
    });
  }

  formatTaskDue(task: Task): string {
    return formatTaskDueDateHelper(task, {
      today: this.translate.instant('CALENDAR.TODAY'),
      tomorrow: this.translate.instant('DASHBOARD.TOMORROW'),
    });
  }

  formatSyncTime(date: Date | null): string {
    if (!date) {
      return this.translate.instant('DASHBOARD.SYNC_NEVER');
    }
    return date.toLocaleString([], {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
