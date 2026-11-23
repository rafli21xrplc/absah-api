/**
 * Where a webhook may point. The address is the admin's, but a wrong or hostile one must never make our worker call
 * into our own network (SSRF). This is the check at registration; the sender checks the RESOLVED address again at send
 * time (a name can point somewhere else later).
 */

const BLOCKED_NAMES = ['localhost', 'metadata.google.internal'];
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home', '.lan', '.corp'];

// domain/ may not import node:net, so literals are told apart by shape. URL has already normalised the host (a number
// like 2130706433 or 0x7f.1 arrives as 127.0.0.1, an IPv6 literal is lower case and bracketed).
const V4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const V6 = /^[0-9a-f:.]*:[0-9a-f:.]*$/i;
const ipKind = (v: string): 0 | 4 | 6 => (V4.test(v) ? 4 : V6.test(v) ? 6 : 0);

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

function privateV4(ip: string): boolean {
  const p = ipv4Parts(ip);
  if (!p) return true; // not parseable: treat as unsafe
  const [a = 0, b = 0] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

function privateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped?.[1]) return privateV4(mapped[1]);
  if (v.startsWith('::ffff:')) return true; // hex form of a mapped address: refuse rather than parse
  return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff'); // unique local, link-local, multicast
}

/** True when this IP literal is reachable only inside a network (or is not a plain public unicast address). */
export function isPrivateAddress(ip: string): boolean {
  const kind = ipKind(ip);
  return kind === 4 ? privateV4(ip) : kind === 6 ? privateV6(ip) : true;
}

export type UrlProblem = 'not_https' | 'credentials' | 'private_host' | 'port';

/** Why this address may not be used, or null when it may. */
export function webhookUrlProblem(raw: string): UrlProblem | null {
  if (!URL.canParse(raw)) return 'not_https';
  const url = new URL(raw);
  if (url.protocol !== 'https:') return 'not_https';
  if (url.username !== '' || url.password !== '') return 'credentials';
  if (url.port !== '' && url.port !== '443') return 'port';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (ipKind(host) !== 0) return isPrivateAddress(host) ? 'private_host' : null;
  // A name without a dot is a machine on the local network; known internal names and suffixes are refused too.
  if (!host.includes('.') || BLOCKED_NAMES.includes(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return 'private_host';
  // Numeric-looking names such as 2130706433 or 0x7f.1 are parsed by URL into dotted form above; anything left is a real name.
  return null;
}

/** What the admin sees afterwards: the scheme and host, never the path (it may carry a token). */
export const webhookUrlPreview = (raw: string): string => `https://${new URL(raw).hostname}`;
