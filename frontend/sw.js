/**
 * sw.js — Service Worker
 *
 * キャッシュ戦略:
 *   - 静的アセット（HTML/JS）: Cache First（更新時はバージョンを上げて古いキャッシュを削除）
 *   - 動的データ（feeds/*.xml, accounts.json）: Network First（オフライン時のみキャッシュにフォールバック）
 *
 * CACHE_VERSION を上げると次回アクセス時に古いキャッシュが削除される。
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `x-feed-viewer-${CACHE_VERSION}`;

/** インストール時にキャッシュする静的アセット */
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/feed.js',
  '/manifest.json',
];

// ─── install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      // キャッシュ完了後に skipWaiting を呼ぶことで、キャッシュが不完全なまま
      // アクティベートされる競合状態を防ぐ
      .then(() => self.skipWaiting())
  );
});

// ─── activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    // CACHE_VERSION が古いキャッシュをすべて削除
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  // アクティベート後すぐに全クライアントを制御下に置く
  self.clients.claim();
});

// ─── fetch ────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // feeds/ と accounts.json は更新頻度が高いため Network First
  const isDynamic =
    url.pathname.startsWith('/feeds/') ||
    url.pathname === '/accounts.json';

  if (isDynamic) {
    event.respondWith(networkFirst(event.request));
  } else {
    event.respondWith(cacheFirst(event.request));
  }
});

/**
 * Network First: ネットワーク取得を試み、失敗したらキャッシュにフォールバック。
 * 成功した場合はキャッシュも更新する（次回オフライン時用）。
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    // エラーレスポンス（503, 404 等）はキャッシュしない。
    // キャッシュすると次回オフライン時にエラーが永続化してしまう。
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached ?? new Response('オフラインです。キャッシュがありません。', { status: 503 });
  }
}

/**
 * Cache First: キャッシュがあればそれを返し、なければネットワーク取得。
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  return cached ?? fetch(request);
}
