import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openaiIsReasoningModel, openaiSupportsReasoningNone, getOpenAIReasoningLevels, resolveOpenAIReasoningEffort } from '../src/utils/openai-params.js';
import { JSDOM } from 'jsdom';
import { state } from '../src/state.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('openaiIsReasoningModel', () => {
    // 回帰: 以前は o 系だけを推論モデル扱いにしていて、GPT-5 / GPT-6 に temperature を送っていた
    it('GPT-5 以降と o 系は推論モデル', () => {
        for (const m of ['gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.6-terra', 'gpt-5', 'o3', 'o4-mini', 'openai/gpt-6-luna']) {
            expect(openaiIsReasoningModel(m)).toBe(true);
        }
    });

    it('GPT-4.x は推論モデルではない（temperature を送ってよい）', () => {
        for (const m of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini']) {
            expect(openaiIsReasoningModel(m)).toBe(false);
        }
    });

    it('今後の GPT-7 なども推論モデルとして扱う', () => {
        expect(openaiIsReasoningModel('gpt-7')).toBe(true);
        expect(openaiIsReasoningModel('gpt-10-luna')).toBe(true);
    });

    it('GPT 以外（gpt-oss など）や空は false', () => {
        expect(openaiIsReasoningModel('openai/gpt-oss-120b')).toBe(false);
        expect(openaiIsReasoningModel('')).toBe(false);
        expect(openaiIsReasoningModel(undefined)).toBe(false);
    });
});

describe('openaiSupportsReasoningNone', () => {
    // GPT-6 開発者ガイド: none を受け付けるのは GPT-6 Sol と GPT-6 Luna だけ
    it('GPT-6 Sol / Luna は none を受け付ける', () => {
        expect(openaiSupportsReasoningNone('gpt-6-luna')).toBe(true);
        expect(openaiSupportsReasoningNone('gpt-6-sol')).toBe(true);
    });

    it('GPT-6 Astra と 6.1 Sol は受け付けない（6.1 Sol を 6 Sol と取り違えない）', () => {
        expect(openaiSupportsReasoningNone('gpt-6-astra')).toBe(false);
        expect(openaiSupportsReasoningNone('gpt-6.1-sol')).toBe(false);
    });

    it('記載の無いモデルには送らない', () => {
        expect(openaiSupportsReasoningNone('gpt-5.6-sol')).toBe(false);
        expect(openaiSupportsReasoningNone('o3')).toBe(false);
    });
});

describe('OpenAI へ送る中身の配線', () => {
    it('チャット本体は推論モデルに temperature / top_p を送らない', () => {
        const api = read('src/api.js');
        expect(api).toContain('const isReasoningModel = openaiIsReasoningModel(model);');
        expect(api).not.toContain("state.settings.modelName || 'gpt-4o'");
    });

    it('要約・メモリ学習も推論モデルでは temperature を外し max_completion_tokens を使う', () => {
        const mem = read('src/app-logic/memory.js');
        expect(mem).toContain("if (provider === 'openai' && openaiIsReasoningModel(model)) {");
        expect(mem).toContain('body.max_completion_tokens = maxTokens;');
        expect(mem).toContain("if (openaiSupportsReasoningNone(model)) body.reasoning_effort = 'none';");
    });

    // 2027-01-14 に終了するモデルを決め打ちしていた
    it('メモリ学習の OpenAI の軽量モデルは終了予定の gpt-4o-mini ではない', () => {
        const mem = read('src/app-logic/memory.js');
        expect(mem).not.toContain("openai: 'gpt-4o-mini'");
        expect(mem).toContain("openai: 'gpt-6-luna'");
    });
});

describe('getOpenAIReasoningLevels（各モデルのページの記載どおり）', () => {
    it('GPT-6 Luna / Sol は none〜max', () => {
        for (const m of ['gpt-6-luna', 'gpt-6-sol']) {
            expect(getOpenAIReasoningLevels(m)).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
        }
    });

    it('GPT-6.1 Terra は none〜max（6.1 Sol と違い none を受け付ける）', () => {
        expect(getOpenAIReasoningLevels('gpt-6.1-terra')).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
        expect(openaiSupportsReasoningNone('gpt-6.1-terra')).toBe(true);
    });

    it('GPT-6 Astra / 6.1 Sol は low〜max（none なし）', () => {
        for (const m of ['gpt-6-astra', 'gpt-6.1-sol']) {
            expect(getOpenAIReasoningLevels(m)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
        }
    });

    it('表に無い推論モデルは共通の low / medium / high に絞る', () => {
        expect(getOpenAIReasoningLevels('o3')).toEqual(['low', 'medium', 'high']);
        expect(getOpenAIReasoningLevels('gpt-5.6-sol')).toEqual(['low', 'medium', 'high']);
    });

    it('推論モデルでない GPT-4.x は null（項目を隠す）', () => {
        expect(getOpenAIReasoningLevels('gpt-4o')).toBeNull();
    });
});

describe('resolveOpenAIReasoningEffort', () => {
    it('空ならモデルの既定（送らない）', () => {
        expect(resolveOpenAIReasoningEffort('gpt-6-luna', '')).toBeNull();
        expect(resolveOpenAIReasoningEffort('gpt-6-luna', undefined)).toBeNull();
    });

    it('そのモデルで使える値だけ送る', () => {
        expect(resolveOpenAIReasoningEffort('gpt-6-luna', 'none')).toBe('none');
        expect(resolveOpenAIReasoningEffort('gpt-6.1-sol', 'xhigh')).toBe('xhigh');
    });

    // 送ると 400 になるので、対応外は既定に落とす
    it('対応外の値は送らない', () => {
        expect(resolveOpenAIReasoningEffort('gpt-6.1-sol', 'none')).toBeNull();
        expect(resolveOpenAIReasoningEffort('o3', 'max')).toBeNull();
        expect(resolveOpenAIReasoningEffort('gpt-4o', 'low')).toBeNull();
    });
});

describe('推論の強さの設定の配線', () => {
    it('既定は空（モデルの既定）', () => {
        expect(state.settings.openaiReasoningEffort).toBe('');
    });

    it('設定画面にプルダウンがある', () => {
        const doc = new JSDOM(read('index.html')).window.document;
        const sel = doc.getElementById('openai-reasoning-effort');
        expect(sel).not.toBeNull();
        expect(Array.from(sel.options).map((o) => o.value)).toEqual(['', 'none', 'low', 'medium', 'high', 'xhigh', 'max']);
    });

    it('保存対象と画面反映に入っていて、モデル変更時に選択肢を絞り直す', () => {
        expect(read('src/app-logic/lifecycle.js')).toContain('openaiReasoningEffort: { element: elements.openaiReasoningEffortSelect');
        const ui = read('src/ui.js');
        expect(ui).toContain("elements.openaiReasoningEffortSelect.value = state.settings.openaiReasoningEffort || ''");
        expect(ui).toMatch(/this\.updateGeminiThinkingLevelOptions\(\);\s*\n\s*this\.updateOpenAIReasoningEffortOptions\(\);/);
    });

    it('チャット本体は使える値のときだけ reasoning_effort を送る', () => {
        expect(read('src/api.js')).toContain('const reasoningEffort = resolveOpenAIReasoningEffort(model, state.settings.openaiReasoningEffort);');
    });
});
