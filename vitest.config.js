import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom を使うことで DOMParser・document などのブラウザ API をテスト内で利用できる。
    // feed.js の parseRSSItems は DOMParser に依存しているため必須。
    environment: 'jsdom',
  },
});
