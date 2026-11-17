import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from '../errors.js';

/** True for loopback, private, link-local, CGNAT and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return true;
}

export function parsePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'url must be a valid absolute URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('VALIDATION_ERROR', 'url must use http or https');
  }
  return url;
}

/**
 * SSRF guard: rejects URLs whose host resolves to a non-public address.
 * (A DNS-rebinding race between this check and the fetch remains; see docs/DESIGN.md.)
 */
export async function assertPublicUrl(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    throw new AppError('UNPROCESSABLE', `Could not resolve host "${url.hostname}"`);
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new AppError('UNPROCESSABLE', 'URL points to a private or non-public address, which is not allowed');
  }
}
