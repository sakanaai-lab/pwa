import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    geminiModelsListUrl,
    listAllGeminiModels,
    pickGeminiChatModelIds,
    GEMINI_LIST_PAGE_SIZE,
    GEMINI_LIST_MAX_PAGES,
} from '../src/utils/gemini-models.js';

const page = (models, nextPageToken) => new Response(JSON.stringify({ models, ...(nextPageToken ? { nextPageToken } : {}) }), { status: 200 });
const chat = (id) => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent', 'countTokens'] });

describe('geminiModelsListUrl', () => {
    it('1ページの上限（1000件）を頼む', () => {
        expect(GEMINI_LIST_PAGE_SIZE).toBe(1000);
        expect(geminiModelsListUrl('k')).toBe(`https://generativelanguage.googleapis.com/v1beta/models?key=k&pageSize=1000`);
    });

    it('続きのページは pageToken を付ける', () => {
        expect(geminiModelsListUrl('k', 'a/b=')).toContain('&pageToken=a%2Fb%3D');
    });
});

describe('listAllGeminiModels', () => {
    // 回帰: 1ページ目だけを読んでいたため、2ページ目に載った gemini-4-carbon が取得しても出てこなかった
    it('nextPageToken が続く限り全ページを読む', async () => {
        const fetchFn = vi.fn()
            .mockResolvedValueOnce(page([chat('gemini-4-argon')], 'p2'))
            .mockResolvedValueOnce(page([chat('gemini-4-carbon')]));
        const result = await listAllGeminiModels('k', fetchFn);
        expect(result.ok).toBe(true);
        expect(pickGeminiChatModelIds(result.models)).toEqual(['gemini-4-argon', 'gemini-4-carbon']);
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(fetchFn.mock.calls[1][0]).toContain('pageToken=p2');
    });

    it('途中のページで失敗したら、その応答を返す', async () => {
        const bad = new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 });
        const fetchFn = vi.fn().mockResolvedValueOnce(page([chat('gemini-4-argon')], 'p2')).mockResolvedValueOnce(bad);
        const result = await listAllGeminiModels('k', fetchFn);
        expect(result.ok).toBe(false);
        expect(result.response.status).toBe(400);
    });

    it('nextPageToken が返り続けても上限で止まる', async () => {
        const fetchFn = vi.fn(async () => page([chat('gemini-x')], 'again'));
        const result = await listAllGeminiModels('k', fetchFn);
        expect(result.ok).toBe(true);
        expect(fetchFn).toHaveBeenCalledTimes(GEMINI_LIST_MAX_PAGES);
    });
});

describe('pickGeminiChatModelIds', () => {
    it('generateContent に対応した gemini だけを、models/ を外して返す', () => {
        const models = [
            chat('gemini-4-carbon'),
            { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
            chat('gemma-4-27b-it'),
            { name: 'models/imagen-5.0-generate-001', supportedGenerationMethods: ['predict'] },
        ];
        expect(pickGeminiChatModelIds(models)).toEqual(['gemini-4-carbon']);
    });

    it('空や壊れた要素でも落ちない', () => {
        expect(pickGeminiChatModelIds(undefined)).toEqual([]);
        expect(pickGeminiChatModelIds([null, {}])).toEqual([]);
    });
});

describe('取得ボタンの配線', () => {
    it('Gemini は全ページを読む関数を使い、1ページ目だけの取得に戻っていない', () => {
        const src = readFileSync(resolve(process.cwd(), 'src/app.js'), 'utf8');
        expect(src).toContain("import { listAllGeminiModels, pickGeminiChatModelIds } from './utils/gemini-models.js';");
        expect(src).toContain('await listAllGeminiModels(state.settings.apiKey, (url) => fetch(url))');
        expect(src).not.toContain('pageSize=100');
    });
});
