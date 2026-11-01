// SPDX-License-Identifier: GPL-3.0-or-later
import { Preferences } from '@capacitor/preferences';
import { provideHttpClient } from '@angular/common/http';
import {
  ApplicationConfig,
  ErrorHandler,
  importProvidersFrom,
  inject,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { PreloadAllModules, provideRouter, RouteReuseStrategy, Router, withPreloading } from '@angular/router';
import { createErrorHandler, TraceService } from '@sentry/angular';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';
import { IonicStorageModule } from '@ionic/storage-angular';
import { Drivers } from '@ionic/storage';

import { appRoutes } from './app.routes';
import { AccountService } from './core/accounts/account.service';
import { AppPasswordRevocationService } from './core/auth/app-password-revocation.service';
import { BiometricService } from './core/auth/biometric.service';
import { PrivacyScreenService } from './core/privacy/privacy-screen.service';
import { SyncService } from './core/caldav/sync.service';
import { TranslationService } from './core/i18n/translation.service';
import { EncryptedCacheStorageService } from './core/storage/encrypted-cache-storage.service';
import { CacheBenchmarkService } from './core/storage/cache-benchmark.service';
import { MaestroCacheSeedService } from './core/storage/maestro-cache-seed.service';
import { CacheUnavailableError } from './core/storage/cache-unavailable.error';
import { StorageUnavailableService } from './core/storage/storage-unavailable.service';
import { SecureStateInvalidatedError } from './core/security/secure-state-invalidated.error';
import { SecureStateRecoveryFacade } from './core/security/secure-state-recovery.facade';
import { SecureStateRecoveryService } from './core/security/secure-state-recovery.service';
import type { SecureStateRecoveryReason } from './core/security/secure-state-recovery.reason';
import {
  DEBUG_FORCE_SECURE_STATE_RECOVERY_PREF_KEY,
  SANCTUM_CACHE_DB_NAME,
  SANCTUM_SQLITE_DRIVER,
} from './core/storage/storage.constants';
import { CapabilitiesService } from './core/capabilities/capabilities.service';
import { LocalDbService } from './core/storage/local-db.service';
import { environment } from '../environments/environment';

export async function initializeApp(): Promise<void> {
  // All inject() calls must run synchronously, before the first await: the
  // injection context is lost once the function suspends.
  const encryptedCache = inject(EncryptedCacheStorageService);
  const storageUnavailable = inject(StorageUnavailableService);
  const maestroSeed = inject(MaestroCacheSeedService);
  const cacheBenchmark = inject(CacheBenchmarkService);
  const localDb = inject(LocalDbService);
  const accountService = inject(AccountService);
  const syncService = inject(SyncService);
  const appPasswordRevocation = inject(AppPasswordRevocationService);
  const translationService = inject(TranslationService);
  const biometricService = inject(BiometricService);
  const privacyScreenService = inject(PrivacyScreenService);
  const capabilitiesService = inject(CapabilitiesService);
  const secureStateRecovery = inject(SecureStateRecoveryFacade);
  const secureStateRecoveryService = inject(SecureStateRecoveryService);

  const keystoreHealthy = await secureStateRecovery.probeKeystoreAtStartup();
  if (!keystoreHealthy || secureStateRecoveryService.isRecoveryRequired()) {
    return;
  }

  if (!environment.production) {
    const { value } = await Preferences.get({
      key: DEBUG_FORCE_SECURE_STATE_RECOVERY_PREF_KEY,
    });
    if (value) {
      secureStateRecoveryService.setRecoveryRequired(
        value as SecureStateRecoveryReason,
      );
      await Preferences.remove({ key: DEBUG_FORCE_SECURE_STATE_RECOVERY_PREF_KEY });
      return;
    }
  }

  try {
    await localDb.init();
    await accountService.init();
    await capabilitiesService.init();
    await maestroSeed.seedIfRequested();
    await encryptedCache.completeMigrationIfNeeded(accountService, syncService);
    await cacheBenchmark.runIfRequested();
    await appPasswordRevocation.retryPending();
    await translationService.init();
    await biometricService.onAppStart();
    await privacyScreenService.init();
  } catch (error) {
    if (error instanceof SecureStateInvalidatedError) {
      secureStateRecoveryService.setRecoveryRequired(error.reason);
      return;
    }
    if (error instanceof CacheUnavailableError) {
      storageUnavailable.setUnavailable(error);
      secureStateRecoveryService.setRecoveryRequired('db-corrupted');
      return;
    }
    throw error;
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection(),
    importProvidersFrom(
      // No ripple: pressed surfaces change colour instead (design system, "Zustände").
      IonicModule.forRoot({ rippleEffect: false }),
      IonicStorageModule.forRoot({
        name: SANCTUM_CACHE_DB_NAME,
        version: 1,
        // Custom driver is registered only on native; web falls through to IndexedDB.
        driverOrder: [
          SANCTUM_SQLITE_DRIVER,
          Drivers.IndexedDB,
          Drivers.LocalStorage,
        ],
      }),
    ),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideRouter(appRoutes, withPreloading(PreloadAllModules)),
    provideHttpClient(),
    provideTranslateService({
      fallbackLang: 'de',
      loader: provideTranslateHttpLoader({
        prefix: './assets/i18n/',
        suffix: '.json',
      }),
    }),
    provideAppInitializer(initializeApp),
    { provide: ErrorHandler, useValue: createErrorHandler() },
    { provide: TraceService, deps: [Router] },
    // Force eager TraceService construction so Sentry router tracing is wired up.
    provideAppInitializer(() => {
      inject(TraceService);
    }),
  ],
};
