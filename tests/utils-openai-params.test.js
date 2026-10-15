import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openaiIsReasoningModel, openaiSupportsReasoningNone } from '../src/utils/openai-params.js';

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
