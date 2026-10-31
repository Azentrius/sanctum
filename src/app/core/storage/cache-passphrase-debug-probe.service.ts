// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { environment } from '../../../environments/environment';
import {
  CACHE_SQLCIPHER_VERIFY_PROBE_FILE,
  DEBUG_WRITE_SQLCIPHER_VERIFY_PROBE_PREF_KEY,
} from './storage.constants';

/**
 * Debug-only (#24): writes the cache passphrase to app-private storage so
 * `scripts/verify-sqlcipher-cache.ps1 -PositiveTest` can read it via `run-as`.
 * Never active in production builds, and only when a developer explicitly opts
 * in via the `debug:writeSqlcipherVerifyProbe` pref: the opt-in is consumed
 * after a single write so the secret is not re-written on every launch.
 */
@Injectable({ providedIn: 'root' })
export class CachePassphraseDebugProbeService {
  async writeProbeOnce(passphrase: string): Promise<void> {
    if (environment.production || !Capacitor.isNativePlatform()) {
      return;
    }
    const { value } = await Preferences.get({
      key: DEBUG_WRITE_SQLCIPHER_VERIFY_PROBE_PREF_KEY,
    });
    if (value !== 'true') {
      return;
    }
    const { Directory, Encoding, Filesystem } = await import('@capacitor/filesystem');
    await Filesystem.writeFile({
      path: CACHE_SQLCIPHER_VERIFY_PROBE_FILE,
      data: passphrase,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    await Preferences.remove({ key: DEBUG_WRITE_SQLCIPHER_VERIFY_PROBE_PREF_KEY });
  }

  async removeProbe(): Promise<void> {
    if (environment.production || !Capacitor.isNativePlatform()) {
      return;
    }
    try {
      const { Directory, Filesystem } = await import('@capacitor/filesystem');
      await Filesystem.deleteFile({
        path: CACHE_SQLCIPHER_VERIFY_PROBE_FILE,
        directory: Directory.Data,
      });
    } catch {
      // Probe may not exist.
    }
  }
}
