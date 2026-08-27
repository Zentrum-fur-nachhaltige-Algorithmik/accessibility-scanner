'use strict';

/**
 * url-guard — SSRF protection for scan targets.
 *
 * The scanner drives a real browser against an arbitrary, caller-supplied URL.
 * Without a guard that is a textbook SSRF primitive: an attacker can point the
 * scanner at cloud metadata (169.254.169.254), at internal services on the
 * loopback/RFC1918 network, or at `file://` and exfiltrate the response through
 * the generated report.
 *
 * Policy enforced by {@link assertScannableUrl}:
 *   1. Scheme must be http: or https:  (file:, data:, chrome:, gopher: … rejected)
 *   2. Host must pass the optional SCAN_ALLOWED_HOSTS allowlist
 *   3. Every address the host resolves to must be publicly routable
 *
 * @module url-guard
 */

const dns = require('dns').promises;
const net = require('net');

// ── Typed errors ────────────────────────────────────────────────

/** Base class for every rejection produced by this module. */
class UrlGuardError extends Error {
  constructor(message, code) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    /** HTTP status callers should map this to. */
    this.statusCode = 400;
    if (Error.captureStackTrace) Error.captureStackTrace(this, new.target);
  }
}

/** URL is absent, not a string, or not parseable. */
class InvalidUrlError extends UrlGuardError {
  constructor(message) {
    super(message, 'INVALID_URL');
  }
}

/** URL uses a scheme other than http/https (file:, data:, chrome:, …). */
class BlockedProtocolError extends UrlGuardError {
  constructor(message) {
    super(message, 'BLOCKED_PROTOCOL');
  }
}

/** SCAN_ALLOWED_HOSTS is configured and the host does not match any entry. */
class HostNotAllowedError extends UrlGuardError {
  constructor(message) {
    super(message, 'HOST_NOT_ALLOWED');
  }
}

/** Host is, or resolves to, a private/reserved address. */
class PrivateAddressError extends UrlGuardError {
  constructor(message) {
    super(message, 'PRIVATE_ADDRESS');
  }
}

/** Hostname could not be resolved at all — we refuse to hand it to the browser. */
class DnsResolutionError extends UrlGuardError {
  constructor(message) {
    super(message, 'DNS_RESOLUTION_FAILED');
  }
}

// ── Address classification ──────────────────────────────────────

/**
 * IPv4 ranges that must never be reached by a scan.
 * The first six are the ranges required by the security spec; the remainder are
 * defence-in-depth (they are equally non-public and cannot be legitimate scan
 * targets).
 * @type {Array<[string, number, string]>} [network, prefix bits, description]
 */
const BLOCKED_V4 = [
  ['0.0.0.0', 8, 'unspecified / this-network 0.0.0.0/8'],
  ['10.0.0.0', 8, 'RFC1918 private 10.0.0.0/8'],
  ['127.0.0.0', 8, 'loopback 127.0.0.0/8'],
  ['169.254.0.0', 16, 'link-local / cloud metadata 169.254.0.0/16'],
  ['172.16.0.0', 12, 'RFC1918 private 172.16.0.0/12'],
  ['192.168.0.0', 16, 'RFC1918 private 192.168.0.0/16'],
  // defence in depth — not required by spec, equally non-public
  ['100.64.0.0', 10, 'carrier-grade NAT 100.64.0.0/10'],
  ['192.0.0.0', 24, 'IETF protocol assignments 192.0.0.0/24'],
  ['198.18.0.0', 15, 'benchmarking 198.18.0.0/15'],
  ['224.0.0.0', 4, 'multicast 224.0.0.0/4'],
  ['240.0.0.0', 4, 'reserved / broadcast 240.0.0.0/4'],
];

/** @returns {number[]|null} four octets, or null when not a dotted-quad IPv4 */
function ipv4ToBytes(value) {
  if (!net.isIPv4(value)) return null;
  return value.split('.').map((o) => parseInt(o, 10));
}

function bytesToUint32(bytes) {
  return ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
}

/**
 * @param {string} ip dotted-quad IPv4
 * @returns {string|null} human-readable reason when blocked, null when public
 */
function describeBlockedIPv4(ip) {
  const bytes = ipv4ToBytes(ip);
  if (!bytes) return null;
  const value = bytesToUint32(bytes);
  for (const [network, bits, description] of BLOCKED_V4) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    const base = bytesToUint32(ipv4ToBytes(network));
    if ((value & mask) === (base & mask)) return description;
  }
  return null;
}

/**
 * Expand any valid IPv6 literal (compressed, zone-suffixed, IPv4-embedded) into
 * its 16 raw bytes.
 * @returns {Uint8Array|null}
 */
function expandIPv6(input) {
  const addr = String(input).split('%')[0];
  if (!net.isIPv6(addr)) return null;

  const doubleColon = addr.indexOf('::');
  const head = doubleColon === -1 ? addr : addr.slice(0, doubleColon);
  const tail = doubleColon === -1 ? '' : addr.slice(doubleColon + 2);

  const parse = (section, out) => {
    if (section === '') return true;
    for (const group of section.split(':')) {
      if (group.includes('.')) {
        const v4 = ipv4ToBytes(group);
        if (!v4) return false;
        out.push(...v4);
      } else {
        const n = parseInt(group, 16);
        if (Number.isNaN(n)) return false;
        out.push((n >> 8) & 0xff, n & 0xff);
      }
    }
    return true;
  };

  const headBytes = [];
  const tailBytes = [];
  if (!parse(head, headBytes) || !parse(tail, tailBytes)) return null;

  const fill = 16 - headBytes.length - tailBytes.length;
  if (fill < 0) return null;
  if (doubleColon === -1 && fill !== 0) return null;

  return Uint8Array.from([...headBytes, ...new Array(fill).fill(0), ...tailBytes]);
}

/**
 * @param {string} ip IPv6 literal
 * @returns {string|null} human-readable reason when blocked, null when public
 */
function describeBlockedIPv6(ip) {
  const b = expandIPv6(ip);
  if (!b) return null;

  const allZeroUpTo = (n) => b.slice(0, n).every((byte) => byte === 0);

  if (allZeroUpTo(15) && b[15] === 1) return 'loopback ::1';
  if (allZeroUpTo(16)) return 'unspecified ::';

  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible) tunnel an IPv4 address —
  // classify by the embedded IPv4 so ::ffff:127.0.0.1 is blocked like 127.0.0.1.
  const mapped = allZeroUpTo(10) && b[10] === 0xff && b[11] === 0xff;
  const compatible = allZeroUpTo(12);
  if (mapped || compatible) {
    const v4 = `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
    const reason = describeBlockedIPv4(v4);
    if (reason) return `IPv4-${mapped ? 'mapped' : 'compatible'} ${v4} (${reason})`;
    return null;
  }

  if ((b[0] & 0xfe) === 0xfc) return 'unique local fc00::/7';
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return 'link-local fe80::/10';
  if (b[0] === 0xff) return 'multicast ff00::/8';
  return null;
}

/**
 * Classify a literal IP address.
 * @param {string} ip IPv4 or IPv6 literal
 * @returns {string|null} reason string when the address is private/reserved,
 *                        null when it is publicly routable (or not an IP)
 */
function describeBlockedAddress(ip) {
  if (net.isIPv4(ip)) return describeBlockedIPv4(ip);
  if (net.isIPv6(ip)) return describeBlockedIPv6(ip);
  return null;
}

/** Convenience predicate over {@link describeBlockedAddress}. */
function isPrivateAddress(ip) {
  return describeBlockedAddress(ip) !== null;
}

// ── Allowlist ───────────────────────────────────────────────────

/**
 * Parse SCAN_ALLOWED_HOSTS.
 *
 * Entries are host suffixes: `.vercel.app`, `vercel.app`, `localhost`,
 * `127.0.0.1`. A leading `.` or `*.` marks a wildcard-suffix entry; anything
 * else is treated as an exact host that also matches its subdomains.
 *
 * @param {string|undefined} raw
 * @returns {Array<{source:string, base:string, wildcard:boolean}>}
 */
function parseAllowlist(raw) {
  if (raw === undefined || raw === null) return [];
  return String(raw)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => {
      const wildcard = entry.startsWith('.') || entry.startsWith('*.');
      const base = entry.replace(/^\*?\./, '').replace(/\.$/, '');
      return { source: entry, base, wildcard };
    })
    .filter((entry) => entry.base.length > 0);
}

/**
 * Suffix match on label boundaries — `.vercel.app` matches `a.vercel.app` but
 * never `evil-vercel.app`.
 */
function matchAllowlist(hostname, entries) {
  for (const entry of entries) {
    if (hostname === entry.base) return { entry, exact: true };
    if (hostname.endsWith(`.${entry.base}`)) return { entry, exact: false };
  }
  return null;
}

/**
 * Decide whether an allowlist hit also lifts the private-address block.
 *
 * Internal preview scanning must stay possible, so an operator who writes
 * `SCAN_ALLOWED_HOSTS=localhost,127.0.0.1` gets exactly that. But a broad
 * public suffix such as `.vercel.app` must NOT become a DNS-rebinding hole:
 * `evil.vercel.app -> 127.0.0.1` stays blocked.
 *
 * The private block is therefore lifted only when the allowlist names the host
 * concretely: an exact hostname hit, a private/loopback IP literal entry, or a
 * `localhost` / `*.localhost` entry.
 */
function allowlistVouchesForPrivate(hostname, hit) {
  if (!hit) return false;
  const { entry, exact } = hit;
  if (entry.base === 'localhost') return true;
  if (net.isIP(entry.base) && isPrivateAddress(entry.base)) return true;
  return exact && !entry.wildcard;
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Validate that a URL is safe to hand to the scanning browser.
 *
 * @param {string} url raw, caller-supplied URL
 * @param {object} [options]
 * @param {string} [options.allowedHosts] override for SCAN_ALLOWED_HOSTS (tests)
 * @param {(hostname: string) => Promise<Array<{address: string}>>} [options.lookup]
 *        DNS resolver override (tests)
 * @returns {Promise<{url: string, hostname: string, addresses: string[], allowlisted: boolean}>}
 * @throws {InvalidUrlError|BlockedProtocolError|HostNotAllowedError|PrivateAddressError|DnsResolutionError}
 */
async function assertScannableUrl(url, options = {}) {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new InvalidUrlError('URL is required and must be a non-empty string');
  }

  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch (error) {
    throw new InvalidUrlError(`Malformed URL: ${url.trim().slice(0, 200)}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BlockedProtocolError(
      `Unsupported URL scheme "${parsed.protocol}" — only http: and https: may be scanned`
    );
  }

  // WHATWG URL keeps IPv6 literals bracketed and normalises decimal/octal IPv4
  // forms (http://2130706433/ -> 127.0.0.1), so this is the canonical host.
  const hostname = parsed.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (!hostname) {
    throw new InvalidUrlError('URL has no hostname');
  }

  const allowlistSource =
    options.allowedHosts !== undefined ? options.allowedHosts : process.env.SCAN_ALLOWED_HOSTS;
  const allowlist = parseAllowlist(allowlistSource);
  let hit = null;

  if (allowlist.length > 0) {
    hit = matchAllowlist(hostname, allowlist);
    if (!hit) {
      throw new HostNotAllowedError(
        `Host "${hostname}" is not in SCAN_ALLOWED_HOSTS (${allowlist.map((e) => e.source).join(', ')})`
      );
    }
  }

  const allowPrivate = allowlistVouchesForPrivate(hostname, hit);

  // Literal IP target — no resolution needed, classify directly.
  if (net.isIP(hostname)) {
    const reason = describeBlockedAddress(hostname);
    if (reason && !allowPrivate) {
      throw new PrivateAddressError(
        `Refusing to scan private/reserved address ${hostname} (${reason})`
      );
    }
    return { url: parsed.href, hostname, addresses: [hostname], allowlisted: !!hit };
  }

  const lookup = options.lookup || ((host) => dns.lookup(host, { all: true, verbatim: true }));

  let records;
  try {
    records = await lookup(hostname);
  } catch (error) {
    throw new DnsResolutionError(
      `Could not resolve host "${hostname}": ${error.code || error.message}`
    );
  }

  const addresses = (records || [])
    .map((r) => (typeof r === 'string' ? r : r.address))
    .filter(Boolean);
  if (addresses.length === 0) {
    throw new DnsResolutionError(`Host "${hostname}" did not resolve to any address`);
  }

  if (!allowPrivate) {
    for (const address of addresses) {
      const reason = describeBlockedAddress(address);
      if (reason) {
        throw new PrivateAddressError(
          `Host "${hostname}" resolves to private/reserved address ${address} (${reason})`
        );
      }
    }
  }

  return { url: parsed.href, hostname, addresses, allowlisted: !!hit };
}

/**
 * Build a Puppeteer `request` handler that re-applies the same SSRF policy to
 * every sub-resource the scanned page requests (redirects, XHR, iframes, …).
 *
 * {@link assertScannableUrl} only vets the *entry* URL; a hostile page can
 * still redirect or fetch its way to 169.254.169.254 afterwards. This hook
 * closes that gap.
 *
 * NOT wired into the pipeline — src/scan-pipeline.js is owned by another agent.
 * To adopt it there:
 *
 * ```js
 * const { createRequestGuard } = require('./url-guard');
 * await page.setRequestInterception(true);
 * page.on('request', createRequestGuard({ onBlock: (url, err) => log(url, err.code) }));
 * ```
 *
 * Caveats for whoever wires it up:
 *  - `setRequestInterception(true)` disables Chrome's HTTP cache and slows
 *    scans; measure before enabling it for every scanner.
 *  - Only one handler may resolve a request. If other interceptors exist, use
 *    puppeteer's cooperative intercept mode (`request.continue({}, priority)`).
 *  - Non-network schemes (data:, blob:, about:) are passed through; file: is
 *    always aborted.
 *
 * @param {object} [options]
 * @param {string} [options.allowedHosts] override for SCAN_ALLOWED_HOSTS
 * @param {(url: string, error: Error) => void} [options.onBlock] block callback
 * @returns {(request: import('puppeteer').HTTPRequest) => Promise<void>}
 */
function createRequestGuard(options = {}) {
  const { onBlock } = options;
  const passthroughSchemes = new Set(['data:', 'blob:', 'about:']);

  return async function guardRequest(request) {
    if (
      typeof request.isInterceptResolutionHandled === 'function' &&
      request.isInterceptResolutionHandled()
    ) {
      return;
    }

    const requestUrl = request.url();
    let protocol = null;
    try {
      protocol = new URL(requestUrl).protocol;
    } catch (error) {
      /* fall through — unparseable URLs are aborted below */
    }

    if (protocol && passthroughSchemes.has(protocol)) {
      await request.continue().catch(() => {});
      return;
    }

    try {
      await assertScannableUrl(requestUrl, { allowedHosts: options.allowedHosts });
      await request.continue().catch(() => {});
    } catch (error) {
      if (onBlock) {
        try {
          onBlock(requestUrl, error);
        } catch (e) {
          /* never let logging break a scan */
        }
      }
      await request.abort('blockedbyclient').catch(() => {});
    }
  };
}

module.exports = {
  assertScannableUrl,
  createRequestGuard,
  isPrivateAddress,
  describeBlockedAddress,
  parseAllowlist,
  UrlGuardError,
  InvalidUrlError,
  BlockedProtocolError,
  HostNotAllowedError,
  PrivateAddressError,
  DnsResolutionError,
};
