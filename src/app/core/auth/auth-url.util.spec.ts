// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  assertLoginFlowOrigins,
  assertSameServerOrigin,
  serverOrigin,
} from './auth-url.util';

describe('serverOrigin', () => {
  it('normalizes trailing slashes', () => {
    expect(serverOrigin('https://cloud.example.com/')).toBe('https://cloud.example.com');
  });
});

describe('assertSameServerOrigin', () => {
  it('accepts paths on the same host', () => {
    expect(() =>
      assertSameServerOrigin(
        'https://cloud.example.com',
        'https://cloud.example.com/index.php/login/v2/poll',
      ),
    ).not.toThrow();
  });

  it('rejects a different host', () => {
    expect(() =>
      assertSameServerOrigin(
        'https://cloud.example.com',
        'https://evil.example.com/index.php/login/v2/poll',
      ),
    ).toThrow(/passt nicht zur eingegebenen Adresse/);
  });

  it('rejects an invalid target URL', () => {
    expect(() => assertSameServerOrigin('https://cloud.example.com', 'not-a-url')).toThrow(
      /Ungültige Server-Antwort/,
    );
  });
});

describe('assertLoginFlowOrigins', () => {
  it('validates both login and poll URLs', () => {
    expect(() =>
      assertLoginFlowOrigins(
        'https://cloud.example.com',
        'https://cloud.example.com/index.php/login/v2',
        'https://cloud.example.com/index.php/login/v2/poll/abc',
      ),
    ).not.toThrow();
  });
});
