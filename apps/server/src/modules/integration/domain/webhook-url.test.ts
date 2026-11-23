import { describe, expect, it } from 'vitest';
import { isPrivateAddress, webhookUrlPreview, webhookUrlProblem } from './webhook-url';

describe('webhookUrlProblem', () => {
  it('accepts a plain public https address, with a path and a query', () => {
    expect(webhookUrlProblem('https://hooks.sekolah.example/absah?token=abc')).toBeNull();
    expect(webhookUrlProblem('https://203.0.113.10/in')).toBeNull();
    expect(webhookUrlProblem('https://hooks.example:443/in')).toBeNull();
  });

  it('refuses anything that is not https, has credentials, or names another port', () => {
    expect(webhookUrlProblem('http://hooks.example/in')).toBe('not_https');
    expect(webhookUrlProblem('ftp://hooks.example/in')).toBe('not_https');
    expect(webhookUrlProblem('bukan alamat')).toBe('not_https');
    expect(webhookUrlProblem('https://user:pw@hooks.example/in')).toBe('credentials');
    expect(webhookUrlProblem('https://hooks.example:8443/in')).toBe('port');
  });

  it('refuses loopback, private, link-local and metadata hosts however they are written', () => {
    for (const u of [
      'https://localhost/in',
      'https://LOCALHOST./in',
      'https://app.localhost/in',
      'https://127.0.0.1/in',
      'https://2130706433/in', // 127.0.0.1 as one number
      'https://0x7f.1/in',
      'https://10.1.2.3/in',
      'https://172.16.0.1/in',
      'https://192.168.1.10/in',
      'https://169.254.169.254/latest/meta-data',
      'https://100.64.0.1/in',
      'https://0.0.0.0/in',
      'https://[::1]/in',
      'https://[fd00::1]/in',
      'https://[fe80::1]/in',
      'https://[::ffff:127.0.0.1]/in',
      'https://[::ffff:7f00:1]/in',
      'https://metadata.google.internal/in',
      'https://printer.local/in',
      'https://intranet/in',
    ])
      expect(webhookUrlProblem(u), u).toBe('private_host');
  });

  it('previews scheme and host only', () => {
    expect(webhookUrlPreview('https://hooks.example/secret/path?t=1')).toBe('https://hooks.example');
  });
});

describe('isPrivateAddress', () => {
  it('knows the edges of the private ranges', () => {
    expect(isPrivateAddress('172.15.255.255')).toBe(false);
    expect(isPrivateAddress('172.16.0.0')).toBe(true);
    expect(isPrivateAddress('172.31.255.255')).toBe(true);
    expect(isPrivateAddress('172.32.0.0')).toBe(false);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateAddress('bukan-ip')).toBe(true);
  });
});
