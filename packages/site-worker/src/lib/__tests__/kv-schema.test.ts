import { describe, expect, it } from 'vitest';
import {
  siteLookupKey,
  siteConfigKey,
  siteConfigPrevKey,
  articleIndexKey,
  articleKey,
  syncStatusKey,
  sharedPageKey,
} from '../kv-schema';

describe('kv-schema key builders', () => {
  it('siteLookupKey prefixes hostname with `site:`', () => {
    expect(siteLookupKey('coolnews.dev')).toBe('site:coolnews.dev');
  });

  it('siteLookupKey is case-preserving (caller is expected to lowercase first)', () => {
    // The middleware normaliseHostname() lowercases — keys are what they
    // are. This test pins the contract so a future "helpfully lowercase"
    // edit is intentional, not accidental.
    expect(siteLookupKey('CoolNews.Dev')).toBe('site:CoolNews.Dev');
  });

  it('siteConfigKey + siteConfigPrevKey share the siteId tail', () => {
    expect(siteConfigKey('coolnews-atl')).toBe('site-config:coolnews-atl');
    expect(siteConfigPrevKey('coolnews-atl')).toBe('site-config-prev:coolnews-atl');
  });

  it('articleIndexKey uses the canonical prefix', () => {
    expect(articleIndexKey('scienceworld')).toBe('article-index:scienceworld');
  });

  it('articleKey nests siteId + slug', () => {
    expect(articleKey('coolnews-atl', 'lobsters-feel-pain')).toBe(
      'article:coolnews-atl:lobsters-feel-pain',
    );
  });

  it('sharedPageKey nests siteId + page slug', () => {
    expect(sharedPageKey('coolnews-atl', 'about')).toBe('shared-page:coolnews-atl:about');
  });

  it('syncStatusKey uses the canonical prefix', () => {
    expect(syncStatusKey('coolnews-atl')).toBe('sync-status:coolnews-atl');
  });

  it('all key builders are pure (return same output for same input)', () => {
    const inputs = [
      ['siteLookupKey', () => siteLookupKey('coolnews.dev')],
      ['siteConfigKey', () => siteConfigKey('coolnews-atl')],
      ['articleIndexKey', () => articleIndexKey('coolnews-atl')],
      ['articleKey', () => articleKey('coolnews-atl', 'foo')],
      ['sharedPageKey', () => sharedPageKey('coolnews-atl', 'about')],
      ['syncStatusKey', () => syncStatusKey('coolnews-atl')],
    ] as const;
    for (const [name, fn] of inputs) {
      const a = fn();
      const b = fn();
      expect(a, `${name} idempotency`).toBe(b);
    }
  });

  it('keys never contain spaces (KV keys must be URL-safe)', () => {
    const keys = [
      siteLookupKey('foo.example.com'),
      siteConfigKey('cool-news_v2'),
      articleIndexKey('site-with-dashes'),
      articleKey('site', 'slug-with-dashes'),
      sharedPageKey('site', 'about-us'),
      syncStatusKey('site'),
    ];
    for (const k of keys) {
      expect(k).not.toMatch(/\s/);
    }
  });
});
