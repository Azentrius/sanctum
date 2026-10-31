// SPDX-License-Identifier: GPL-3.0-or-later
import { bootstrapApplication } from '@angular/platform-browser';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { initObservability } from './app/core/observability/observability';

initObservability().finally(() => {
  bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
});
