/**
 * app.js — フロントエンドのエントリポイント
 *
 * accounts.json を読み込み → 各アカウントの RSS を並列取得 → 描画。
 * ロジックは feed.js に集約し、このファイルは DOM 操作に専念する。
 */

import { parseRSSItems, sortByDate, filterByUsername, formatDate } from './feed.js';

/** 全アカウントのポストをマージしたキャッシュ（フィルタリング時に再利用） */
let allPosts = [];

/** accounts.json から読み込んだアカウント一覧 */
let accounts = [];

/** 現在アクティブなフィルタ（null = すべて表示） */
let activeFilter = null;

// ─── 初期化 ───────────────────────────────────────────────────────────────────

async function init() {
  try {
    const res = await fetch('./accounts.json');
    if (!res.ok) throw new Error(`accounts.json fetch failed: ${res.status}`);
    const data = await res.json();
    accounts = data.accounts ?? [];

    renderFilters();
    await loadFeeds();
  } catch (e) {
    showError('アカウント情報の読み込みに失敗しました。');
    console.error(e);
  }
}

// ─── RSS 取得 ─────────────────────────────────────────────────────────────────

async function loadFeeds() {
  // 全アカウントを並列取得し、失敗したものは無視して続行する
  const results = await Promise.allSettled(
    accounts.map(async ({ username }) => {
      const res = await fetch(`./feeds/${username}.xml`);
      if (!res.ok) throw new Error(`feed fetch failed for ${username}: ${res.status}`);
      const xml = await res.text();
      return parseRSSItems(xml, username);
    })
  );

  allPosts = sortByDate(
    results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value)
  );

  renderPosts();
}

// ─── 描画 ─────────────────────────────────────────────────────────────────────

function renderFilters() {
  const container = document.getElementById('filters');
  container.innerHTML = '';

  // 「すべて」ボタン（username = null）
  container.appendChild(createFilterBtn('すべて', null));

  accounts.forEach(({ username, display_name }) => {
    container.appendChild(createFilterBtn(display_name || username, username));
  });
}

/**
 * フィルタボタンを生成して返す。
 * クリック時にアクティブ状態を切り替えて再描画する。
 *
 * @param {string} label
 * @param {string | null} username
 * @returns {HTMLButtonElement}
 */
function createFilterBtn(label, username) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.className = 'filter-btn' + (activeFilter === username ? ' active' : '');
  btn.addEventListener('click', () => {
    activeFilter = username;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderPosts();
  });
  return btn;
}

/**
 * URL が https: または http: スキームであることを検証する。
 * RSS フィードのリンクに javascript: スキームが含まれていた場合、
 * escapeHtml ではエスケープできず href に展開されるとクリック時に実行される。
 *
 * @param {string} url
 * @returns {boolean}
 */
function isSafeUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function renderPosts() {
  const container = document.getElementById('posts');
  const posts = filterByUsername(allPosts, activeFilter);

  if (posts.length === 0) {
    container.innerHTML = '<p class="empty">ポストがありません。</p>';
    return;
  }

  container.innerHTML = '';
  const fragment = document.createDocumentFragment();

  posts.forEach(post => {
    const el = document.createElement('article');
    el.className = 'post';

    // meta（ユーザー名・日付）は escapeHtml 済みの値のみ含むため template literal で構築
    const meta = document.createElement('div');
    meta.className = 'post-meta';
    meta.innerHTML = `
      <span class="username">@${escapeHtml(post.username)}</span>
      <span class="date">${formatDate(post.pubDate)}</span>
    `;

    // コンテンツは nitter の HTML 構造を保持しつつ sanitizeHTML で危険な要素を除去して挿入
    const content = document.createElement('div');
    content.className = 'post-content';
    content.innerHTML = sanitizeHTML(post.description) || `<p>${escapeHtml(post.title)}</p>`;

    el.appendChild(meta);
    el.appendChild(content);
    fragment.appendChild(el);
  });

  container.appendChild(fragment);
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

/**
 * HTML を安全な状態にして返す（Option B: 構造を保持しつつ危険な要素・属性を除去）。
 *
 * 除去対象:
 *   - <script> <style> <iframe> <object> <embed> <form>
 *   - on* 属性（onerror, onclick など）
 *   - href / src の javascript: スキーム
 *
 * @param {string} html
 * @returns {string} サニタイズ済み HTML 文字列
 */
function sanitizeHTML(html) {
  const div = document.createElement('div');
  div.innerHTML = html;

  // 危険な要素を削除。blockquote は引用ポストなので表示不要のため合わせて除去する
  div.querySelectorAll('script, style, iframe, object, embed, form, blockquote').forEach(el => el.remove());

  div.querySelectorAll('*').forEach(el => {
    // on* 属性（イベントハンドラ）を削除
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    }
    // <a href> の javascript: スキームを無効化
    if (el.tagName === 'A') {
      if (!isSafeUrl(el.getAttribute('href') ?? '')) el.setAttribute('href', '#');
      // _blank リンクは必ず noopener を付与
      if (el.getAttribute('target') === '_blank') el.setAttribute('rel', 'noopener noreferrer');
    }
    // <img src> の javascript: スキームを無効化
    if (el.tagName === 'IMG' && !isSafeUrl(el.getAttribute('src') ?? '')) {
      el.removeAttribute('src');
    }
  });

  return div.innerHTML;
}

/**
 * HTML 特殊文字をエスケープする。
 * innerHTML に動的な文字列を挿入する箇所で必ず使用すること。
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showError(msg) {
  // innerHTML ではなく textContent を使うことで、msg に HTML が混入しても XSS にならない
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = msg;
  const container = document.getElementById('posts');
  container.innerHTML = '';
  container.appendChild(p);
}

// ─── 起動 ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

// Service Worker 登録（HTTPS 環境でのみ有効）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(err => {
    console.warn('Service Worker の登録に失敗しました:', err);
  });
}
