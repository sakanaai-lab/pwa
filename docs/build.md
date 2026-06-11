# ビルドと開発フロー（Phase 1 以降）

Phase 1 でアプリのソースを **ESM モジュール化**し、esbuild でバンドルする方式に移行した。

## 重要: `app.js` は自動生成物になった

- **ソースは `src/` 配下**にある。
- ルート直下の `app.js` は `src/main.js` を起点に **esbuild が生成する配信用バンドル**。
  直接編集してはいけない（先頭にも警告コメントを出力している）。
- 静的配信（ビルド工程なしのホスティング）を維持するため、**生成された `app.js` もリポジトリにコミットする**。

## ディレクトリ構成

```
src/
  main.js              エントリ。function-calling → dropbox → app の順で読み込む
  app.js               アプリ本体（旧 app.js。今後フェーズを追って分割していく）
  function-calling.js  Function Calling 定義（旧 function-calling.js）
  dropbox.js           Dropbox 連携（旧 dropbox.js）
  utils/
    format.js          sleep / interruptibleSleep / formatFileSize / base64ToBlob
    html.js            htmlUtils（HTML/CSS エスケープ）
build.mjs              esbuild ビルドスクリプト
app.js                 ← 生成物（src/ から）。直接編集しない
```

## コマンド

```bash
npm install        # 依存（dev のみ）のインストール
npm run build      # src/ → app.js を生成
npm run build:watch  # src/ の変更を監視して自動ビルド
npm run lint       # ESLint（src/ を対象。生成物 app.js は対象外）
npm test           # Vitest（tests/ 配下のユニットテスト）
npm run format     # Prettier（新規コードのみ。レガシー大ファイルは .prettierignore で除外）
```

## ソースを変更したら

1. `src/` を編集する。
2. `npm run build` で `app.js` を再生成する。
3. `npm run lint` / `npm test` を通す。
4. **配信ファイル構成やキャッシュ対象を変えた場合**は、`sw.js` の `CACHE_NAME` と
   `index.html` のキャッシュバスター（`?v=...`）を更新する。
5. `src/` と生成された `app.js` を**両方**コミットする。

## バンドル方式の設計（挙動互換のための要点）

- `format: 'iife'`・`target: 'esnext'`（トランスパイル最小化）・`charset: 'utf8'`。
- 各モジュールは従来のクラシックスクリプトと同じく **`window.*` にAPIを公開**して連携する
  （`window.appLogic` / `window.state` / `window.dbUtils` / `window.functionCallingTools` /
  `window.dropboxApi` / `window.normalizeCharacterName` など）。
  モジュール間の参照は呼び出し時に `window.*` 経由で解決されるため、読み込み順に依存しない。
- `https://` からの動的 import（`@google/genai` 等）はバンドルせず、実行時にブラウザが解決する
  （`build.mjs` の `external` 設定）。

## 今後のモジュール分割（Phase 1 の続き〜Phase 3）

`src/app.js` は依然として大きい。`REFACTORING_PLAN.md` のとおり、神オブジェクト
（`dbUtils` / `uiUtils` / `apiUtils` / `appLogic`）や機能ドメイン単位で `src/` 配下へ
段階的に切り出していく。切り出しの進捗指標は、`eslint.config.js` で暫定的にグローバル宣言
している項目と、`src/app.js` 内の巨大関数が減っていくこと。
