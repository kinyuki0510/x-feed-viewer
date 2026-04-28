# フロントエンド コードレビュー記録

**対象**: `frontend/` 以下の全ファイル  
**レビュアー**: Claude (主担当) / 一般レビューエージェント / セキュリティレビューエージェント  
**観点**: 機能・セキュリティ（秘匿情報含む）・アーキテクチャ・可読性・コスト

---

## 凡例

| 記号 | 意味 |
|---|---|
| ✅ 対応する | 修正必要と判断 |
| ❌ 対応しない | 現スコープ・規模では不要と判断 |
| 📝 記録のみ | 現時点では放置するが認識は共有 |
| 🔴 high / 🟡 medium / 🟢 low | 深刻度 |
| 👥 | 複数レビュアーが指摘（信頼度高） |

---

## セキュリティ

### 🔴 [✅ 対応する] `javascript:` URI による XSS 👥

**指摘者**: 全3者一致  
**箇所**: `app.js` `renderPosts` — `href="${escapeHtml(post.link)}"`  
**内容**: `escapeHtml` は `j`, `a`, `v` 等を変換しないため `javascript:alert(1)` がそのまま属性に展開される。クリック時にスクリプトが実行される。  
**対応**: `isSafeUrl` 関数を追加し `https:` / `http:` 以外を `#` に差し替える。

```js
function isSafeUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
```

---

### 🔴 [✅ 対応する] CSP（Content Security Policy）未設定 👥

**指摘者**: Claude + セキュリティエージェント  
**箇所**: `index.html` / CloudFront 設定  
**内容**: XSS が成立した際のダメージコントロールが皆無。  
**対応**: Terraform の CloudFront に `aws_cloudfront_response_headers_policy` を追加し HTTP ヘッダで設定する（`<meta>` タグより HTTP ヘッダが優先されるため）。  
**備考**: フロントエンドではなく Terraform 側の修正になる。本 review 記録に留め Terraform レビュー時に対応する。

---

### 🟡 [✅ 対応する] `showError` が innerHTML に未エスケープ文字列を挿入 👥

**指摘者**: Claude + セキュリティエージェント  
**箇所**: `app.js` `showError(msg)`  
**内容**: 現状 `msg` はハードコード文字列のみだが、将来的に動的な値が渡された場合 XSS になる構造的欠陥。  
**対応**: `textContent` に変更する。

```js
function showError(msg) {
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = msg;
  const container = document.getElementById('posts');
  container.innerHTML = '';
  container.appendChild(p);
}
```

---

### 🟡 [✅ 対応する] `networkFirst` がエラーレスポンスをキャッシュする

**指摘者**: セキュリティエージェント  
**箇所**: `sw.js` `networkFirst`  
**内容**: `response.ok` チェックなしにキャッシュへ書き込むため、503/404 等がキャッシュされ以降のオフライン時にエラーが永続化する。  
**対応**: `response.ok` の場合のみ `cache.put` する。

---

### 🟡 [📝 記録のみ] `stripHTML` の `div.innerHTML` 代入時の副作用

**指摘者**: セキュリティエージェント  
**箇所**: `app.js` `stripHTML`  
**内容**: `<img src=x onerror=...>` のようなペイロードは、detached な div への `innerHTML` 代入時にリソースロードが発生し `onerror` が実行される可能性がある（ブラウザ依存）。  
**判断**: 現ブラウザ実装では detached 要素のリソースロードは一般に発生しない。DOMPurify 導入は依存追加になりスコープ超過。認識の上で現状維持。  
**条件付き再検討**: nitter 以外の RSS ソースを追加する場合は再評価する。

---

### ✅ [問題なし] 秘匿情報のコミット

**指摘者**: セキュリティエージェント  
**内容**: API キー・トークン類はコード中に存在しない。`accounts.json` も S3 fetch であり Git 管理外。問題なし。

---

## 機能

### 🟡 [✅ 対応する] `sortByDate` が Invalid Date を含む場合ソート結果が不定 👥

**指摘者**: Claude + 一般エージェント  
**箇所**: `feed.js` `sortByDate` / `parseRSSItems`  
**内容**: `b.pubDate - a.pubDate` が `NaN` になりソート順が不定になる。  
**対応**: `parseRSSItems` で Invalid Date のアイテムを除外する。

```js
pubDate: new Date(item.querySelector('pubDate')?.textContent ?? ''),
// パース後に filter で除外
}).filter(item => !isNaN(item.pubDate.getTime()));
```

---

### 🟡 [✅ 対応する] `skipWaiting` が `waitUntil` の外にある

**指摘者**: 一般エージェント  
**箇所**: `sw.js` install イベント  
**内容**: `skipWaiting()` がキャッシュ完了前に実行される可能性がある（`addAll` の完了を待たない）。  
**対応**: `addAll` チェーンの末尾に移動する。

```js
event.waitUntil(
  caches.open(CACHE_NAME)
    .then(cache => cache.addAll(STATIC_ASSETS))
    .then(() => self.skipWaiting())
);
```

---

### 🟢 [📝 記録のみ] 一部フィード取得失敗がユーザーに通知されない

**指摘者**: 一般エージェント  
**箇所**: `app.js` `loadFeeds`  
**内容**: `Promise.allSettled` の `rejected` 結果を無視するため、フィード取得部分失敗がサイレント。  
**判断**: このアプリは個人用途・閲覧専用のため、部分失敗時のサイレント継続は許容範囲。`console.warn` の追加は検討余地あり。現状維持。

---

## アーキテクチャ

### 🟢 [❌ 対応しない] グローバルなミュータブル状態

**指摘者**: 一般エージェント  
**内容**: `allPosts`, `accounts`, `activeFilter` がモジュールスコープの `let`。  
**判断**: 最大10アカウントの個人用ツール。状態管理ライブラリの導入は過剰設計。現状維持。

---

### 🟢 [❌ 対応しない] `renderPosts` がフィルタ適用と DOM 構築を一体化

**指摘者**: 一般エージェント  
**内容**: 関数の単一責任原則からは外れる。  
**判断**: テストは `feed.js` の純関数側でカバーしており、`renderPosts` の DOM 結合テストは費用対効果が低い。現状維持。

---

### 🟢 [❌ 対応しない] 条件付きリクエスト（ETag / 304）未使用

**指摘者**: 一般エージェント  
**内容**: 毎回フルリクエストになり転送量が増える。  
**判断**: RSS XML のサイズは数十KB以下。月40リクエスト程度で $1 未満の要件を満たしており最適化不要。現状維持。

---

## 可読性

### 🟢 [📝 記録のみ] `STATIC_ASSETS` がハードコードでファイル追加時に更新漏れリスク

**指摘者**: 一般エージェント + セキュリティエージェント  
**内容**: `sw.js` の `STATIC_ASSETS` 配列を手動管理している。  
**判断**: ビルドステップなし・ファイル数が少ない構成では許容範囲。`sw.js` のコメントに「ファイル追加時は要更新」を追記することで対応とする。

---

### 🟢 [❌ 対応しない] `stripHTML` の命名

**指摘者**: 一般エージェント  
**内容**: `extractTextContent` の方が実装意図に合致する。  
**判断**: 意味は通じており、リネームによる改善効果が小さい。現状維持。

---

## コスト

### 🟢 [❌ 対応しない] フィルタ切り替えのたびに全記事を再描画

**指摘者**: 一般エージェント  
**内容**: 記事数が増えると DOM 操作が重くなる。  
**判断**: 最大10アカウント × RSS件数（通常20件前後）で合計200件以下。体感上の問題なし。現状維持。

---

## 対応一覧サマリー

| # | 深刻度 | 対応 | 内容 | ファイル |
|---|---|---|---|---|
| 1 | 🔴 | ✅ | `javascript:` URI XSS → `isSafeUrl` 追加 | `app.js` |
| 2 | 🔴 | ✅ | CSP 設定 | `terraform/main.tf` |
| 3 | 🟡 | ✅ | `showError` を `textContent` に変更 | `app.js` |
| 4 | 🟡 | ✅ | `networkFirst` に `response.ok` チェック追加 | `sw.js` |
| 5 | 🟡 | ✅ | Invalid Date アイテムを `parseRSSItems` で除外 | `feed.js` |
| 6 | 🟡 | ✅ | `skipWaiting` を `waitUntil` チェーン内に移動 | `sw.js` |
