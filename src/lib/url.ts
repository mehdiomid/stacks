const TRACKING = /^(utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src|ref_url|_hsenc|_hsmi|mkt_tok)$/i;

/** A comparable form of a URL so the same page saved twice is recognized. */
export function normalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  let host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  let path = u.pathname.replace(/\/+$/, '');
  const params = new URLSearchParams();
  if (host === 'youtu.be') {
    params.set('v', path.slice(1));
    host = 'youtube.com';
    path = '/watch';
  } else if (host === 'youtube.com' && path.startsWith('/shorts/')) {
    params.set('v', path.split('/')[2] ?? '');
    path = '/watch';
  } else if (host === 'youtube.com' && path === '/watch') {
    const v = u.searchParams.get('v');
    if (v) params.set('v', v);
  } else {
    [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING.test(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([k, v]) => params.append(k, v));
  }
  const q = params.toString();
  return `${host}${path}${q ? `?${q}` : ''}`;
}

export function domainOf(raw: string | null): string {
  if (!raw) return '';
  try {
    return new URL(raw).hostname.replace(/^(www|m)\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function isVideoUrl(raw: string): boolean {
  const d = domainOf(raw);
  if (d === 'youtu.be' || d === 'vimeo.com') return true;
  if (d === 'youtube.com') return /\/(watch|shorts|live)\b/.test(raw);
  return false;
}

/** A readable guess at a title from the last part of the path. */
export function titleFromUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    const words = seg.replace(/\.(html?|php|aspx?)$/i, '').replace(/[-_+]+/g, ' ').trim();
    if (!words || /^\d+$/.test(words)) return u.hostname.replace(/^www\./, '');
    return words.charAt(0).toUpperCase() + words.slice(1);
  } catch {
    return raw;
  }
}

const GENERIC_TITLES = new Set([
  'linkedin', 'just a moment...', 'just a moment', 'attention required!', 'attention required! | cloudflare', 'access denied', 'forbidden',
  '403 forbidden', '404 not found', 'page not found', 'not found', 'sign in', 'log in', 'login', 'redirecting', 'redirecting...',
  'loading', 'loading...', 'youtube', 'x', 'twitter', 'facebook', 'instagram', 'medium', 'error', 'untitled',
]);

/** A preview title that says nothing about the page, like "LinkedIn" or "Just a moment...". */
export function isGenericTitle(title: string, siteName = '', url: string | null = null): boolean {
  const t = title.trim().toLowerCase();
  if (!t) return true;
  if (GENERIC_TITLES.has(t)) return true;
  const site = siteName.trim().toLowerCase();
  const domain = domainOf(url);
  return t === site || t === domain || t === `www.${domain}`;
}

/** Site icons (favicons) look bad stretched into a thumbnail. */
export const isIconImage = (src: string | null) => !!src && /\.ico(\?|$)|favicon/i.test(src);
