/**
 * feed.test.js — feed.js の純粋ロジックに対するユニットテスト
 *
 * DOM 描画（app.js）はテストしない。
 * vitest.config.js で environment: 'jsdom' を設定しているため
 * DOMParser が利用可能。
 */

import { describe, it, expect } from 'vitest';
import { parseRSSItems, sortByDate, filterByUsername, formatDate } from '../frontend/feed.js';

/** nitter が返す RSS XML の最小構成サンプル */
const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test User / nitter</title>
    <item>
      <title>Hello World</title>
      <link>https://nitter.net/testuser/status/1</link>
      <pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate>
      <description><![CDATA[Hello World]]></description>
    </item>
    <item>
      <title>Second Post</title>
      <link>https://nitter.net/testuser/status/2</link>
      <pubDate>Tue, 02 Jan 2024 12:00:00 +0000</pubDate>
      <description><![CDATA[Second Post]]></description>
    </item>
  </channel>
</rss>`;

// ─── parseRSSItems ────────────────────────────────────────────────────────────

describe('parseRSSItems', () => {
  it('正常な RSS XML をパースして item 配列を返す', () => {
    const items = parseRSSItems(SAMPLE_RSS, 'testuser');
    expect(items).toHaveLength(2);
    expect(items[0].username).toBe('testuser');
    expect(items[0].title).toBe('Hello World');
    expect(items[0].link).toBe('https://nitter.net/testuser/status/1');
  });

  it('pubDate を Date オブジェクトに変換する', () => {
    const items = parseRSSItems(SAMPLE_RSS, 'testuser');
    expect(items[0].pubDate).toBeInstanceOf(Date);
    expect(isNaN(items[0].pubDate.getTime())).toBe(false);
  });

  it('不正な XML（parsererror）は空配列を返す', () => {
    // nitter がエラーページ（HTML）を返した場合を想定
    const items = parseRSSItems('this is not xml at all <<<', 'testuser');
    expect(items).toEqual([]);
  });

  it('<item> が存在しない RSS は空配列を返す', () => {
    const emptyRss = `<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>`;
    const items = parseRSSItems(emptyRss, 'testuser');
    expect(items).toEqual([]);
  });

  it('空文字列は空配列を返す', () => {
    const items = parseRSSItems('', 'testuser');
    expect(items).toEqual([]);
  });

  it('pubDate が不正な item は除外される（sortByDate での NaN 混入防止）', () => {
    const rssWithInvalidDate = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Valid Post</title>
      <link>https://nitter.net/testuser/status/1</link>
      <pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate>
      <description>Valid</description>
    </item>
    <item>
      <title>Invalid Date Post</title>
      <link>https://nitter.net/testuser/status/2</link>
      <pubDate>not-a-date</pubDate>
      <description>Invalid</description>
    </item>
  </channel>
</rss>`;
    const items = parseRSSItems(rssWithInvalidDate, 'testuser');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Valid Post');
  });
});

// ─── sortByDate ───────────────────────────────────────────────────────────────

describe('sortByDate', () => {
  it('新しい日付が先頭になるよう降順に並び替える', () => {
    const posts = [
      { pubDate: new Date('2024-01-01') },
      { pubDate: new Date('2024-01-03') },
      { pubDate: new Date('2024-01-02') },
    ];
    const sorted = sortByDate(posts);
    expect(sorted[0].pubDate).toEqual(new Date('2024-01-03'));
    expect(sorted[1].pubDate).toEqual(new Date('2024-01-02'));
    expect(sorted[2].pubDate).toEqual(new Date('2024-01-01'));
  });

  it('元の配列を破壊しない（イミュータブル）', () => {
    const posts = [
      { pubDate: new Date('2024-01-01') },
      { pubDate: new Date('2024-01-02') },
    ];
    const original = [...posts];
    sortByDate(posts);
    expect(posts).toEqual(original);
  });

  it('1件の場合はそのまま返す', () => {
    const posts = [{ pubDate: new Date('2024-01-01') }];
    expect(sortByDate(posts)).toHaveLength(1);
  });
});

// ─── filterByUsername ─────────────────────────────────────────────────────────

describe('filterByUsername', () => {
  const posts = [
    { username: 'alice', title: 'A1' },
    { username: 'bob',   title: 'B1' },
    { username: 'alice', title: 'A2' },
  ];

  it('指定したユーザーのポストのみ返す', () => {
    const filtered = filterByUsername(posts, 'alice');
    expect(filtered).toHaveLength(2);
    expect(filtered.every(p => p.username === 'alice')).toBe(true);
  });

  it('null を渡すと全件返す（「すべて」フィルタ）', () => {
    expect(filterByUsername(posts, null)).toHaveLength(3);
  });

  it('空文字を渡すと全件返す', () => {
    expect(filterByUsername(posts, '')).toHaveLength(3);
  });

  it('存在しないユーザーは空配列を返す', () => {
    expect(filterByUsername(posts, 'nobody')).toHaveLength(0);
  });
});

// ─── formatDate ───────────────────────────────────────────────────────────────

describe('formatDate', () => {
  it('有効な Date を日本語形式の文字列にフォーマットする', () => {
    const date = new Date('2024-01-15T12:00:00Z');
    const result = formatDate(date);
    // タイムゾーン依存を避けるため、年だけ検証
    expect(result).toContain('2024');
  });

  it('Invalid Date は空文字を返す', () => {
    expect(formatDate(new Date('invalid'))).toBe('');
  });
});
