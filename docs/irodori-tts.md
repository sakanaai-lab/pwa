# 音声読み上げ（Irodori-TTS）導入ガイド

AIの発言を **[Irodori-TTS-Server](https://github.com/Aratako/Irodori-TTS-Server)**（OpenAI TTS API互換）で読み上げる機能の導入手順です。

Google Colab上でTTSサーバーを起動し、cloudflaredのトンネル経由でPWAから呼び出します。**利用料金はかかりません**（自前ホスティングのため文字数課金なし。Colab無料枠の範囲内で動きます）。

---

## 目次

- [できること](#できること)
- [必要なもの](#必要なもの)
- [Colab側のセットアップ](#colab側のセットアップ)
- [PWA側の設定](#pwa側の設定)
- [声を登録する](#声を登録する)
- [読み上げの調整](#読み上げの調整)
- [毎回の起動手順](#毎回の起動手順)
- [トラブルシューティング](#トラブルシューティング)

---

## できること

| 機能 | 内容 |
|---|---|
| **読み上げ** | AIメッセージの「読み上げ」ボタンで音声再生 |
| **音声保存** | 「音声保存」ボタンでwavとして保存 |
| **声の指定** | 参照音声を登録して好きな声で読ませる |
| **話し方の指定** | 「明るく元気に」などを文章で指定 |
| **速さ・寄せ具合** | 話速と、参照音声への似せ具合を調整 |

---

## 必要なもの

- Googleアカウント（Colab + ドライブ）
- **GPUランタイム**（必須。CPUだと4秒の音声に5分かかります）
- 参照音声ファイル（読ませたい声。`.wav` `.mp3` `.flac` など）

---

## Colab側のセットアップ

### 0. GPUを有効にする（最初に必ず）

メニューバーの **`ランタイム` → `ランタイムのタイプを変更` → `T4 GPU` → 保存**

画面右下が **`T4`** になっていることを確認してください。

> ⚠️ CPUのままだと実用になりません（4.2秒の音声の生成に約300秒かかります）。

### 1. 参照音声をドライブに保存（初回だけ）

Colabのランタイムは切断のたびに中身が消えるため、音声はGoogleドライブに置きます。**一度やれば以降は不要です。**

```python
from google.colab import drive
drive.mount('/content/drive')

import os, shutil
from google.colab import files
os.makedirs('/content/drive/MyDrive/irodori_voices', exist_ok=True)
up = files.upload()          # ← 音声ファイルを選択
for name in up:
    shutil.move(name, f'/content/drive/MyDrive/irodori_voices/{name}')

!ls /content/drive/MyDrive/irodori_voices
```

### 2. サーバーのセットアップ（毎回）

```python
from google.colab import drive
drive.mount('/content/drive')

%cd /content
!git clone https://github.com/Aratako/Irodori-TTS-Server.git
%cd /content/Irodori-TTS-Server
!pip install uv -q
!uv sync
!cp .env.example .env
!echo 'IRODORI_CORS_ORIGINS=["*"]' >> .env
!echo 'IRODORI_PRELOAD=true' >> .env
!echo 'IRODORI_VOICES_DIR=/content/drive/MyDrive/irodori_voices' >> .env
!grep IRODORI_ .env
!ls /content/drive/MyDrive/irodori_voices
```

追加している3行の意味：

| 設定 | 役割 |
|---|---|
| `IRODORI_CORS_ORIGINS=["*"]` | **必須。** これが無いとブラウザから呼び出せません（後述） |
| `IRODORI_PRELOAD=true` | モデルを起動時に読み込む（初回の待ちを無くす） |
| `IRODORI_VOICES_DIR=...` | 参照音声をドライブから直接読む（毎回のアップロード不要） |

### 3. サーバー起動（毎回）

```python
!wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared
!chmod +x cloudflared
import subprocess, re
t = subprocess.Popen(["./cloudflared","tunnel","--url","http://localhost:8088"],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
for line in t.stdout:
    m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
    if m:
        print("★PWAに貼るURL →", m.group(0)); break
!uv run python -m irodori_openai_tts --host 0.0.0.0 --port 8088
```

URLが表示されますが、**すぐには使えません。** ログに次の行が出るまで待ってください（1〜3分）：

```
INFO:     Application startup complete.
```

---

## PWA側の設定

設定 → **「音声読み上げ（Irodori-TTS）」**

| 項目 | 入力するもの |
|---|---|
| **TTSサーバーURL** | セル3が出力した `https://xxx.trycloudflare.com` |
| **TTS音声ID** | 音声ファイル名から拡張子を除いたもの（`hanako.wav` → `hanako`） |

これでAIメッセージに「読み上げ」「音声保存」ボタンが表示されます。

> トンネルURLは**サーバーを起動し直すたびに変わります。** その都度貼り直してください。

---

## 声を登録する

### 基本：ファイル名がそのまま音声IDになる

ドライブの `MyDrive/irodori_voices/` にファイルを置くだけです。

- `hanako.wav` → 音声ID `hanako`
- `nanami.mp3` → 音声ID `nanami`

対応形式：`.wav` `.flac` `.mp3` `.m4a` `.ogg` `.opus` `.aac` `.webm`

ドライブのWeb画面から直接フォルダに入れてもOKです。**追加したらサーバーの再起動が必要**です。

### 同じ人の音声を複数まとめる（voices.json）

複数ファイルをただ置くと**それぞれ別の声**として登録されます。同一人物としてまとめると再現性が上がります（合計120秒まで有効）。

`irodori_voices/` に `voices.json` を置きます。Windowsのメモ帳だと `voices.json.txt` になりがちなので、Colabから書き出すのが確実です：

```python
import json, os
VOICES = '/content/drive/MyDrive/irodori_voices'

data = {
    "hanako": { "ref_wavs": ["hanako_01.wav", "hanako_02.wav", "hanako_03.wav"] }
}

with open(os.path.join(VOICES, 'voices.json'), 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(open(os.path.join(VOICES, 'voices.json'), encoding='utf-8').read())
```

キー（例の `hanako`）がそのまま音声IDになります。

### 参照音声なしで喋らせる

音声IDに **`none`** を入れると、参照音声を使わない合成になります。ただし**毎回ランダムな声**になるので、動作確認用と考えてください。

---

## 読み上げの調整

いずれも**空欄なら送信しない**ので、既定の挙動は変わりません。

| 設定 | 内容 |
|---|---|
| **読み上げスタイル** | 話し方・感情を文章で指定（例：`明るく元気で、楽しそうな話し方。`）。声そのものは音声IDのまま |
| **話す速さ** | 0.25〜4.0（既定1.0） |
| **声の寄せ具合** | 参照音声への似せ具合。「あまり似ていない」と感じたら上げる |

---

## 毎回の起動手順

1. ノートブックを開く → 右下が **`T4`** か確認
2. **セル2**（セットアップ）を実行 — 数分
3. **セル3**（サーバー起動）を実行 → URLが出る → `Application startup complete.` を待つ
4. PWAの「TTSサーバーURL」に貼り直す

---

## トラブルシューティング

### 「TTSサーバーに接続できませんでした」と出る

**ほぼCORSです。** Irodori-TTS-Server はCORS対応を内蔵していますが、**既定では無効**（`.env.example` にも項目がありません）。

```python
!echo 'IRODORI_CORS_ORIGINS=["*"]' >> .env
```

**書式に注意。** `list[str]` 型なのでJSON配列で書く必要があります：

| 書き方 | 結果 |
|---|---|
| `IRODORI_CORS_ORIGINS=["*"]` | ✅ |
| `IRODORI_CORS_ORIGINS=*` | ❌ 起動時にパースエラー |
| `IRODORI_CORS_ORIGINS=https://a.com,https://b.com` | ❌ 同上 |

**切り分け方**：トンネルURLをブラウザで直接開いて `{"detail":"Not Found"}` が出れば、サーバーは生きています（ルート `/` にページが無いだけ）。その場合はCORSが原因です。

> Colabのログに `OPTIONS /v1/audio/speech` すら記録されない場合は、広告ブロッカーやVPN拡張が `*.trycloudflare.com` を遮断している可能性もあります。

### 生成がものすごく遅い（数分かかる）

**CPUで動いています。** ログを確認してください：

```
[runtime] start synthesize model_device=cpu    ← これ
```

`ランタイム → ランタイムのタイプを変更 → T4 GPU` にしてください。`model_device=cuda` になれば数秒〜十数秒で返ります。

初回だけ遅い場合はモデルの読み込み（約170秒）です。`IRODORI_PRELOAD=true` を入れると起動時に前倒しできます。

> cloudflaredのトンネルには**約100秒のタイムアウト**があります。モデル読み込みがこれを超えるとブラウザ側だけエラーになるので、`IRODORI_PRELOAD=true` は実質必須です。

### 別人の声になる／毎回違う声になる

音声IDが **`none`** になっていませんか。参照音声を使わないモードなので、毎回ランダムな声になります。実際のファイル名（拡張子なし）を指定してください。

ログの `prepare reference:` が `0.1 ms` のままなら、参照音声が読めていません（＝音声IDが一致していない）。

### `Unknown voice='xxx'` と出る

指定した音声IDのファイルが `voices` に無い状態です。`!ls /content/drive/MyDrive/irodori_voices` で実際のファイル名を確認してください。

> ブラウザの自動入力で意図しない値が入っていることもあります。設定欄の中身を目視で確認してみてください。

### 声が似ていない

- **参照音声を長く**する（合計120秒まで有効。数秒だと精度が落ちます）
- 雑音・BGM・複数話者が入っていないクリーンな音声にする
- 複数クリップを `voices.json` でまとめる
- 設定の**「声の寄せ具合」を上げる**

### フォルダが消えた／設定が戻った

Colabのランタイムが作り直されると `/content` は消えます（アイドル90分程度、最大12時間）。**セル2から実行し直してください。**

ドライブに置いた音声ファイルは消えないので、再アップロードは不要です。

### iPhoneで再生されない

アプリ側で対策済みです（タップ時に再生権を確保）。それでも鳴らない場合は、端末のマナーモード／音量と、Safariの自動再生設定を確認してください。

---

## 技術的な補足

| 項目 | 内容 |
|---|---|
| エンドポイント | `POST {ベースURL}/v1/audio/speech` |
| モデル | `Aratako/Irodori-TTS-v4-Small`（参照音声クローンとキャプション両対応） |
| 送信するもの | `model` / `input` / `voice` / `response_format` (+ 任意で `speed`・`irodori.caption`・`irodori.cfg_scale_speaker`) |
| 受け取るもの | wavバイナリ（Blobで受けて再生・保存） |

PWAはURL末尾の `/v1/audio/speech` を自動で除去するので、ベースURL・エンドポイントのどちらを貼っても動きます。
