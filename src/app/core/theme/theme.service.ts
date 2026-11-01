// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, computed, effect, signal, inject } from '@angular/core';
import { Storage } from '@ionic/storage-angular';

import { EncryptedCacheStorageService } from '../storage/encrypted-cache-storage.service';
import { StorageUnavailableService } from '../storage/storage-unavailable.service';

export type ThemePreference = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'sanctum.theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storage = inject(Storage);
  private readonly encryptedCache = inject(EncryptedCacheStorageService);
  private readonly storageUnavailable = inject(StorageUnavailableService);

  private readonly _preference = signal<ThemePreference>('system');
  /** Vom Nutzer gewählte Einstellung: light | dark | system */
  readonly preference = this._preference.asReadonly();

  private readonly mql = globalThis.matchMedia('(prefers-color-scheme: dark)');
  private readonly _systemDark = signal<boolean>(this.mql.matches);

  /** Das tatsächlich angezeigte Theme. */
  readonly effectiveTheme = computed<'light' | 'dark'>(() => {
    const pref = this._preference();
    if (pref === 'system') return this._systemDark() ? 'dark' : 'light';
    return pref;
  });

  private storageReady?: Promise<unknown>;

  constructor() {
    this.mql.addEventListener('change', (e) => this._systemDark.set(e.matches));
    // Reacts to the setting AND to a change of the system theme:
    effect(() => {
      const pref = this._preference();
      this._systemDark(); // Abhängigkeit registrieren
      this.applyClass(pref);
      void this.syncStatusBar();
    });
  }

  /** Einmalig beim App-Start aufrufen (siehe Schritt 8). */
  async init(): Promise<void> {
    if (this.storageUnavailable.isUnavailable()) {
      return;
    }
    await this.encryptedCache.ensureReady();
    this.storageReady ??= Promise.resolve();
    await this.storageReady;
    const saved = (await this.storage.get(
      STORAGE_KEY
    )) as ThemePreference | null;
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      this._preference.set(saved);
    }
    // Mirror into localStorage so the anti-flash script is right at the next start
    try {
      localStorage.setItem(STORAGE_KEY, this._preference());
    } catch {}
  }

  async setPreference(pref: ThemePreference): Promise<void> {
    this._preference.set(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {}
    await this.encryptedCache.ensureReady();
    await this.storage.set(STORAGE_KEY, pref);
  }

  private applyClass(pref: ThemePreference): void {
    const body = document.body;
    body.classList.remove('theme-light', 'theme-dark');
    if (pref === 'light') body.classList.add('theme-light');
    else if (pref === 'dark') body.classList.add('theme-dark');
    // 'system' -> keine Klasse, Media-Query in variables.scss entscheidet
  }

  /** Optional: nur aktiv, wenn @capacitor/status-bar installiert & nativ. */
  private async syncStatusBar(): Promise<void> {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor?.isNativePlatform?.()) return;
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      const dark = this.effectiveTheme() === 'dark';

      // Reserve the status-bar area so it no longer overlays the app header
      // (Android does not populate env(safe-area-inset-top) reliably here).
      await StatusBar.setOverlaysWebView({ overlay: false });
      await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
      // bg-page of the Azentrius themes, so the status bar sits on the page colour.
      await StatusBar.setBackgroundColor({ color: dark ? '#0A0A0F' : '#F2F1EE' });
    } catch {
      /* status bar plugin not installed: ignore */
    }
  }
}
