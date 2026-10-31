// SPDX-License-Identifier: GPL-3.0-or-later
import pkg from '../../package.json';

export const environment = {
  production: true,
  aiHints: false,
  appName: 'Sanctum',
  biometricLockTimeoutMinutes: 5,
  appVersion: pkg.version,
  buildDate: 'unknown',
  buildNumber: '0',
  buildCommit: 'unknown',
  sentry: {
    enabled: false,
    dsn: '',
    environment: 'production',
    tracesSampleRate: 0,
  },
};
