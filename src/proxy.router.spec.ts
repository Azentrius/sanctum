// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import proxyRouter from './proxy.router';

const { isAllowedProxyTarget } = proxyRouter as unknown as {
  isAllowedProxyTarget: (target: string) => boolean;
};

describe('proxy.router isAllowedProxyTarget (SSRF guard)', () => {
  it('allows legitimate public https hosts', () => {
    for (const target of [
      'https://cloud.example.com',
      'https://nextcloud.mydomain.de',
      'https://example.com:8443',
      'https://8.8.8.8',
      'https://[2606:4700:4700::1111]',
    ]) {
      expect(isAllowedProxyTarget(target), target).toBe(true);
    }
  });

  it('rejects non-https schemes', () => {
    expect(isAllowedProxyTarget('http://nextcloud.example.com')).toBe(false);
    expect(isAllowedProxyTarget('ftp://nextcloud.example.com')).toBe(false);
  });

  it('allows plain http only for CI edge-network service names', () => {
    expect(isAllowedProxyTarget('http://nextcloud-test')).toBe(true);
    expect(isAllowedProxyTarget('http://nextcloud-test/')).toBe(true);
    expect(isAllowedProxyTarget('http://toxiproxy')).toBe(true);
  });

  it('rejects loopback in every IPv4 encoding (decimal/hex/octal/short)', () => {
    for (const target of [
      'https://127.0.0.1',
      'https://2130706433',
      'https://0x7f000001',
      'https://0177.0.0.1',
      'https://127.1',
    ]) {
      expect(isAllowedProxyTarget(target), target).toBe(false);
    }
  });

  it('rejects link-local / cloud metadata, including alternate encodings', () => {
    for (const target of [
      'https://169.254.169.254',
      'https://2852039166',
      'https://0xa9fea9fe',
      'https://metadata.google.internal',
    ]) {
      expect(isAllowedProxyTarget(target), target).toBe(false);
    }
  });

  it('rejects RFC1918 private, CGNAT and broadcast ranges', () => {
    for (const target of [
      'https://10.0.0.5',
      'https://172.16.0.1',
      'https://172.31.255.1',
      'https://192.168.1.1',
      'https://100.64.0.1',
      'https://255.255.255.255',
      'https://0.0.0.0',
    ]) {
      expect(isAllowedProxyTarget(target), target).toBe(false);
    }
  });

  it('rejects localhost and *.localhost', () => {
    expect(isAllowedProxyTarget('https://localhost')).toBe(false);
    expect(isAllowedProxyTarget('https://foo.localhost')).toBe(false);
  });

  it('rejects blocked IPv6: loopback, unspecified, link-local, ULA, IPv4-mapped', () => {
    for (const target of [
      'https://[::1]',
      'https://[::]',
      'https://[fe80::1]',
      'https://[fc00::1]',
      'https://[fd12:3456::1]',
      'https://[::ffff:127.0.0.1]',
      'https://[::ffff:169.254.169.254]',
    ]) {
      expect(isAllowedProxyTarget(target), target).toBe(false);
    }
  });

  it('allows public addresses just outside the blocked ranges (boundaries)', () => {
    for (const target of [
      'https://11.0.0.1', // just outside 10/8
      'https://172.32.0.1', // just outside 172.16/12
      'https://192.169.0.1', // just outside 192.168/16
      'https://100.128.0.1', // just outside 100.64/10 CGNAT
    ]) {
      expect(isAllowedProxyTarget(target), target).toBe(true);
    }
  });

  it('rejects malformed targets', () => {
    expect(isAllowedProxyTarget('not a url')).toBe(false);
    expect(isAllowedProxyTarget('')).toBe(false);
  });
});

describe('proxy.router default export (request router)', () => {
  it('returns the trimmed target for an allowed host', () => {
    const target = proxyRouter({ headers: { 'x-nextcloud-server': 'https://cloud.example.com//' } });
    expect(target).toBe('https://cloud.example.com');
  });

  it('returns undefined when the X-Nextcloud-Server header is missing', () => {
    expect(proxyRouter({ headers: {} })).toBeUndefined();
  });

  it('returns undefined for a blocked target', () => {
    expect(proxyRouter({ headers: { 'x-nextcloud-server': 'https://127.0.0.1' } })).toBeUndefined();
  });
});
