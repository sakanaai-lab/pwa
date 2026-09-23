作業手順は [AGENTS.md](./AGENTS.md) にまとめてある。編集を始める前に読むこと。

特に忘れやすいのは次の3つ。どれもエラーにならないまま間違った結果になる。

1. `src/` を編集したら `npm run build` で `app.js` を作り直し、それもコミットする
2. `sw.js` の `CACHE_NAME` と `index.html` の `app.js?v=` を上げる
3. `src/utils/pricing.js` は前方一致なので、具体的なキーを短いキーより先に置く
