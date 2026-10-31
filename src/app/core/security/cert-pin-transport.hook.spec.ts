// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import {
  notifyCertPinTransportError,
  registerCertPinTransportHook,
} from './cert-pin-transport.hook';

describe('cert-pin-transport.hook', () => {
  it('forwards transport errors to the registered hook', () => {
    const hook = vi.fn();
    registerCertPinTransportHook(hook);

    const error = { code: 'CERT_PIN_MISMATCH' };
    notifyCertPinTransportError(error, 'https://cloud.example.com/login');

    expect(hook).toHaveBeenCalledWith(error, 'https://cloud.example.com/login');
  });

  it('ignores notifications when no hook is registered', () => {
    registerCertPinTransportHook(() => undefined);
    expect(() => notifyCertPinTransportError(new Error('x'))).not.toThrow();
  });
});
