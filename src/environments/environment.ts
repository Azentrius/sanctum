// SPDX-License-Identifier: GPL-3.0-or-later
import pkg from '../../package.json';

export const environment = {
  production: false,
  /** Append [[aihint:...]] to aria-labels for Arbigent (disabled in prod builds). */
  aiHints: true,
  appName: 'Sanctum',
  biometricLockTimeoutMinutes: 5,
  appVersion: pkg.version,
  buildDate: new Date().toISOString().split('T')[0],
  buildNumber: '0',
  buildCommit: 'dev',
  sentry: {
    enabled: false,
    dsn: '',
    environment: 'development',
    tracesSampleRate: 0,
  },
};
