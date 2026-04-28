/**
 * feed.js — RSS フィードの純粋ロジック層
 *
 * DOM 操作を一切持たず、ブラウザ・テスト環境どちらでも動作する。
 * app.js はここでパースされたデータを受け取って描画する。
 */

/**
 * RSS XML 文字列をパースしてポスト配列に変換する。
 *
 * nitter の RSS は <item> の <link> がテキストノードではなく
 * タグの次のテキストノードとして返ってくる場合があるが、
 * querySelector('link').textContent で問題なく取得できる。
 *
 * @param {string} xmlString - nitter から取得した RSS XML 文字列
 * @param {string} username  - どのアカウントのフィードか（フィルタリングに使用）
 * @returns {{ username: string, title: string, link: string, pubDate: Date, description: string }[]}
 */
export function parseRSSItems(xmlString, username) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  // パースエラー時は空配列を返す（nitter が HTML エラーページを返した場合など）
  if (doc.querySelector('parsererror')) return [];

  return Array.from(doc.querySelectorAll('item')).map(item => ({
    username,
    title: item.querySelector('title')?.textContent ?? '',
    link: item.querySelector('link')?.textContent ?? '',
    pubDate: new Date(item.querySelector('pubDate')?.textContent ?? ''),
    // description は CDATA セクションで HTML が含まれることがある（app.js 側で stripHTML する）
    description: item.querySelector('description')?.textContent ?? '',
  // Invalid Date のアイテムは sortByDate で NaN 比較になりソート結果が不定になるため除外する
  })).filter(item => !isNaN(item.pubDate.getTime()));
}

/**
 * ポスト配列を pubDate の降順（新しい順）に並び替える。
 * 元の配列を破壊しないようスプレッド構文でコピーしてからソートする。
 *
 * @param {{ pubDate: Date }[]} posts
 * @returns {{ pubDate: Date }[]}
 */
export function sortByDate(posts) {
  return [...posts].sort((a, b) => b.pubDate - a.pubDate);
}

/**
 * 特定のユーザー名でフィルタリングする。
 * username が null / undefined / 空文字の場合は全件返す（「すべて」ボタン用）。
 *
 * @param {{ username: string }[]} posts
 * @param {string | null} username
 * @returns {{ username: string }[]}
 */
export function filterByUsername(posts, username) {
  if (!username) return posts;
  return posts.filter(post => post.username === username);
}

/**
 * Date オブジェクトを日本語ロケールの表示文字列に変換する。
 * Invalid Date の場合は空文字を返す。
 *
 * @param {Date} date
 * @returns {string} 例: "2024/01/15 12:00"
 */
export function formatDate(date) {
  if (isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
