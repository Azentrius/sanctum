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
import {
  IonicModule,
  ActionSheetController,
  AlertController,
  ToastController,
  ViewWillEnter,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, firstValueFrom, take, takeUntil } from 'rxjs';

import { NextcloudAccount } from '../../core/accounts/account.model';
import { AccountService } from '../../core/accounts/account.service';
import { ConnectivityService } from '../../core/connectivity/connectivity.service';
import { OfflineReadFacade } from '../../core/connectivity/offline-read.facade';
import { isOfflineWriteBlockedError } from '../../core/connectivity/offline-write-blocked.error';
import { isDavWriteError } from '../../core/http/dav-write.error';
import type { FileItem } from '../../core/webdav/file.model';
import { FileService } from '../../core/webdav/file.service';
import { PreviewTooLargeError } from '../../core/webdav/file-preview.limits';
import {
  FileTransferService,
  NoOpenerError,
} from '../../core/webdav/file-transfer.service';
import { Breadcrumb, buildBreadcrumb } from '../../core/webdav/webdav.path.util';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { OfflineBannerComponent } from '../../shared/components/offline-banner/offline-banner.component';
import { SanctumVirtualListComponent } from '../../shared/components/sanctum-virtual-list/sanctum-virtual-list.component';
import { SanctumSpinnerComponent } from '../../shared/components/sanctum-spinner/sanctum-spinner.component';
import { AriaLabelDirective } from '../../shared/directives/aria-label.directive';
import { resolveOfflineBanner } from '../../shared/offline/offline-banner.helpers';
import { FileRenderComponent } from './file-render.component';
import { PreviewKind, fileIcon, formatFileSize, previewKind } from './files.helpers';

@Component({
  selector: 'app-files',
  templateUrl: './files.page.html',
  styleUrls: ['./files.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonicModule,
    TranslatePipe,
    PageHeaderComponent,
    SanctumSpinnerComponent,
    OfflineBannerComponent,
    AriaLabelDirective,
    FileRenderComponent,
    SanctumVirtualListComponent,
  ],
})
export class FilesPage implements OnInit, OnDestroy, ViewWillEnter {
  accounts: NextcloudAccount[] = [];
  account: NextcloudAccount | null = null;
  path = '/';
  items: FileItem[] = [];
  crumbs: Breadcrumb[] = [];
  isLoading = false;
  error: string | null = null;
  offlineBannerVisible = false;
  offlineBannerMessage = '';

  // In-app preview (image/text) modal state.
  previewItem: FileItem | null = null;
  previewKind: PreviewKind = 'none';
  previewText = '';
  previewImageUrl = '';
  previewBytes: Uint8Array | null = null;
  previewLoading = false;
  previewError: string | null = null;

  @ViewChild('crumbBar', { read: ElementRef })
  private readonly crumbsRef?: ElementRef<HTMLElement>;

  private readonly destroy$ = new Subject<void>();
  private readonly accountService = inject(AccountService);
  private readonly fileService = inject(FileService);
  private readonly fileTransfer = inject(FileTransferService);
  private readonly alertController = inject(AlertController);
  private readonly actionSheetController = inject(ActionSheetController);
  private readonly toastController = inject(ToastController);
  private readonly translate = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly connectivity = inject(ConnectivityService);
  private readonly offlineRead = inject(OfflineReadFacade);

  /** True when more than one account exists and none is entered yet. */
  get isPicker(): boolean {
    return this.account === null && this.accounts.length > 1;
  }

  get writesEnabled(): boolean {
    return this.connectivity.isOnline();
  }

  /** Narrowed kind for the byte-rendering component (pdf/docx/xlsx). */
  get renderKind(): 'pdf' | 'docx' | 'xlsx' {
    return this.previewKind as 'pdf' | 'docx' | 'xlsx';
  }

  ngOnInit(): void {
    this.fileService.items.pipe(takeUntil(this.destroy$)).subscribe((items) => {
      this.items = items;
      this.cdr.markForCheck();
    });

    if (globalThis.window !== undefined) {
      globalThis.window.addEventListener('online', () => void this.refreshOfflineBanner());
      globalThis.window.addEventListener('offline', () => void this.refreshOfflineBanner());
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ionViewWillEnter(): void {
    void this.init().then(async () => {
      const pathParam = this.route.snapshot.queryParamMap.get('path');
      if (pathParam) {
        this.path = pathParam.startsWith('/') ? pathParam : `/${pathParam}`;
        if (this.account) {
          await this.showDirectory();
          void this.refreshDirectory();
        }
      }

      if (this.route.snapshot.queryParamMap.get('create') === '1') {
        void this.openAddMenu();
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { create: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    });
  }

  async init(): Promise<void> {
    this.accounts = await firstValueFrom(
      this.accountService.activeAccounts.pipe(take(1)),
    );

    if (this.accounts.length === 0) {
      this.account = null;
      this.fileService.clear();
      return;
    }

    if (this.accounts.length === 1) {
      this.account = this.accounts[0];
      this.path = '/';
      await this.showDirectory();
      void this.refreshDirectory();
    } else if (this.account) {
      await this.showDirectory();
      void this.refreshDirectory();
    } else {
      // Show the account picker; defer file loading until one is chosen.
      this.fileService.clear();
    }
  }

  openAccount(account: NextcloudAccount): void {
    this.account = account;
    this.path = '/';
    void this.showDirectory().then(() => this.refreshDirectory());
  }

  backToAccounts(): void {
    this.account = null;
    this.path = '/';
    this.crumbs = [];
    this.fileService.clear();
  }

  openItem(item: FileItem): void {
    if (item.isDirectory) {
      this.path = item.path;
      void this.showDirectory().then(() => this.refreshDirectory());
      return;
    }

    const kind = previewKind(item);
    if (kind === 'none') {
      void this.openWith(item);
    } else {
      void this.openPreview(item, kind);
    }
  }

  async openWith(item: FileItem): Promise<void> {
    if (!this.account) {
      return;
    }
    try {
      await this.fileTransfer.openWith(this.account.id, item);
    } catch (error) {
      const key =
        error instanceof NoOpenerError ? 'FILES.NO_APP' : 'FILES.OPEN_FAILED';
      await this.showToast(this.translate.instant(key));
    }
  }

  async saveFile(item: FileItem): Promise<void> {
    if (!this.account) {
      return;
    }
    try {
      await this.fileTransfer.saveToDevice(this.account.id, item);
      await this.showToast(this.translate.instant('FILES.SAVED'));
    } catch {
      await this.showToast(this.translate.instant('FILES.ACTION_FAILED'));
    }
  }

  async openPreview(item: FileItem, kind: PreviewKind): Promise<void> {
    if (!this.account) {
      return;
    }
    this.previewItem = item;
    this.previewKind = kind;
    this.previewText = '';
    this.previewImageUrl = '';
    this.previewBytes = null;
    this.previewError = null;
    this.previewLoading = true;
    this.cdr.markForCheck();

    try {
      if (kind === 'image') {
        this.previewImageUrl = await this.fileTransfer.readImageDataUrl(
          this.account.id,
          item,
        );
      } else if (kind === 'text') {
        this.previewText = await this.fileTransfer.readText(this.account.id, item);
      } else {
        // pdf / docx / xlsx are rendered from raw bytes by FileRenderComponent.
        this.previewBytes = await this.fileTransfer.readBytes(this.account.id, item);
      }
    } catch (error) {
      this.previewError =
        error instanceof PreviewTooLargeError
          ? this.translate.instant('FILES.PREVIEW_TOO_LARGE')
          : this.translate.instant('FILES.PREVIEW_FAILED');
    } finally {
      this.previewLoading = false;
      this.cdr.markForCheck();
    }
  }

  closePreview(): void {
    this.previewItem = null;
    this.previewKind = 'none';
    this.previewText = '';
    this.previewImageUrl = '';
    this.previewBytes = null;
    this.previewError = null;
  }

  navigateTo(path: string): void {
    this.path = path;
    void this.showDirectory().then(() => this.refreshDirectory());
  }

  async doRefresh(event: CustomEvent): Promise<void> {
    try {
      await this.refreshDirectory(true);
    } finally {
      (event.target as HTMLIonRefresherElement).complete();
    }
  }

  async openAddMenu(): Promise<void> {
    if (!this.account) {
      return;
    }
    if (!this.writesEnabled) {
      await this.showToast(this.translate.instant('offline.WRITE_DISABLED'));
      return;
    }
    const sheet = await this.actionSheetController.create({
      buttons: [
        {
          text: this.translate.instant('FILES.UPLOAD'),
          icon: 'cloud-upload-outline',
          handler: () => {
            void this.uploadFiles();
          },
        },
        {
          text: this.translate.instant('FILES.NEW_FOLDER'),
          icon: 'folder-outline',
          handler: () => {
            void this.newFolder();
          },
        },
        { text: this.translate.instant('APP.CANCEL'), role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  async uploadFiles(): Promise<void> {
    if (!this.account) {
      return;
    }
    try {
      const count = await this.fileTransfer.uploadFiles(this.account.id, this.path);
      if (count > 0) {
        await this.loadDirectory();
        await this.showToast(
          this.translate.instant('FILES.UPLOADED', { count }),
        );
      }
    } catch (error) {
      await this.showToast(this.writeErrorMessage(error, 'FILES.UPLOAD_FAILED'));
    }
  }

  async newFolder(): Promise<void> {
    if (!this.account) {
      return;
    }
    const alert = await this.alertController.create({
      header: this.translate.instant('FILES.NEW_FOLDER'),
      inputs: [
        {
          name: 'name',
          type: 'text',
          placeholder: this.translate.instant('FILES.FOLDER_NAME'),
        },
      ],
      buttons: [
        { text: this.translate.instant('APP.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('APP.SAVE'),
          handler: (data) => {
            void this.createFolder(data?.name);
          },
        },
      ],
    });
    await alert.present();
  }

  async openItemActions(item: FileItem, event: Event): Promise<void> {
    event.stopPropagation();

    const fileButtons = item.isDirectory
      ? []
      : [
          {
            text: this.translate.instant('FILES.OPEN_WITH'),
            icon: 'open-outline',
            handler: () => {
              void this.openWith(item);
            },
          },
          {
            text: this.translate.instant('FILES.DOWNLOAD'),
            icon: 'download-outline',
            handler: () => {
              void this.saveFile(item);
            },
          },
        ];

    const sheet = await this.actionSheetController.create({
      header: item.name,
      buttons: [
        ...fileButtons,
        {
          text: this.translate.instant('FILES.RENAME'),
          icon: 'create-outline',
          handler: () => {
            void this.promptRename(item);
          },
        },
        {
          text: this.translate.instant('APP.DELETE'),
          icon: 'trash-outline',
          role: 'destructive',
          handler: () => {
            void this.confirmDelete(item);
          },
        },
        { text: this.translate.instant('APP.CANCEL'), role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  iconFor(item: FileItem): string {
    return fileIcon(item);
  }

  sizeFor(item: FileItem): string {
    return formatFileSize(item.size);
  }

  trackByItem(_index: number, item: FileItem): string {
    return item.id;
  }

  /** Loads the cached listing for the current path (instant UI). */
  private async showDirectory(): Promise<void> {
    if (!this.account) {
      return;
    }
    await this.fileService.loadFromCache(this.account.id, this.path);
    this.crumbs = buildBreadcrumb(this.path);
    await this.refreshOfflineBanner();
    this.cdr.markForCheck();
    this.scrollCrumbsToEnd();
  }

  /** Fetches from the server when stale or forced (pull-to-refresh, mutations). */
  private async refreshDirectory(force = false): Promise<void> {
    if (!this.account) {
      return;
    }
    if (!force && !(await this.fileService.isListingStale(this.account.id, this.path))) {
      return;
    }

    this.isLoading = true;
    this.error = null;
    this.cdr.markForCheck();
    try {
      await this.fileService.refreshDirectoryIfStale(
        this.account.id,
        this.path,
        force,
      );
    } catch (error) {
      this.error =
        error instanceof Error
          ? error.message
          : this.translate.instant('FILES.LOAD_FAILED');
    } finally {
      this.crumbs = buildBreadcrumb(this.path);
      this.isLoading = false;
      this.cdr.markForCheck();
      this.scrollCrumbsToEnd();
    }
  }

  private async loadDirectory(): Promise<void> {
    await this.showDirectory();
    await this.refreshDirectory(true);
  }

  /** Keeps the current folder (last crumb) visible in the one-line breadcrumb. */
  private scrollCrumbsToEnd(): void {
    setTimeout(() => {
      const el = this.crumbsRef?.nativeElement;
      if (el) {
        el.scrollLeft = el.scrollWidth;
      }
    }, 50);
  }

  private async createFolder(name: string | undefined): Promise<void> {
    const trimmed = name?.trim();
    if (!this.account || !trimmed) {
      return;
    }
    try {
      await this.fileService.createFolder(this.account.id, this.path, trimmed);
      await this.loadDirectory();
      await this.showToast(this.translate.instant('FILES.CREATED'));
    } catch (error) {
      await this.showToast(this.writeErrorMessage(error, 'FILES.ACTION_FAILED'));
    }
  }

  private async promptRename(item: FileItem): Promise<void> {
    const alert = await this.alertController.create({
      header: this.translate.instant('FILES.RENAME'),
      inputs: [{ name: 'name', type: 'text', value: item.name }],
      buttons: [
        { text: this.translate.instant('APP.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('APP.SAVE'),
          handler: (data) => {
            void this.renameItem(item, data?.name);
          },
        },
      ],
    });
    await alert.present();
  }

  private async renameItem(
    item: FileItem,
    name: string | undefined,
  ): Promise<void> {
    const trimmed = name?.trim();
    if (!this.account || !trimmed || trimmed === item.name) {
      return;
    }
    try {
      await this.fileService.rename(this.account.id, item, trimmed);
      await this.loadDirectory();
      await this.showToast(this.translate.instant('FILES.RENAMED'));
    } catch (error) {
      await this.showToast(this.writeErrorMessage(error, 'FILES.ACTION_FAILED'));
    }
  }

  private async confirmDelete(item: FileItem): Promise<void> {
    const alert = await this.alertController.create({
      header: this.translate.instant('FILES.DELETE_CONFIRM_TITLE'),
      message: this.translate.instant('FILES.DELETE_CONFIRM_MESSAGE', {
        name: item.name,
      }),
      buttons: [
        { text: this.translate.instant('APP.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('APP.DELETE'),
          role: 'destructive',
          handler: () => {
            void this.deleteItem(item);
          },
        },
      ],
    });
    await alert.present();
  }

  private async deleteItem(item: FileItem): Promise<void> {
    if (!this.account) {
      return;
    }
    try {
      await this.fileService.deleteItem(this.account.id, item);
      await this.showToast(this.translate.instant('FILES.DELETED'));
    } catch (error) {
      await this.showToast(this.writeErrorMessage(error, 'FILES.ACTION_FAILED'));
    }
  }

  /**
   * Server rejections (DavWriteError) carry a specific, user-facing reason such
   * as missing permission or a locked file; everything else gets the generic key.
   */
  private writeErrorMessage(error: unknown, fallbackKey: string): string {
    if (isOfflineWriteBlockedError(error)) {
      return this.translate.instant('offline.WRITE_DISABLED');
    }
    if (isDavWriteError(error)) {
      return error.message;
    }
    return this.translate.instant(fallbackKey);
  }

  private async refreshOfflineBanner(): Promise<void> {
    if (!this.account) {
      this.offlineBannerVisible = false;
      this.offlineBannerMessage = '';
      return;
    }
    const banner = await resolveOfflineBanner(
      this.offlineRead,
      'files',
      [this.account.id],
      this.path,
    );
    this.offlineBannerVisible = banner.visible;
    this.offlineBannerMessage = banner.message;
    this.cdr.markForCheck();
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 2500,
      position: 'bottom',
    });
    await toast.present();
  }
}
