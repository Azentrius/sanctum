// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable } from '@angular/core';

import {
  registerDeviceOnPushProxy,
  type PushProxyRegistrationInput,
} from './push-proxy.util';

@Injectable({ providedIn: 'root' })
export class PushProxyService {
  register(input: PushProxyRegistrationInput): Promise<void> {
    return registerDeviceOnPushProxy(input);
  }
}
