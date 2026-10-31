// SPDX-License-Identifier: GPL-3.0-or-later
// Dev-only proxy target router for `ng serve` (see proxy.conf.js).
// The Nextcloud host is supplied by the app via the `X-Nextcloud-Server` header,
// so this is an SSRF chokepoint: a hostile/misconfigured value must not be able to
// reach loopback, link-local (incl. cloud metadata), or private-network addresses.
//
// Note (residual risk, accepted for a dev-only proxy): a public DNS name that
// resolves to a private IP (DNS rebinding) is NOT caught here: the proxy router
// runs synchronously and cannot do a DNS lookup. The IP-literal checks below cover
// the direct-address SSRF surface, which is what a dev proxy realistically faces.

function trimTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') {
    end--;
  }
  return end === value.length ? value : value.slice(0, end);
}

/** Blocked hostnames (non-IP) commonly abused for SSRF / metadata exfiltration. */
const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

/** True for IPv4 ranges that must never be proxied to. `parts` = [a, b, c, d]. */
function isBlockedIPv4(parts) {
  const [a, b, c, d] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // RFC1918 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 private
  if (a === 192 && b === 168) return true; // RFC1918 private
  if (a === 100 && b >= 64 && b <= 127) return true; // RFC6598 CGNAT
  if (a === 255 && b === 255 && c === 255 && d === 255) return true; // broadcast
  return false;
}

/** Parses a canonical dotted-decimal IPv4 string to [a,b,c,d], or null. */
function parseDottedIPv4(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const parts = match.slice(1, 5).map(Number);
  return parts.every((octet) => octet <= 255) ? parts : null;
}

/** Expands an IPv6 literal (no brackets) into eight 16-bit groups, or null. */
function expandIPv6(host) {
  if (!host.includes(':')) return null;
  const halves = host.split('::');
  if (halves.length > 2) return null;

  const toGroups = (segment) => {
    if (segment === '') return [];
    const tokens = segment.split(':');
    const groups = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      // A trailing IPv4-mapped tail (e.g. ::ffff:127.0.0.1) expands to two groups.
      if (token.includes('.')) {
        const ipv4 = parseDottedIPv4(token);
        if (!ipv4 || i !== tokens.length - 1) return null;
        groups.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(token)) return null;
      groups.push(Number.parseInt(token, 16));
    }
    return groups;
  };

  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (head === null || tail === null) return null;

  let groups;
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...new Array(fill).fill(0), ...tail];
  } else {
    groups = head;
  }
  return groups.length === 8 ? groups : null;
}

/** True for IPv6 addresses that must never be proxied to. */
function isBlockedIPv6(groups) {
  const isZero = (from, to) => groups.slice(from, to).every((group) => group === 0);
  if (isZero(0, 8)) return true; // :: unspecified
  if (isZero(0, 7) && groups[7] === 1) return true; // ::1 loopback
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  // IPv4-mapped ::ffff:a.b.c.d: re-check the embedded IPv4.
  if (isZero(0, 5) && groups[5] === 0xffff) {
    return isBlockedIPv4([groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff]);
  }
  return false;
}

/** CI edge-network service names: plain HTTP, reachable from job containers only. */
const INTERNAL_HTTP_HOSTS = new Set(['nextcloud-test', 'toxiproxy']);

function isAllowedProxyTarget(target) {
  try {
    const url = new URL(trimTrailingSlashes(target));
    const host = url.hostname.toLowerCase();

    if (url.protocol === 'http:') {
      return INTERNAL_HTTP_HOSTS.has(host);
    }

    if (url.protocol !== 'https:') {
      return false;
    }

    // WHATWG URL canonicalises IPv4 (incl. decimal/hex/octal/short forms) into
    // dotted-decimal and compresses IPv6, so checking the canonical host suffices.

    if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
      return false;
    }

    if (host.startsWith('[') && host.endsWith(']')) {
      const groups = expandIPv6(host.slice(1, -1));
      return groups ? !isBlockedIPv6(groups) : false;
    }

    const ipv4 = parseDottedIPv4(host);
    if (ipv4) {
      return !isBlockedIPv4(ipv4);
    }

    return true;
  } catch {
    return false;
  }
}

module.exports = function nextcloudProxyRouter(req) {
  const target = req.headers['x-nextcloud-server'];
  if (!target) {
    console.warn('[proxy.router] Missing X-Nextcloud-Server header');
    return undefined;
  }

  if (!isAllowedProxyTarget(target)) {
    console.warn('[proxy.router] Rejected proxy target:', target);
    return undefined;
  }

  return trimTrailingSlashes(target);
};

// Exported for unit tests.
module.exports.isAllowedProxyTarget = isAllowedProxyTarget;
