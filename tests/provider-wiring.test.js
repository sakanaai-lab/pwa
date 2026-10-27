import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BAI_API_BASE_URL, BAI_MODELS, DEFAULT_BAI_MODEL, META_API_BASE_URL, META_MODELS, DEFAULT_META_MODEL } from '../src/constants.js';
import { state } from '../src/state.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = read('index.html');
const doc = new DOMParser().parseFromString(html, 'text/html');

// プロバイダーを1つ足すには13ファイルを触る必要があり、どれか1つ抜けても
// 「選べるのに動かない」状態になる。抜けを機械的に検出する。
describe('B.AI プロバイダーの配線', () => {
    it('プロバイダー選択に出てくる', () => {
        const values = Array.from(doc.querySelectorAll('#api-provider option')).map((o) => o.value);
        expect(values).toContain('bai');
    });

    it('APIキー入力欄と追加モデル欄が他プロバイダーと同じ場所にある', () => {
        const container = doc.getElementById('bai-api-key-container');
        const sakana = doc.getElementById('sakana-api-key-container');
        expect(container).toBeTruthy();
        expect(doc.getElementById('bai-api-key')).toBeTruthy();
        // 追加モデル欄は `${provider}-custom-models` という名前で機械的に拾われる
        expect(doc.getElementById('bai-custom-models')).toBeTruthy();
        expect(container.parentNode).toBe(sakana.parentNode);
        expect(container.classList.contains('hidden')).toBe(true);
    });

    it('設定の受け皿（state.settings.baiApiKey）がある', () => {
        expect('baiApiKey' in state.settings).toBe(true);
    });

    // Service Worker が掴むと外部APIへのPOSTが壊れる。一番忘れやすい箇所
    it('Service Worker の除外ホストに api.b.ai が入っている', () => {
        expect(read('sw.js')).toContain("'api.b.ai'");
    });

    it('プロファイルの保存対象に baiApiKey が入っている', () => {
        expect(read('src/app-logic/profile.js')).toContain("'baiApiKey'");
    });

    it('モデル一括取得の対象に入っている', () => {
        expect(read('src/app.js')).toContain('https://api.b.ai/v1/models');
    });

    it('要約・メモリ学習とタイトル生成からも呼べる', () => {
        expect(read('src/app-logic/memory.js')).toContain('bai: BAI_API_BASE_URL');
        expect(read('src/app-logic/chat.js')).toContain('bai: BAI_API_BASE_URL');
    });

    it('APIのディスパッチャに case がある', () => {
        expect(read('src/api.js')).toContain("case 'bai':");
    });

    it('エンドポイントは OpenAI互換の chat/completions', () => {
        expect(BAI_API_BASE_URL).toBe('https://api.b.ai/v1/chat/completions');
    });

    // モデルIDはAPIキーの権限ごとに違い、公開された固定の一覧が無いので、
    // 載せてよいのは実アカウントで存在を確認できたものだけ
    it('要望のあった2モデルが選べる', () => {
        const values = BAI_MODELS.map((m) => m.value);
        expect(values).toContain('glm-5.3-flash');
        expect(values).toContain('qwen3.8-flash');
    });

    // ベンダー接頭辞が付く形（'zai/glm-5.3-flash' 等）ではないことを確認済み。
    // 付けてしまうと一覧には出るのに選ぶとエラーになる
    it('モデルIDに余計なベンダー接頭辞が付いていない', () => {
        for (const m of BAI_MODELS) {
            expect(m.value).not.toContain('/');
        }
    });

    it('既定モデルは一覧にあるものを指している', () => {
        expect(BAI_MODELS.map((m) => m.value)).toContain(DEFAULT_BAI_MODEL);
    });

    // 回帰: B.AI に supportsReasoning を付けてしまい、Include Thoughts が
    // ONのときだけ 400 になっていた。B.AI の Chat Completions に reasoning は無く
    // （Responses API 専用かつ OpenRouter の独自拡張）、送ると弾かれる
    it('B.AI に reasoning パラメータを送らない', () => {
        const api = read('src/api.js');
        const bai = api.slice(api.indexOf("label: 'B.AI'"));
        const configEnd = bai.indexOf('}, messagesForApi');
        expect(configEnd).toBeGreaterThan(0);
        expect(bai.slice(0, configEnd)).not.toContain('supportsReasoning: true');
    });

    // reasoning を送ってよいのは、それを定義している OpenRouter だけ
    it('supportsReasoning が付くのは OpenRouter のみ', () => {
        const api = read('src/api.js');
        const labels = [...api.matchAll(/label: '([^']+)',[\s\S]*?verboseError/g)]
            .filter((m) => m[0].includes('supportsReasoning: true'))
            .map((m) => m[1]);
        expect(labels).toEqual(['OpenRouter']);
    });

    it('モデル未選択のまま送らないよう案内メッセージを持つ', () => {
        const api = read('src/api.js');
        expect(api).toContain('missingModelMessage');
        // 空のモデル名でリクエストを投げない
        expect(api).toContain('if (!model && cfg.missingModelMessage)');
    });
});

// B.AI と同じく、1つでも抜けると「選べるのに動かない」状態になる
describe('Meta（Muse）プロバイダーの配線', () => {
    it('プロバイダー選択に出てくる', () => {
        const values = Array.from(doc.querySelectorAll('#api-provider option')).map((o) => o.value);
        expect(values).toContain('meta');
    });

    it('APIキー入力欄と追加モデル欄が他プロバイダーと同じ場所にある', () => {
        const container = doc.getElementById('meta-api-key-container');
        const sakana = doc.getElementById('sakana-api-key-container');
        expect(container).toBeTruthy();
        expect(doc.getElementById('meta-api-key')).toBeTruthy();
        expect(doc.getElementById('meta-custom-models')).toBeTruthy();
        expect(container.parentNode).toBe(sakana.parentNode);
        expect(container.classList.contains('hidden')).toBe(true);
    });

    it('設定の受け皿と保存対象', () => {
        expect('metaApiKey' in state.settings).toBe(true);
        expect(read('src/app-logic/profile.js')).toContain("'metaApiKey'");
        expect(read('src/app-logic/lifecycle.js')).toContain("metaApiKey: { element: elements.metaApiKeyInput");
    });

    it('Service Worker の除外ホストに api.meta.ai が入っている', () => {
        expect(read('sw.js')).toContain("'api.meta.ai'");
    });

    it('モデル一括取得・要約/メモリ学習・タイトル生成・ディスパッチャ', () => {
        expect(read('src/app.js')).toContain('https://api.meta.ai/v1/models');
        expect(read('src/app-logic/memory.js')).toContain('meta: META_API_BASE_URL');
        expect(read('src/app-logic/chat.js')).toContain('meta: META_API_BASE_URL');
        expect(read('src/api.js')).toContain("case 'meta':");
    });

    it('モデル名 muse- からプロバイダーを推定できる（要約モデルを別プロバイダーにした場合）', () => {
        expect(read('src/app-logic/memory.js')).toContain("if (m.startsWith('muse-')) return 'meta';");
    });

    it('エンドポイントと既定モデル', () => {
        expect(META_API_BASE_URL).toBe('https://api.meta.ai/v1/chat/completions');
        expect(DEFAULT_META_MODEL).toBe('muse-spark-1.3');
        expect(META_MODELS.map((m) => m.value)).toContain(DEFAULT_META_MODEL);
    });

    // Contributor 版は会話が Meta の学習に使われる。既定にせず、ラベルで分かるようにする
    it('Contributor 版は既定にせず、学習に使われることがラベルに書いてある', () => {
        expect(DEFAULT_META_MODEL.endsWith('-contributor')).toBe(false);
        for (const m of META_MODELS.filter((x) => x.value.endsWith('-contributor'))) {
            expect(m.label).toContain('学習に使われる');
        }
    });

    it('Meta 独自でない reasoning パラメータ（OpenRouter 用）を送らない', () => {
        const api = read('src/api.js');
        const block = api.slice(api.indexOf("case 'meta':"), api.indexOf('default:', api.indexOf("case 'meta':")));
        expect(block).not.toContain('supportsReasoning: true');
    });
});
