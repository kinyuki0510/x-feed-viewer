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

    // description には HTML が含まれることがある（nitter の CDATA）ため
    // stripHTML でテキストのみ抽出して XSS を防ぐ
    const text = stripHTML(post.description) || post.title;

    // javascript: スキームを含むリンクはクリック時にスクリプトが実行されるため # に差し替える
    const safeLink = isSafeUrl(post.link) ? escapeHtml(post.link) : '#';

    el.innerHTML = `
      <div class="post-meta">
        <span class="username">@${escapeHtml(post.username)}</span>
        <span class="date">${formatDate(post.pubDate)}</span>
      </div>
      <p class="post-text">${escapeHtml(text)}</p>
      <a class="post-link" href="${safeLink}" target="_blank" rel="noopener noreferrer">元のポスト →</a>
    `;
    fragment.appendChild(el);
  });

  container.appendChild(fragment);
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

/**
 * HTML タグを除去してプレーンテキストを返す。
 * innerHTML に代入することで jsdom / ブラウザのパーサーにサニタイズさせる。
 *
 * @param {string} html
 * @returns {string}
 */
function stripHTML(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
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
