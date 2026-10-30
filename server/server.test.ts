import { describe, expect, it } from 'vitest';
import { checkUrl, isPrivateAddress } from './net';
import { decodeEntities, findOutboundLink, previewFromHtml } from './preview';

describe('isPrivateAddress', () => {
  it('blocks loopback, private ranges and cloud metadata', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.10', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '142.250.72.14', '2606:4700:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe('checkUrl', () => {
  it('rejects non-web schemes, credentials and private IP literals', () => {
    expect(() => checkUrl('file:///etc/passwd')).toThrow();
    expect(() => checkUrl('http://user:pw@example.com')).toThrow();
    expect(() => checkUrl('http://169.254.169.254/latest/meta-data')).toThrow();
    expect(() => checkUrl('http://example.com:6379')).toThrow();
    expect(checkUrl('https://example.com/a').hostname).toBe('example.com');
  });
});

describe('previewFromHtml', () => {
  it('reads Open Graph tags in any attribute order', () => {
    const html = `<html><head><title>Fallback</title>
      <meta content="The Illustrated Transformer" property="og:title">
      <meta property="og:description" content="Attention, &amp; more">
      <meta property="og:image" content="/img/cover.png">
      <meta name="author" content="Jay Alammar"></head></html>`;
    const p = previewFromHtml(html, 'https://jalammar.github.io/illustrated-transformer/');
    expect(p.title).toBe('The Illustrated Transformer');
    expect(p.description).toBe('Attention, & more');
    expect(p.image).toBe('https://jalammar.github.io/img/cover.png');
    expect(p.author).toBe('Jay Alammar');
    expect(p.siteName).toBe('jalammar.github.io');
  });
  it('falls back to <title>', () => {
    expect(previewFromHtml('<title> Hello  world </title>', 'https://a.com').title).toBe('Hello world');
  });
  it('decodes numeric entities', () => {
    expect(decodeEntities('it&#39;s &#x2014; ok')).toBe("it's — ok");
  });
});

describe('findOutboundLink', () => {
  it('follows LinkedIn short-link exit pages', () => {
    const html = `<title>LinkedIn</title><meta name="description" content="This link will take you to a page that’s not on LinkedIn">
      <a href="https://www.linkedin.com/legal">Terms</a><a data-tracking-control-name="external_url_click" href="https://www.interconnects.ai/p/open-source-ai-reading-list">go</a>`;
    expect(findOutboundLink(html, 'https://lnkd.in/abc')).toBe('https://www.interconnects.ai/p/open-source-ai-reading-list');
  });
  it('follows meta refresh with a url', () => {
    expect(findOutboundLink('<meta http-equiv="refresh" content="0; url=https://example.com/real">', 'https://t.co/x')).toBe('https://example.com/real');
  });
  it('ignores ordinary pages', () => {
    expect(findOutboundLink('<title>Hi</title><a href="https://other.com">x</a>', 'https://blog.com/post')).toBeNull();
  });
});
