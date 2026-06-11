# Aquarium Chat 完全リファクタリング計画

> 本ドキュメントは、長年の機能追加で肥大化したコードベースを、**挙動を一切変えずに**段階的に整理するための実行計画です。
> 各フェーズは独立してマージ可能で、いつ中断しても動作する状態を保ちます。

---

## 0. 現状分析（リファクタリング対象の「無駄」の実態）

調査により定量化した問題点。これがプランの根拠になります。

### 0.1 ファイル構成と規模

| ファイル | 行数 | サイズ | 問題 |
|---|---|---|---|
| `app.js` | **14,638** | **747 KB** | 単一ファイルにアプリ全体が同居 |
| `function-calling.js` | 1,327 | 70 KB | `window.functionCallingTools` 経由で `app.js` と暗黙結合 |
| `dropbox.js` | 468 | 19 KB | `window.dropboxApi` / `window.dbUtils` 経由で結合 |
| `index.html` | 1,125 | 81 KB | インラインの `<script>`/`<style>` ブロックが7箇所 |
| `style.css` | 3,021 | 86 KB | 537セレクタ、`!important` 10箇所、重複多数 |
| `sw.js` | 148 | — | キャッシュ名を手動でバージョン更新（`v1.25.1`） |

**ビルド/テスト/Lint ツールは一切なし**（`package.json` 不在）。静的ファイルをそのまま配信する純粋な PWA。

### 0.2 `app.js` 内部の構造的問題

- **4つの神オブジェクト**にロジックが集中:
  - `dbUtils`（約900行）— IndexedDB 操作
  - `uiUtils`（約1,700行）— DOM/描画
  - `apiUtils`（約1,340行）— API 通信
  - `appLogic`（**約8,350行 / 225メソッド**）— 事実上のアプリ本体。あらゆる機能が雑多に同居
- **巨大関数**:
  - `appLogic.setupEventListeners()` — **938行**
  - `appLogic.initializeApp()` — 403行
  - `apiUtils.callGeminiApi()` — 305行
  - `appLogic.proofreadText()` / `_improveSdPrompt()` / `handleBackgroundImageUrl()` など 200〜425行級が多数
- **グローバル汚染**: `window.appLogic` / `window.state` / `window.dbUtils` などをグローバルに公開し、ファイル間がこれに依存。

### 0.3 マルチプロバイダー層の重複（最大の負債）

9プロバイダー（Gemini / Z.ai / OpenRouter / Bedrock / OpenAI / Anthropic / Groq / DeepSeek / xAI / Mistral）対応だが:

- プロバイダー分岐の `if/else` チェーンが**少なくとも4箇所に散在**（`5840`, `5939`, `11825`, `14214` 行付近）。
- `callZaiApi()` という名前の関数が、実際には **OpenAI互換7プロバイダー全て**を処理している（命名と実態の乖離）。
- `callApi()` のディスパッチは `zai / openrouter / bedrock / gemini` の4分岐のみで、他プロバイダーの経路が読み手に追えない。
- フォーマット変換（`convertGeminiToOpenAIFormat` 等）がプロバイダーごとに点在。

### 0.4 後付けによる「モンキーパッチ」

ファイル末尾の IIFE（`13343`, `13427` 行〜）で、**定義済みのコアオブジェクトを実行時に書き換え**ている:

```js
window.dbUtils.getAllProjects = async () => { ... }   // dbUtils にメソッドを後付け
window.dbUtils.addProject     = async (p) => { ... }
window.dbUtils.getAllChats    = async function(...) { ... }  // 既存メソッドを上書き
window.appLogic.startNewChat  = function() { ... }           // 既存メソッドを上書き
```

プロジェクト管理機能・ヘッダーモデル切替がこの方式で「外付け」されており、本体の挙動が分散して追跡困難。

### 0.5 細かい蓄積物

- `console.*` 呼び出し **540箇所**（デバッグログが本番に残存。`DebugLogger` 機構があるのに未統一）
- `TODO/FIXME/旧/不要/未使用/DEPRECATED` 等のマーカー **約50箇所**
- 空の `catch {}` ブロック **8箇所**（エラー握り潰し）
- 200文字超の行 **64行**
- IndexedDB は **DB_VERSION 15**。`onupgradeneeded` に v10〜v15 のマイグレーションが累積（一部 `projects_temp` など暫定的なストア）。

### 0.6 リファクタリングの制約（重要）

1. **挙動の完全互換**: 既存ユーザーの IndexedDB データ（チャット・プロファイル・設定）を壊さない。DBスキーマ変更は厳禁、もしくは慎重なマイグレーション必須。
2. **静的配信を維持**: 現状ビルド不要。ビルド工程を導入する場合も、最終成果物は静的ファイルとして配信できること（GitHub Pages 等を想定）。
3. **Service Worker キャッシュ**: 配信ファイル構成を変えたら `sw.js` の `CACHE_NAME` と `urlsToCache`、各所のキャッシュバスター（`?v=1.25`）を必ず更新。
4. **オフライン動作**: SW のキャッシュ対象が漏れると PWA が壊れる。

---

## リファクタリング方針

- **挙動不変（behavior-preserving）を最優先**。1コミット＝1意味、機械的変換と設計変更を混ぜない。
- 各フェーズ末で**動作確認チェックリスト**（後述）を全項目パスさせてからマージ。
- 大規模な「全部書き直し」はしない。**ストラングラー方式**で、動いている部分を残しつつ内側から置換。
- フェーズは原則この順。ただし Phase 0 と 2 は他に先行して着手可能。

---

## Phase 0 — 安全網の構築（挙動変更ゼロ）

**目的**: リファクタリングで壊れたことを検知できる土台を作る。これ無しに以降へ進まない。

### 作業
1. **開発ツールの導入**（配信物には影響させない）
   - `package.json` を新設（`devDependencies` のみ）。
   - ESLint + Prettier 設定。まずは `no-unused-vars` / `no-undef` を warning で可視化（現状のグローバル依存を洗い出す目的）。
   - `.editorconfig`、`.gitignore`（`node_modules/`）。
2. **テスト基盤**
   - Vitest + jsdom を導入。
   - 純粋関数（`formatFileSize`, `base64ToBlob`, `htmlUtils.*`, フォーマット変換 `convertGeminiToOpenAIFormat` 等）に**ユニットテストの初期セット**を追加。これらは副作用が少なく着手しやすい。
   - IndexedDB 層は `fake-indexeddb` でスモークテスト。
3. **手動回帰チェックリストの作成**（`docs/regression-checklist.md`）
   - 主要ユーザーフロー（後述の検証チェックリスト）を文書化し、各フェーズの受け入れ基準にする。
4. **CI**（任意）: GitHub Actions で lint + test を走らせる。

### リスク / 検証
- リスク: ほぼなし（配信コードに触れない）。
- 完了基準: `npm run lint` / `npm test` がローカルで通る。配信ファイル（`app.js` 等）は無変更。

---

## Phase 1 — モジュール化の地ならし（ESM 化）

**目的**: 単一巨大ファイル＋グローバル変数を、ESM モジュールへ機械的に分割する。**設計改善はまだしない**。

### 設計判断: バンドラ
- **推奨**: `esbuild`（または Vite）で ESM をバンドルし、単一の `app.js` を生成して従来通り配信。
  - 利点: ファイル分割の自由を得つつ、配信は静的1ファイルのまま＝ SW/HTTP リクエスト構成が不変でリスク最小。
  - `function-calling.js` / `dropbox.js` もエントリに取り込み、`window.*` 結合を `import` へ置換。
- 代替案: ネイティブ ESM（`<script type="module">` で複数ファイル直接配信）。ビルド不要だがリクエスト数増・SW キャッシュ更新が複雑になるため非推奨。

### 作業（既存のオブジェクト境界をそのまま使って分割）
```
src/
  constants.js      // 12-189行: DB名/モデル定義/URL/閾値など全定数
  state.js          // 625-772行: state オブジェクト
  utils/
    html.js         // htmlUtils
    misc.js         // sleep, formatFileSize, base64ToBlob ほか
  debug-logger.js   // DebugLogger
  db.js             // dbUtils
  ui.js             // uiUtils
  api.js            // apiUtils
  app-logic.js      // appLogic（この時点では1ファイルのまま移送）
  features/
    project-manager.js  // 末尾IIFE(13427-)を正規モジュール化
    header-switcher.js  // 末尾IIFE(13343-)を正規モジュール化
  main.js           // 初期化エントリ（DOMContentLoaded配線）
```
1. 各神オブジェクトをファイルへ移し、`export` する。相互参照は `import` に置換。
2. **モンキーパッチの解消**: 末尾 IIFE の `dbUtils.addProject` 等は `db.js` の正規メソッドへ移設。`getAllChats` / `startNewChat` の上書きは、本来の定義に統合（プロジェクトフィルタを本体ロジックに組み込む）。
3. `window.*` への公開は、外部（ブックマークレット等）依存が無いか確認のうえ最小化。残す場合も `main.js` で一括 `export`。
4. `index.html` の `<script>` を、ビルド成果物1本に差し替え。`sw.js` のキャッシュ名・対象とキャッシュバスターを更新。

### リスク / 検証
- リスク: 中。読み込み順依存・循環参照が露出する可能性。→ Phase 0 の lint（`no-undef`）が効く。
- 完了基準: 生成された `app.js` で**全チェックリスト項目がパス**。差分は「移動とimport化のみ」でロジック変更なし。

---

## Phase 2 — プロバイダー層の統一（最重要・効果大）

**目的**: 4箇所に散在するプロバイダー分岐と、命名の崩れた API 関数群を、単一の抽象に集約する。

### 設計: Provider アダプタ
共通インターフェースを定義:
```js
interface ChatProvider {
  buildRequest(messages, genConfig, systemInstruction, tools)  // Gemini内部形式 → 各API形式
  parseResponse(raw)                                           // 各API形式 → 内部形式
  parseStreamChunk(chunk)                                      // ストリーミング差分
  mapTools(geminiTools)                                        // ツール定義変換
  endpoint, authHeader, supportsCaching, ...                   // メタ情報
}
```

実装:
- `OpenAICompatibleProvider` — **baseURL/認証/モデル一覧をパラメータ化**し、`openai / anthropic / groq / deepseek / xai / mistral / zai / openrouter` を1実装に統合（現 `callZaiApi` の中身を正規化）。Anthropic のプロンプトキャッシング等の差分はオプションフラグで吸収。
- `GeminiProvider` — 現 `callGeminiApi`。
- `BedrockProvider` — 現 `callBedrockApi`（Converse 変換群を内包）。
- `providerRegistry` — `provider 名 → アダプタ` のマップ。`callApi()` はレジストリ参照のみの薄いディスパッチャに。

### 作業
1. 既存 `convert*Format` 関数を各アダプタへ移動。
2. `5840 / 5939 / 11825 / 14214` 行の重複分岐を、アダプタのメタ情報参照に置換。
3. `callZaiApi` → `OpenAICompatibleProvider` へリネーム・移設（誤解を生む命名を撤廃）。
4. モデル定数（`*_MODELS`, `DEFAULT_*_MODEL`）を各アダプタ定義に寄せ、`constants.js` から整理。

### リスク / 検証
- リスク: 高（通信の中核）。→ Phase 0 で変換関数にユニットテストを用意してから着手。各プロバイダーで「テキスト送受信・ストリーミング・Function Calling・画像添付・思考表示」を実機確認。
- 完了基準: 全プロバイダーで送受信が従来通り。コードからプロバイダー分岐の重複が消滅。

---

## Phase 3 — `appLogic` 神オブジェクトの分解

**目的**: 8,350行・225メソッドの `appLogic` を、機能ドメイン単位のモジュールへ解体。

### 分割案（`features/` 配下）
| モジュール | 含めるもの |
|---|---|
| `chat.js` | チャットの開始/読込/保存/削除/タイトル生成 |
| `messages.js` | メッセージ送信/編集/再生成/カスケード |
| `attachments.js` | ファイル添付・画像処理・MIME 判定 |
| `memory.js` | 永続メモリ・要約コンテキスト |
| `image-gen.js` | NovelAI/SD 画像生成（`_improveSdPrompt` 等） |
| `proofread.js` | 校正機能（`proofreadText` 938→分割） |
| `settings.js` | 設定の読込/保存/UI 反映 |
| `profiles.js` | プロファイル CRUD |
| `scenes.js` | シーン/スタイルプロファイル |
| `events.js` | `setupEventListeners`（938行）を機能別の配線関数に分割 |

### 作業
1. `setupEventListeners()` を最優先で分解。各機能モジュールに `bindXxxEvents(elements)` を置き、`events.js` から呼ぶ。
2. メソッド群を関連ドメインへ移送。`state` への依存はそのまま（Phase 4 で整理）。
3. 200行超の巨大メソッドは、抽出可能な純粋部分を関数化しテストを追加。

### リスク / 検証
- リスク: 高（中核ロジック）。1モジュールずつ小さくマージ。
- 完了基準: `appLogic` が薄いオーケストレータに。各機能フローがチェックリストでパス。

---

## Phase 4 — データ層・状態管理の整理

**目的**: `state` 肥大と DB スキーマの累積を整理。

### 作業
1. **`state` の整理**: 巨大な単一 `state` を、関連ごとにサブオブジェクト化（既に `state.sync` 等はある）。一時 UI 状態と永続データを分離。アクセサ経由に寄せ、無秩序な直接変更を減らす。
2. **`dbUtils` の整理**:
   - `onupgradeneeded` のマイグレーションをスキーマ定義テーブルから生成する形に整理し、各バージョンの意図をコメント化。
   - `projects_temp` など暫定ストアの要否を確認し、不要なら次バージョンで統合（**データ移行を伴うため要慎重設計・要バックアップ手順**）。
   - スキーマを `docs/db-schema.md` に文書化。
3. Phase 1 で本体へ統合したプロジェクト関連 DB メソッドの最終整理。

### リスク / 検証
- リスク: **最高**（ユーザーデータ破壊の恐れ）。DB 変更は単独 PR とし、`fake-indexeddb` でマイグレーションテスト必須。実機は旧バージョンからのアップグレード経路を検証。
- 完了基準: 既存データを保持したままアップグレード可能。スキーマが文書化済み。

---

## Phase 5 — HTML / CSS の整理

**目的**: `index.html` のインライン資産と `style.css` の重複を解消。

### 作業
1. `index.html` の7箇所のインライン `<script>`/`<style>` を外部モジュール/CSSへ抽出。
2. `style.css`:
   - 重複・未使用セレクタの洗い出し（PurgeCSS 等で候補抽出 → 手動確認）。
   - `!important` 10箇所を詳細度設計で解消。
   - 色・余白・フォントを CSS カスタムプロパティ（デザイントークン）へ集約。テーマ（Aquarium/ダーク）切替を変数ベースに統一。
   - メディアクエリ・テーマ別ルールの整理。

### リスク / 検証
- リスク: 中（見た目崩れ）。→ 主要画面のスクリーンショット差分で確認（ライト/ダーク両テーマ）。
- 完了基準: 全画面で見た目が従来通り。`!important` 削減、未使用CSS削減。

---

## Phase 6 — 仕上げ・クリーンアップ

**目的**: 細かい蓄積物を一掃し、保守可能な状態で締める。

### 作業
1. **ログ統一**: 540箇所の `console.*` を `DebugLogger` 経由に統一。本番では抑制可能に。
2. **デッドコード/コメント除去**: `TODO/旧/不要/未使用` マーカー約50箇所を精査し、対応 or 削除。
3. **エラーハンドリング**: 空 `catch {}` 8箇所に適切なログ/ハンドリングを付与。
4. **ドキュメント整備**:
   - `README.md`（現49KB）を「ユーザー向け」と「開発者向け（`docs/`）」に分離。
   - `CONTRIBUTING.md` / アーキテクチャ図を追加。
5. **最終確認**: バンドルサイズ計測、Lighthouse（PWA スコア）、SW キャッシュ更新の最終チェック。

### 完了基準
- Lint クリーン、テストグリーン、全チェックリストパス。デッドコード・裸ログ・空 catch が一掃。

---

## 動作確認チェックリスト（各フェーズ共通の受け入れ基準）

- [ ] 新規チャット作成 → メッセージ送受信（ストリーミング表示）
- [ ] 各プロバイダー切替（Gemini / OpenAI互換 / Bedrock）で送受信
- [ ] Function Calling（NovelAI 画像生成「絵を描いて」）
- [ ] 画像/ファイル添付の送信（Anthropic 非対応形式の変換含む）
- [ ] 思考プロセス表示（Gemini / Claude / DeepSeek-R1）
- [ ] チャット履歴の保存/読込/削除/タイトル自動生成
- [ ] プロファイル・プロジェクト・シーンの CRUD と切替
- [ ] 設定の保存/復元、テーマ切替（ライト/ダーク）
- [ ] 永続メモリ・会話統計パネル
- [ ] Dropbox 連携・インポート/エクスポート
- [ ] PWA: オフライン起動、SW 更新、IndexedDB アップグレード（旧バージョンから）

---

## 想定スケジュールと依存関係

```
Phase 0 (安全網) ──┬─→ Phase 1 (ESM化) ─→ Phase 3 (appLogic分解) ─→ Phase 4 (データ層)
                   └─→ Phase 2 (Provider統一)  ↗
Phase 5 (HTML/CSS) … Phase 1 完了後いつでも可
Phase 6 (仕上げ) … 最後
```

- Phase 0 は必須の前提。Phase 1 と 2 は並行着手可能（2 は変換関数テストが揃い次第）。
- 各フェーズは複数の小さな PR に分割し、1 PR ＝ レビュー可能な単位（数百行）に抑える。

---

## 進め方の原則（まとめ）

1. **挙動を変えるな**。設計変更と機械的移動を同じコミットに混ぜない。
2. **小さくマージ**。各 PR でチェックリストを回す。
3. **SW とキャッシュバスターを毎回更新**。
4. **DB は最も慎重に**。スキーマ変更は単独・テスト必須・バックアップ前提。
5. 迷ったら**動いている現状を正**とし、テストで現挙動を固定してから動かす。
