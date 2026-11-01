// SPDX-License-Identifier: GPL-3.0-or-later
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import { Injectable, Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { firstValueFrom, take } from 'rxjs';

import { nativeHttpRequest } from '../http/native-http.util';
import { normalizeNativeHttpBody } from '../http/ocs-response.util';
import { trimTrailingSlashes } from '../string/string.util';
import { NextcloudAccount } from '../accounts/account.model';
import { AccountService } from '../accounts/account.service';
import { DavClientService } from '../dav/dav-client.service';
import { NativeSyncAccountsService } from '../native-sync/native-sync-accounts.service';
import { AppPasswordRevocationService } from './app-password-revocation.service';
import { PushService } from '../push/push.service';
import { assertLoginFlowOrigins } from './auth-url.util';
import { normalizeServerUrl } from './server-url.util';
import { TokenService } from './token.service';
import { CertPinService } from '../security/cert-pin.service';
import {
  LoginFlowInitResponse,
  LoginFlowPollResponse,
  NextcloudCredentials,
} from './auth.model';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 300_000;

/** Base name Nextcloud shows on the grant page / app-password list. */
const APP_USER_AGENT = 'Sanctum - Nextcloud Superapp';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly accountService = inject(AccountService);
  private readonly tokenService = inject(TokenService);
  private readonly certPinService = inject(CertPinService);
  private readonly pushService = inject(PushService);
  private readonly nativeSync = inject(NativeSyncAccountsService);
  private readonly router = inject(Router);
  // Resolved lazily: DavClientService and AppPasswordRevocationService depend on services that
  // depend on AuthService, so injecting them as fields would be a DI cycle.
  private readonly injector = inject(Injector);

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  async hasAccounts(): Promise<boolean> {
    const count = await firstValueFrom(
      this.accountService.accountCount.pipe(take(1))
    );
    return count > 0;
  }

  async startLogin(serverUrl: string): Promise<void> {
    const base = this.normalizeServerUrl(serverUrl);

    const init = Capacitor.isNativePlatform()
      ? await this.postNative<LoginFlowInitResponse>(
          this.getLoginV2Url(base),
          '',
          {
            'Content-Type': 'application/json',
            // Nextcloud derives the grant-page / app-password name from the
            // User-Agent of this init POST. Without it, Android falls back to
            // the default "Dalvik/2.1.0 (…)" string.
            'User-Agent': await this.buildUserAgent(),
          }
        )
      : await firstValueFrom(
          this.http.post<LoginFlowInitResponse>(
            this.getLoginV2Url(base),
            {},
            { headers: this.getProxyHeaders(base) }
          )
        );

    if (!init?.login || !init.poll?.endpoint || !init.poll?.token) {
      throw new Error('Login Flow v2: ungültige Antwort vom Server.');
    }

    assertLoginFlowOrigins(base, init.login, init.poll.endpoint);

    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url: init.login });
    } else {
      window.open(init.login, '_blank', 'noopener,noreferrer');
    }

    const credentials = await this.pollForCredentials(
      base,
      init.poll.endpoint,
      init.poll.token
    );

    try {
      await Browser.close();
    } catch {
      // Browser may not be open on web
    }

    await this.persistAccount(credentials);
  }

  async getValidToken(accountId: string): Promise<string> {
    const token = await this.tokenService.getPassword(accountId);
    if (!token) {
      throw new Error('Kein App-Passwort vorhanden. Bitte erneut anmelden.');
    }
    return token;
  }

  /**
   * The server rejected the account's app password (HTTP 401). The account and its data stay;
   * it is marked so the user can sign in again, which replaces the app password.
   */
  async markNeedsReauth(accountId: string): Promise<void> {
    await this.accountService.updateAccount(accountId, { needsReauth: true });
  }

  async logout(accountId: string): Promise<void> {
    this.stopPolling();
    await this.accountService.removeAccount(accountId);

    const count = await firstValueFrom(
      this.accountService.accountCount.pipe(take(1))
    );
    if (count === 0) {
      await this.router.navigate(['/login'], { replaceUrl: true });
    }
  }

  async logoutAll(): Promise<void> {
    this.stopPolling();
    const accounts = await firstValueFrom(
      this.accountService.accounts.pipe(take(1))
    );
    for (const account of accounts) {
      await this.accountService.removeAccount(account.id);
    }
    await this.router.navigate(['/login'], { replaceUrl: true });
  }

  private async persistAccount(
    credentials: NextcloudCredentials
  ): Promise<void> {
    const serverUrl = trimTrailingSlashes(credentials.serverUrl);
    const existing = this.accountService.findAccount(serverUrl, credentials.loginName);
    if (existing) {
      await this.replaceAppPassword(existing, credentials.appPassword);
      return;
    }

    const account = await this.accountService.addAccount({
      serverUrl,
      username: credentials.loginName,
      displayName: credentials.loginName,
      isActive: true,
      color: '',
    });

    await this.tokenService.setPassword(account.id, credentials.appPassword);
    await this.certPinService.establishTofuPin(account.id, serverUrl);
    await this.nativeSync.register(account, credentials.appPassword);
    void this.pushService.registerForAllAccounts();
  }

  /**
   * Signing in again to an account that exists already: keeps the account and its data and
   * swaps the app password. The previous app password is revoked on the server unless the
   * server rejected it already.
   */
  private async replaceAppPassword(
    account: NextcloudAccount,
    appPassword: string,
  ): Promise<void> {
    if (!account.needsReauth) {
      await this.injector.get(AppPasswordRevocationService).revokeForAccount(account.id);
    }
    await this.tokenService.setPassword(account.id, appPassword);
    this.injector.get(DavClientService).invalidateClient(account.id);
    await this.accountService.updateAccount(account.id, { needsReauth: false });
    await this.nativeSync.register(account, appPassword);
  }

  private pollForCredentials(
    serverUrl: string,
    endpoint: string,
    token: string
  ): Promise<NextcloudCredentials> {
    return new Promise((resolve, reject) => {
      const started = Date.now();

      this.pollTimer = setInterval(() => {
        void (async () => {
          if (Date.now() - started > POLL_TIMEOUT_MS) {
            this.stopPolling();
            reject(new Error('Login-Timeout. Bitte erneut versuchen.'));
            return;
          }

          try {
            const result = Capacitor.isNativePlatform()
              ? await this.pollNative(endpoint, token)
              : await firstValueFrom(
                  this.http.post<LoginFlowPollResponse>(
                    this.getPollUrl(endpoint),
                    new URLSearchParams({ token }).toString(),
                    {
                      headers: this.getProxyHeaders(serverUrl).set(
                        'Content-Type',
                        'application/x-www-form-urlencoded'
                      ),
                    }
                  )
                );

            if (result?.appPassword) {
              this.stopPolling();
              resolve({
                serverUrl: trimTrailingSlashes(result.server),
                loginName: result.loginName,
                appPassword: result.appPassword,
              });
            }
          } catch (error) {
            if (error instanceof HttpErrorResponse && error.status === 404) {
              return;
            }
            this.stopPolling();
            reject(this.toGermanError(error));
          }
        })();
      }, POLL_INTERVAL_MS);
    });
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async postNative<T>(
    url: string,
    body: string,
    headers: Record<string, string>
  ): Promise<T> {
    const response = await nativeHttpRequest({
      method: 'POST',
      url,
      headers,
      data: body,
      responseType: 'json',
    });
    // Native CertPin transport returns the body as a raw string regardless of
    // responseType: normalize to a parsed object (web CapacitorHttp already
    // parses). See ocs-response.util.ts; OCS/Capabilities do the same.
    return normalizeNativeHttpBody(response.data) as T;
  }

  private async pollNative(
    endpoint: string,
    token: string
  ): Promise<LoginFlowPollResponse | null> {
    try {
      const response = await nativeHttpRequest({
        method: 'POST',
        url: endpoint,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams({ token }).toString(),
        responseType: 'json',
      });
      if (response.status === 404) return null;
      return normalizeNativeHttpBody(response.data) as LoginFlowPollResponse;
    } catch {
      return null;
    }
  }

  /**
   * Builds the device name shown by Nextcloud, e.g.
   * "Sanctum - Nextcloud Superapp (Pixel 6 Pro)". Falls back to the bare
   * app name if the device model cannot be read.
   */
  private async buildUserAgent(): Promise<string> {
    try {
      const { model } = await Device.getInfo();
      const trimmed = model?.trim();
      return trimmed ? `${APP_USER_AGENT} (${trimmed})` : APP_USER_AGENT;
    } catch {
      return APP_USER_AGENT;
    }
  }

  private getProxyHeaders(serverUrl: string): HttpHeaders {
    if (Capacitor.isNativePlatform()) {
      return new HttpHeaders();
    }
    return new HttpHeaders({ 'X-Nextcloud-Server': serverUrl });
  }

  private getLoginV2Url(serverUrl: string): string {
    if (Capacitor.isNativePlatform()) {
      return `${serverUrl}/index.php/login/v2`;
    }
    return '/nextcloud-proxy/index.php/login/v2';
  }

  private getPollUrl(endpoint: string): string {
    if (Capacitor.isNativePlatform()) {
      return endpoint;
    }
    return `/nextcloud-proxy${new URL(endpoint).pathname}`;
  }

  private normalizeServerUrl(url: string): string {
    return normalizeServerUrl(url);
  }

  private toGermanError(error: unknown): Error {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return new Error('Netzwerkfehler. Keine Verbindung zum Server.');
      }
      return new Error(`Anmeldung fehlgeschlagen. (HTTP ${error.status}).`);
    }
    if (error instanceof Error) {
      return error;
    }
    return new Error('Anmeldung fehlgeschlagen.');
  }
}
