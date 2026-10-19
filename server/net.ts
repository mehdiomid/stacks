import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { LookupFunction } from 'node:net';

/** Status-carrying error so the route can answer with a clear message. */
export class FetchError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const allowPrivate = () => process.env.ALLOW_PRIVATE_PREVIEWS === 'true';

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
];

/** True for loopback, private, link-local, cloud-metadata and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff') || v.startsWith('64:ff9b:') || v.startsWith('2001:db8');
  }
  return true;
}

/**
 * DNS lookup that refuses non-public addresses. It runs at connect time, so a hostname
 * that resolves to a public address during a check and a private one later still fails.
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as dns.LookupAddress[];
    const bad = !allowPrivate() && list.some((a) => isPrivateAddress(a.address));
    if (bad || !list.length) {
      return callback(new FetchError(403, 'That address is on a private network, so Stacks will not fetch it.') as NodeJS.ErrnoException, '', 0);
    }
    if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export interface FetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
}

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (compatible; StacksPreview/1.0; +https://github.com/)';

export function checkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchError(400, 'That does not look like a web address.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchError(400, 'Only http and https links can be previewed.');
  if (u.username || u.password) throw new FetchError(400, 'Links with a username or password are not previewed.');
  if (u.port && !['80', '443'].includes(u.port) && !allowPrivate()) throw new FetchError(400, 'Only links on standard ports are previewed.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateAddress(host) && !allowPrivate()) throw new FetchError(403, 'That address is on a private network, so Stacks will not fetch it.');
  return u;
}

function requestOnce(u: URL, accept: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      u,
      {
        method: 'GET',
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: { 'user-agent': UA, accept, 'accept-language': 'en;q=0.9, *;q=0.5', 'accept-encoding': 'identity' },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, headers: res.headers, body: '' });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          chunks.push(chunk);
          if (size > MAX_BYTES) res.destroy();
        });
        const finish = () => {
          const buf = Buffer.concat(chunks);
          const charset = /charset=([\w-]+)/i.exec(String(res.headers['content-type'] ?? ''))?.[1] ?? 'utf-8';
          let body: string;
          try {
            body = new TextDecoder(charset).decode(buf);
          } catch {
            body = buf.toString('utf8');
          }
          resolve({ status, headers: res.headers, body });
        };
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new FetchError(504, 'The site took too long to answer.')));
    req.on('error', reject);
    req.end();
  });
}

/** GET a public URL, following up to 4 redirects, each one checked again. */
export async function safeFetch(raw: string, accept = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'): Promise<FetchResult> {
  let u = checkUrl(raw);
  for (let hop = 0; hop < 5; hop++) {
    const res = await requestOnce(u, accept);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      u = checkUrl(new URL(res.headers.location, u).toString());
      continue;
    }
    return { finalUrl: u.toString(), status: res.status, contentType: String(res.headers['content-type'] ?? ''), body: res.body };
  }
  throw new FetchError(508, 'The link redirects too many times.');
}
