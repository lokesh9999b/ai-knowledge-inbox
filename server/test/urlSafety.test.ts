import { describe, expect, it } from 'vitest';
import { assertPublicUrl, isPrivateAddress, parsePublicUrl } from '../src/services/urlSafety.js';

describe('isPrivateAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])(
    'flags %s as private',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );

  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111'])('allows public %s', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('parsePublicUrl / assertPublicUrl', () => {
  it('rejects non-http schemes', () => {
    expect(() => parsePublicUrl('file:///etc/passwd')).toThrow(/http or https/);
    expect(() => parsePublicUrl('not a url')).toThrow(/valid absolute URL/);
  });

  it('rejects loopback and metadata hosts', async () => {
    await expect(assertPublicUrl(new URL('http://127.0.0.1:3001/'))).rejects.toThrow(/private/);
    await expect(assertPublicUrl(new URL('http://169.254.169.254/latest'))).rejects.toThrow(/private/);
    await expect(assertPublicUrl(new URL('http://[::1]/'))).rejects.toThrow(/private/);
  });

  it('accepts a public IP literal', async () => {
    await expect(assertPublicUrl(new URL('https://93.184.216.34/'))).resolves.toBeUndefined();
  });
});
