# Phase 0 ベースライン記録 / 発見事項

Phase 0（安全網の構築）で導入した Lint・テスト基盤による、リファクタリング着手時点の
基準値と、その過程で判明した既存コードの問題点を記録する。

## Lint ベースライン（2026-06-11 時点）

`npm run lint` の結果:

| 重大度 | 件数 |
|---|---|
| error | 13 |
| warning | 40 |

ルール別:

| 件数 | ルール | 種別 |
|---|---|---|
| 39 | `no-unused-vars` | warn（未使用変数。デッドコードの候補） |
| 7 | `no-case-declarations` | warn（`case` 内の `let`/`const` がブロック非分離） |
| 3 | `no-undef` | **error（潜在バグ。下記参照）** |
| 1 | `no-useless-escape` | error（`app.js:3823` 不要なエスケープ） |
| 1 | `no-unreachable` | **error（到達不能コード。下記参照）** |
| 1 | `no-empty` | warn（空ブロック） |
| 1 | `no-dupe-keys` | **error（重複キー。下記参照）** |

> 各 PR ではこの件数を超える新規エラーを出さないことを目安とする（`docs/regression-checklist.md` 参照）。
> warn 系（特に `no-unused-vars`）は Phase 3 / Phase 6 のデッドコード除去で段階的に削減する。

## 要調査の本物の問題（後続フェーズで対応）

Lint 導入によって発見された、挙動に関わる可能性のある既存バグ。**Phase 0 では挙動を変えないため未修正のまま記録のみ**とし、該当機能を扱うフェーズで対応する。

### 1. `assetDB` が未定義（`app.js:11157`, `app.js:11520`）
`assetDB.save({...})` / `assetDB.delete(assetName)` を呼んでいるが、`assetDB` は
リポジトリ内のどこにも定義が存在しない。該当パスが実行されると `ReferenceError` になる。
→ アセット保存/削除ロジックを扱う **Phase 3（image-gen / attachments）** で要調査。
正しくは `dbUtils` の image_assets ストア操作を意図していた可能性が高い。

### 2. `candidate` が未定義（`app.js:12254`）
```js
const finishReason = candidate?.finishReason;
```
`candidate` がスコープ内に存在しない。オプショナルチェーンに隠れて `ReferenceError` には
ならないが、`finishReason` が**常に `undefined`** になっている（要約処理のエラーハンドリングが
実質機能していない）。`responseData.candidates?.[0]` の取り違えと推測。
→ **Phase 3（chat / タイトル・要約生成）** で修正。

### 3. `runQualityChecker` の重複定義（`app.js:13077` と `app.js:13297`）
同名メソッドが同一オブジェクト内に2回定義されており、後者（13297）が前者を**上書き**する。
前者は完全なデッドコード。両者の内容差分を確認のうえ統合が必要。
→ **Phase 3（image-gen）** で対応。

### 4. 到達不能コード（`app.js:6775`）
Dropbox 同期の競合処理で `return;` の直後に「ユーザーが上書きを承認しました」パスの
コードが続いており、到達不能。上書き承認フローが過去に放棄された痕跡。
→ **Phase 3 / Dropbox 同期整理**時に、死んでいる分岐を削除するか復活させるか判断。

## 構造的負債（既知・別途定量化済み）

`REFACTORING_PLAN.md` の「現状分析」を参照。要点:
- `app.js` 単一ファイル 14,638 行。神オブジェクト4つ（`appLogic` 約8,350行）。
- プロバイダー分岐の重複（4箇所以上）、`callZaiApi` の命名と実態の乖離。
- 末尾 IIFE による `dbUtils` / `appLogic` の実行時モンキーパッチ。
- クロスファイルのグローバル結合（`appLogic` / `state` / `dbUtils` / `normalizeCharacterName` 等）
  → Lint の `no-undef` 抑制のために `eslint.config.js` で明示的にグローバル宣言している。
  Phase 1 の ESM 化に伴い、これらの宣言を1つずつ削除していくのが進捗の指標になる。

## 導入したツール

| ツール | 用途 | 設定ファイル |
|---|---|---|
| ESLint 9 | 静的解析（バグ検出・負債可視化） | `eslint.config.js` |
| Prettier 3 | 整形（新規コードのみ。レガシーは `.prettierignore` で除外） | `.prettierrc.json` |
| Vitest 2 + jsdom | ユニットテスト基盤 | `vitest.config.js` |
| fake-indexeddb | DB 層テスト用の IndexedDB モック | （テスト内 import） |

コマンド: `npm run lint` / `npm run format` / `npm test`
