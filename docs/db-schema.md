# IndexedDB スキーマ（GeminiPWA_DB）

このアプリの永続データは IndexedDB に保存される。スキーマ定義とマイグレーションは
`src/db-migrations.js`（`applyDbMigrations`）に集約されており、`src/db.js` の
`dbUtils.openDB()` の `onupgradeneeded` から呼び出される。

- **DB 名**: `GeminiPWA_DB`（定数 `DB_NAME`）
- **現行バージョン**: `15`（定数 `DB_VERSION`）

マイグレーションの回帰テストは `tests/db-migrations.test.js`（fake-indexeddb）にある。

---

## オブジェクトストア一覧

| ストア名 | keyPath | autoIncrement | インデックス | 用途 |
|---|---|---|---|---|
| `settings` | `key` | – | – | グローバル設定（key/value 形式）。`activeProfileId` 等 |
| `chats` | `id` | ✓ | `updatedAtIndex`(updatedAt), `createdAtIndex`(createdAt) | チャット履歴本体 |
| `profiles` | `id` | ✓ | – | プロファイル（プロバイダー設定・システムプロンプト等を内包） |
| `image_assets` | `name` | – | – | 名前付き画像アセット（キャラクター画像など） |
| `projects` | `id` | ✓ | – | プロジェクト（ナレッジ/プロンプト） |
| `image_store` | `id` | – | – | チャット添付・生成画像の Blob 本体（v11 で追加） |
| `memory_store` | `profileId` | – | – | プロファイル単位の永続メモリ（v12 で追加） |

### 一時ストア（安全インポート用）

インポート時に既存データを壊さないよう、まず `*_temp` に書き込んでから入れ替える方式で使う。

| ストア名 | keyPath | 追加バージョン |
|---|---|---|
| `profiles_temp` | `id` | v13 |
| `chats_temp` | `id` | v13 |
| `settings_temp` | `key` | v13 |
| `image_store_temp` | `id` | v13 |
| `image_assets_temp` | `name` | v13 |
| `memory_store_temp` | `profileId` | v13 |
| `projects_temp` | `id` | v15 |

> ⚠️ `autoIncrement` は `chats` / `profiles` / `projects` のみ。対応する `*_temp` は
> `autoIncrement` を持たない（インポート時に元の `id` をそのまま復元するため）。

---

## バージョン履歴 / マイグレーション

`applyDbMigrations` は冪等で、`event.oldVersion` のしきい値ごとに段階適用する。
新規作成（`oldVersion = 0`）の場合は下記すべてが順に適用される。

- **常時（バージョン非依存）**: `settings` / `chats` / `profiles` / `image_assets` /
  `projects` を存在しなければ作成（`BASE_STORES`）。

- **v10 — プロファイル機能導入（データ移行あり）**
  `oldVersion < 10` のとき、旧来 `settings` に平置きされていたプロバイダー/モデル/生成
  パラメータ等（`PROFILE_SETTING_KEYS`）を **「デフォルトプロファイル」へ移送**し、
  `settings` 側からは削除。`settings` に `activeProfileId` を設定する。旧設定に無いキーは
  呼び出し側が渡す `settingsDefaults`（実行時は `state.settings`）で補完。
  既存設定が空（新規インストール）の場合は何もしない。

- **v11 — 画像ストア追加（データ移行あり）**
  `image_store` を作成。アップグレードトランザクション完了後に `migrateImageData()`
  （実行時は `appLogic.migrateImageData`）を呼び、旧形式の画像データを移行する。

- **v12 — メモリ機能**: `memory_store` を作成。

- **v13 — 安全インポート用一時ストア**: 上記 6 つの `*_temp` を作成。

- **v15 — プロジェクト一時ストア**: `projects_temp` を作成。

> v14 は欠番（スキーマ変更なし）。

---

## 設計メモ / 今後の整理候補（未着手）

Phase 4 の残作業として、以下はデータ移行を伴うため**慎重設計・要バックアップ**で別途検討する。

- **一時ストアの統合**: `*_temp` 群（計 7 ストア）はインポート時のみ使用される暫定領域。
  汎用の一時領域へ統合、または毎回 `create/delete` する方式に置き換えられる可能性がある。
- **`state` の整理**: 永続データと一時 UI 状態が単一 `state` に混在している。サブオブジェクト化
  とアクセサ集約は本ドキュメントの範囲外（挙動互換の検証コスト大のため独立タスク）。

これらは**ユーザーデータ破壊リスクが最高**であり、変更時は単独 PR・マイグレーションテスト追加・
旧バージョンからのアップグレード経路の実機検証を必須とする。
