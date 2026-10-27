import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMetaMuseModel, metaLightReasoningParams, isMetaContributorModel } from '../src/utils/meta-params.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('meta-params', () => {
    it('Muse のモデルを見分ける', () => {
        expect(isMetaMuseModel('muse-spark-1.3')).toBe(true);
        expect(isMetaMuseModel('MUSE-WONDER-1.0')).toBe(true);
        expect(isMetaMuseModel('gemini-3.8-flash')).toBe(false);
        expect(isMetaMuseModel(undefined)).toBe(false);
    });

    // Muse は 'none' を受け付けない（400）ので、いちばん軽い 'minimal' にする
    it('短い作業では reasoning_effort: minimal（none は送らない）', () => {
        expect(metaLightReasoningParams('muse-spark-1.3')).toEqual({ reasoning_effort: 'minimal' });
        expect(metaLightReasoningParams('deepseek-flash')).toBeNull();
    });

    it('Contributor 版を見分ける', () => {
        expect(isMetaContributorModel('muse-spark-1.3-contributor')).toBe(true);
        expect(isMetaContributorModel('muse-spark-1.3')).toBe(false);
    });
});

describe('Muse の短い作業の配線', () => {
    // 回帰防止: タイトル生成は max_tokens 200 を推論で使い切ると空になる
    it('タイトル生成とメモリ学習で推論を軽くする', () => {
        expect(read('src/app-logic/chat.js')).toContain('...(metaLightReasoningParams(titleModel) || {})');
        expect(read('src/app-logic/memory.js')).toContain("if (provider === 'meta' && lightweight) {");
    });
});
