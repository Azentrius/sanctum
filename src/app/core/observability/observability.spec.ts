// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Breadcrumb, ErrorEvent } from '@sentry/core';

import { redact, scrubBreadcrumb, scrubEvent } from './observability';

describe('redact', () => {
  it('masks secret and api_key query parameters', () => {
    const url =
      'https://cloud.example.com/api?secret=supersecret&api_key=abc123&foo=bar';
    expect(redact(url)).toBe(
      'https://[nextcloud-host]/api?secret=[redacted]&api_key=[redacted]&foo=bar',
    );
  });

  it('masks token, password, auth and credentials parameters', () => {
    const input =
      'path?token=tok&password=pw&auth=basic&credentials=encoded&keep=yes';
    expect(redact(input)).toBe(
      'path?token=[redacted]&password=[redacted]&auth=[redacted]&credentials=[redacted]&keep=yes',
    );
  });

  it('masks jwt, session, signature, sig and OAuth code parameters', () => {
    const input =
      'cb?code=authcode&jwt=ey.aa.bb&session=sid123&signature=sigval&sig=short&keep=yes';
    expect(redact(input)).toBe(
      'cb?code=[redacted]&jwt=[redacted]&session=[redacted]&signature=[redacted]&sig=[redacted]&keep=yes',
    );
  });

  it('masks Bearer tokens in messages', () => {
    expect(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9')).toBe(
      'Authorization: Bearer [redacted]',
    );
  });

  it('masks Bearer tokens regardless of keyword case', () => {
    expect(redact('authorization: bearer eyJhbGciOiJIUzI1NiJ9')).toBe(
      'authorization: Bearer [redacted]',
    );
    expect(redact('BEARER eyJhbGciOiJIUzI1NiJ9')).toBe('Bearer [redacted]');
  });

  it('preserves the GlitchTip host while redacting other origins', () => {
    expect(redact('https://glitchtip.azentrius.de/api/1/envelope/')).toBe(
      'https://glitchtip.azentrius.de/api/1/envelope/',
    );
    expect(redact('https://nextcloud.example.com/remote.php/dav')).toBe(
      'https://[nextcloud-host]/remote.php/dav',
    );
  });

  it('masks email addresses', () => {
    expect(redact('user@example.com failed to sync')).toBe(
      '[email-redacted] failed to sync',
    );
  });
});

describe('scrubEvent', () => {
  it('drops cookies/headers/data and redacts the request url', () => {
    const event = {
      request: {
        url: 'https://nextcloud.example.com/api?token=tok',
        cookies: 'sid=abc',
        headers: { Authorization: 'Bearer secret' },
        data: { password: 'pw' },
      },
    } as unknown as ErrorEvent;

    const out = scrubEvent(event) as ErrorEvent;

    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.headers).toBeUndefined();
    expect(
      (out.request as unknown as Record<string, unknown>)['data'],
    ).toBeUndefined();
    expect(out.request?.url).toBe('https://[nextcloud-host]/api?token=[redacted]');
  });

  it('redacts exception values and the top-level message', () => {
    const event = {
      message: 'failed for user@example.com',
      exception: {
        values: [{ value: 'request failed with Bearer eyJ.payload.sig' }],
      },
    } as unknown as ErrorEvent;

    const out = scrubEvent(event) as ErrorEvent;

    expect(out.message).toBe('failed for [email-redacted]');
    expect(out.exception?.values?.[0]?.value).toBe(
      'request failed with Bearer [redacted]',
    );
  });

  it('recursively scrubs nested extra and contexts', () => {
    const event = {
      extra: {
        outer: {
          inner: 'visit https://nextcloud.example.com/index?access_token=tok',
        },
        note: 'contact admin@example.com',
      },
      contexts: {
        sync: { lastUrl: 'https://nextcloud.example.com/dav' },
      },
    } as unknown as ErrorEvent;

    const out = scrubEvent(event) as ErrorEvent;
    const extra = out.extra as unknown as Record<
      string,
      Record<string, string>
    >;

    expect(extra['outer']['inner']).toBe(
      'visit https://[nextcloud-host]/index?access_token=[redacted]',
    );
    expect((out.extra as unknown as Record<string, string>)['note']).toBe(
      'contact [email-redacted]',
    );
    expect(
      (out.contexts as unknown as Record<string, Record<string, string>>)[
        'sync'
      ]['lastUrl'],
    ).toBe('https://[nextcloud-host]/dav');
  });

  it('reduces the user to the id only', () => {
    const event = {
      user: { id: 'u1', email: 'user@example.com', username: 'alice' },
    } as unknown as ErrorEvent;

    const out = scrubEvent(event) as ErrorEvent;

    expect(out.user).toEqual({ id: 'u1' });
  });
});

describe('scrubBreadcrumb', () => {
  it('redacts breadcrumb message and nested data', () => {
    const crumb = {
      message: 'GET https://nextcloud.example.com/chat?token=tok',
      data: {
        url: 'https://nextcloud.example.com/api?password=pw',
        meta: { who: 'user@example.com' },
      },
    } as unknown as Breadcrumb;

    const out = scrubBreadcrumb(crumb) as Breadcrumb;

    expect(out.message).toBe('GET https://[nextcloud-host]/chat?token=[redacted]');
    expect((out.data as unknown as Record<string, string>)['url']).toBe(
      'https://[nextcloud-host]/api?password=[redacted]',
    );
    expect(
      (out.data as unknown as Record<string, Record<string, string>>)['meta'][
        'who'
      ],
    ).toBe('[email-redacted]');
  });
});
