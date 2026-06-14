# アーキテクチャ概要（開発者向け）

ユーザー向けの使い方は `README.md`、DBスキーマは `docs/db-schema.md`、ビルドは
`docs/build.md` を参照。本書は**コード構造と設計パターン**をまとめる（リファクタリング
Phase 1〜6 で到達した状態）。

## 全体像

静的 PWA（バックエンドなし）。`sakanaai-lab.github.io` で配信され、各ユーザーの
ブラウザ内（IndexedDB / localStorage）で完結する。複数の AI プロバイダーに
**ブラウザから直接** リクエストする。

```
index.html ──┬─ marked.js / purify.min.js / prism.js（vendored, グローバル）
             └─ app.js（esbuild バンドル / 自動生成物・編集禁止）
                    ▲
                    │ esbuild（build.mjs）
                 src/main.js → src/ 配下の ESM モジュール群
```

- **ソースは `src/` 配下の ESM**。ルートの `app.js` は `build.mjs`（esbuild）が
  `src/main.js` から生成する**配信用バンドル**で、直接編集しない（lint 対象外）。
- 開発フロー・ビルドコマンドは `docs/build.md`。

## モジュール構成（`src/`）

| ファイル/ディレクトリ | 役割 |
|---|---|
| `main.js` | バンドルのエントリ。各モジュールを取り込む |
| `app.js` | 起動・UI配線・プロジェクト管理など（バンドル前のソース側 app.js） |
| `constants.js` | 定数（DB名/版、モデル一覧、エンドポイント、ストレージキー等） |
| `state.js` | 単一の `state` シングルトン（`window.state` に公開） |
| `dom-elements.js` | DOM 参照（`elements`） |
| `db.js` | `dbUtils`: IndexedDB アクセス層 |
| `db-migrations.js` | `applyDbMigrations`: スキーマ定義＋マイグレーション（テスト可能な純粋関数） |
| `api.js` | `apiUtils`: プロバイダー層（後述） |
| `app-logic.js` | `appLogic` の **バレル**（機能モジュールを合成） |
| `app-logic/*.js` | `appLogic` の機能別モジュール（後述） |
| `ui.js` | `uiUtils`: 描画・ダイアログ等 |
| `function-calling.js` | Function Calling ツール実装 |
| `dropbox.js` | Dropbox 連携（OAuth PKCE / 同期） |
| `debug-logger.js` | `DebugLogger`: ログ捕捉（後述） |
| `mime-types.js` | 拡張子→MIME 表 |
| `utils/format.js`, `utils/html.js` | 純粋ユーティリティ（ユニットテスト対象） |

主要オブジェクトは `window.*` にも公開され（`window.state`, `window.appLogic`,
`window.dbUtils` 等）、モジュール間はインポートのライブバインディングと併用される。

## 設計パターン

### 1. プロバイダー層（`api.js`）— アダプタ＋単一ディスパッチャ（Phase 2）
`apiUtils.callApi()` が `state.settings.apiProvider` を見て各アダプタへ振り分ける
単一の `switch`。全プロバイダーは Gemini 形式の messages を入出力に統一変換する。

- OpenAI 互換（Z.ai / OpenRouter）は設定駆動の共通アダプタ
  `_callOpenAICompatibleWithTools(cfg, …)` に集約（URL/キー/ヘッダ/エラー処理は `cfg`）。
- groq / deepseek / xai / mistral は `callOpenAICompatibleApi(...)`。
- gemini / bedrock / openai / anthropic は専用アダプタ。
- プロジェクトのナレッジ注入も `callApi` 先頭に集約（旧 app.js モンキーパッチは廃止）。

### 2. `appLogic` の合成（Phase 3）
巨大だった `appLogic` を機能別モジュール（`profile` / `lifecycle` / `sync` / `chat` /
`message` / `attachment` / `media` / `memory`）に分割し、`app-logic.js` バレルで
`Object.assign({}, …)` して**単一オブジェクトに合成**する。全メソッドが同一オブジェクトに
乗るため、`this.xxx()` の相互参照は従来どおり解決される。

### 3. データ層（`db.js` / `db-migrations.js`）（Phase 4）
スキーマ作成とバージョン移行は `applyDbMigrations` に分離し、アプリ本体に依存しない
純粋関数として `fake-indexeddb` でテスト可能（`tests/db-migrations.test.js`）。
詳細は `docs/db-schema.md`。

### 4. 安全な Markdown 描画（セキュリティ）
AI 応答やインポート由来テキストを `innerHTML` に入れる際は
`htmlUtils.renderMarkdownSafe()`（`marked` → `DOMPurify.sanitize`）を通す。
加えて `marked` のカスタムレンダラが生 HTML をエスケープし `javascript:` リンクを
遮断する**多層防御**。

### 5. ログ（`DebugLogger`）
`DebugLogger.init()` はデバッグモード時に `console.*` を**グローバルにパッチ**して
内部バッファへ捕捉する（個々の呼び出しを書き換える必要はない）。

## テスト / 品質

- `npm test`（Vitest + jsdom + fake-indexeddb）: `tests/` 配下。utils / DB マイグレーション等。
- `npm run lint`（ESLint 9）: `src/**` が対象。**errors 0**（Phase 6 でベースライン解消）。
  warnings は段階的に解消中。
- `npm run build`（esbuild）: `src/main.js` → ルート `app.js`。
- SW 更新時は `sw.js` の `CACHE_NAME` を上げる（バンドル配信のため）。

## 注意点 / 慣習

- ルート `app.js` は**生成物**。変更は必ず `src/` 側で行いビルドする。
- グローバル結合は `window.*` 経由かつ呼び出し時評価（読み込み順非依存）。
- `marked` / `DOMPurify` / `Prism` / `JSZip` 等は `index.html` で読み込むグローバル
  （ESLint の globals に登録済み）。
