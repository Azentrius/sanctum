// SPDX-License-Identifier: GPL-3.0-or-later
import type { Breadcrumb, ErrorEvent } from '@sentry/core';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';

import { environment } from '../../../environments/environment';

export const CRASH_REPORTING_PREF_KEY = 'observability:crashReportingEnabled';

let crashReportingActive = false;
let sentryInitialized = false;

/**
 * Initialises error tracking. Must run BEFORE the Angular bootstrap (see main.ts).
 * A no-op while environment.sentry.enabled is false.
 */
export async function initObservability(options?: { force?: boolean }): Promise<void> {
  const cfg = environment.sentry;
  if (!cfg.enabled || !cfg.dsn) {
    return;
  }

  crashReportingActive = await readCrashReportingPreference();
  if (!crashReportingActive) {
    return;
  }

  if (sentryInitialized && !options?.force) {
    return;
  }

  // The release string MUST match the one source maps are uploaded under.
  let release = `de.azentrius.sanctum@${environment.appVersion}+${environment.buildNumber}`;
  try {
    const info = await App.getInfo();
    release = `de.azentrius.sanctum@${info.version}+${info.build}`;
  } catch {
    // Web/browser: App.getInfo() is not available; the build metadata from CI stays.
  }

  // Lazy-load the Sentry SDK so merely importing this module (e.g. transitively
  // from a service under unit test) never evaluates @sentry/capacitor's native
  // wrapper at module load. Reached only once crash reporting is actually on.
  const Sentry = await import('@sentry/capacitor');
  const { init: sentryAngularInit } = await import('@sentry/angular');

  Sentry.init(
    {
      dsn: cfg.dsn,
      environment: cfg.environment,
      release,
      tracesSampleRate: cfg.tracesSampleRate,

      sendDefaultPii: false,
      maxBreadcrumbs: 50,
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,

      enableWatchdogTerminationTracking: true,
    },
    sentryAngularInit,
  );

  Sentry.setTag('build.commit', environment.buildCommit);
  Sentry.setTag('build.date', environment.buildDate);
  Sentry.setTag('build.number', environment.buildNumber);

  sentryInitialized = true;
}

export function isCrashReportingActive(): boolean {
  return environment.sentry?.enabled === true && crashReportingActive;
}

export function setCrashReportingActive(enabled: boolean): void {
  crashReportingActive = enabled;
}

export async function shutdownObservability(): Promise<void> {
  const Sentry = await import('@sentry/capacitor');
  await Sentry.close();
  sentryInitialized = false;
}

async function readCrashReportingPreference(): Promise<boolean> {
  const { value } = await Preferences.get({ key: CRASH_REPORTING_PREF_KEY });
  if (value === null) {
    return false;
  }
  return value === 'true';
}

/** Scrubs an outgoing event of credentials, PII and message content. Exported for unit tests. */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete (event.request as Record<string, unknown>)['data'];
    if (event.request.url) {
      event.request.url = redact(event.request.url);
    }
  }
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex.value) ex.value = redact(ex.value);
    }
  }
  if (event.message) {
    event.message = redact(event.message);
  }
  if (event.extra) {
    event.extra = scrubRecord(event.extra);
  }
  if (event.contexts) {
    event.contexts = scrubRecord(event.contexts);
  }
  if (event.user) {
    event.user = { id: event.user.id };
  }
  return event;
}

/** Scrubs a breadcrumb of credentials and PII before it is attached. Exported for unit tests. */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.data) {
    crumb.data = scrubRecord(crumb.data);
  }
  if (crumb.message) crumb.message = redact(crumb.message);
  return crumb;
}

function scrubRecord<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      out[key] = redact(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = scrubRecord(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

/** Redacts credentials and hostnames from strings sent to Sentry. Exported for unit tests. */
export function redact(input: string): string {
  return input
    .replace(
      /([?&](?:token|access_token|password|auth|secret|credentials|apikey|api_key|jwt|session|sig|signature|code)=)[^&\s]+/gi,
      '$1[redacted]',
    )
    .replace(/Bearer\s+[A-Za-z0-9.\-_]+/gi, 'Bearer [redacted]')
    .replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '[email-redacted]')
    .replace(/https?:\/\/[^/\s]+/g, (m) => (m.includes('glitchtip.azentrius.de') ? m : 'https://[nextcloud-host]'));
}
