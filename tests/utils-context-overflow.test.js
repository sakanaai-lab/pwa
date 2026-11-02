import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    parseContextOverflow,
    resolveContextOverflow,
    contextTooLongMessage,
    fetchWithContextOverflowRetry,
    CONTEXT_OVERFLOW_MARGIN,
    MIN_OUTPUT_TOKENS,
} from '../src/utils/context-overflow.js';

// 回帰: 最大トークン数 8192 のまま、さくらのAI Engine の LLM-jp（文脈長 4096）に
// 「やほやほ」を送ると、このエラーで必ず失敗していた
const SAKURA_ERROR = "'max_tokens' or 'max_completion_tokens' is too large: 8192. This model's maximum context length is 4096 tokens and your request has 37 input tokens (8192 > 4096 - 37). None";
const SAKURA_BODY = JSON.stringify({ error: { message: SAKURA_ERROR, code: 400 } });

// vLLM の古い書き方
const VLLM_OLD = "This model's maximum context length is 4096 tokens. However, you requested 8229 tokens (37 in the messages, 8192 in the completion). Please reduce the length of the messages or completion.";

const jsonResponse = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

describe('parseContextOverflow', () => {
    it('さくらのAI Engine のエラー文から文脈長と入力トークン数を読む', () => {
        expect(parseContextOverflow(SAKURA_ERROR)).toEqual({ contextLength: 4096, inputTokens: 37 });
    });

    it('JSON の本文そのままでも読める', () => {
        expect(parseContextOverflow(SAKURA_BODY)).toEqual({ contextLength: 4096, inputTokens: 37 });
    });

    it('vLLM の古い書き方も読む', () => {
        expect(parseContextOverflow(VLLM_OLD)).toEqual({ contextLength: 4096, inputTokens: 37 });
    });

    it('関係ないエラーは null', () => {
        expect(parseContextOverflow('Invalid API key')).toBeNull();
        expect(parseContextOverflow('')).toBeNull();
        expect(parseContextOverflow(undefined)).toBeNull();
        // 文脈長だけで入力数が無いものは、下げる値を決められないので扱わない
        expect(parseContextOverflow("This model's maximum context length is 4096 tokens.")).toBeNull();
    });
});

describe('resolveContextOverflow', () => {
    it('収まる値に下げて送り直す', () => {
        expect(resolveContextOverflow(SAKURA_ERROR, 8192)).toEqual({
            action: 'retry',
            maxTokens: 4096 - 37 - CONTEXT_OVERFLOW_MARGIN,
            contextLength: 4096,
            inputTokens: 37,
        });
    });

    it('残りが少なすぎるなら送り直さずに「履歴が長すぎます」', () => {
        const input = 4096 - CONTEXT_OVERFLOW_MARGIN - MIN_OUTPUT_TOKENS + 1;
        const msg = `This model's maximum context length is 4096 tokens and your request has ${input} input tokens`;
        expect(resolveContextOverflow(msg, 8192)).toEqual({ action: 'tooLong', contextLength: 4096, inputTokens: input });
    });

    it('ちょうど最低限が残るなら送り直す', () => {
        const input = 4096 - CONTEXT_OVERFLOW_MARGIN - MIN_OUTPUT_TOKENS;
        const msg = `This model's maximum context length is 4096 tokens and your request has ${input} input tokens`;
        expect(resolveContextOverflow(msg, 8192)).toMatchObject({ action: 'retry', maxTokens: MIN_OUTPUT_TOKENS });
    });

    it('入力だけで文脈長を超えているなら、max_tokens を送っていなくても「履歴が長すぎます」', () => {
        const msg = "This model's maximum context length is 4096 tokens. However, your messages resulted in 5000 tokens.";
        expect(resolveContextOverflow(msg, undefined)).toMatchObject({ action: 'tooLong', inputTokens: 5000 });
    });

    it('max_tokens を送っていない・既に収まっているなら、下げても直らないので null', () => {
        expect(resolveContextOverflow(SAKURA_ERROR, undefined)).toBeNull();
        expect(resolveContextOverflow(SAKURA_ERROR, 1000)).toBeNull();
    });

    it('関係ないエラーは null', () => {
        expect(resolveContextOverflow('Invalid API key', 8192)).toBeNull();
    });
});

describe('contextTooLongMessage', () => {
    it('文脈長と入力トークン数を入れて日本語で案内する', () => {
        const m = contextTooLongMessage({ contextLength: 4096, inputTokens: 3900 });
        expect(m).toContain('履歴が長すぎます');
        expect(m).toContain('4096');
        expect(m).toContain('3900');
    });
});

describe('fetchWithContextOverflowRetry', () => {
    it('文脈長の 400 なら max_tokens を下げて1回だけ送り直し、その応答を返す', async () => {
        const body = { model: 'llm-jp-3.1-8x13b-instruct4', max_tokens: 8192 };
        const sent = [];
        const send = vi.fn(async () => {
            sent.push(JSON.parse(JSON.stringify(body)));
            return sent.length === 1 ? jsonResponse(400, SAKURA_BODY) : jsonResponse(200, { choices: [] });
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = await fetchWithContextOverflowRetry(send, body, 'さくらのAI Engine');

        expect(res.status).toBe(200);
        expect(send).toHaveBeenCalledTimes(2);
        expect(sent[0].max_tokens).toBe(8192);
        expect(sent[1].max_tokens).toBe(4096 - 37 - CONTEXT_OVERFLOW_MARGIN);
        // 元の値と下げた値をコンソールに出す
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('8192');
        expect(warn.mock.calls[0][0]).toContain(String(4096 - 37 - CONTEXT_OVERFLOW_MARGIN));
        warn.mockRestore();
    });

    it('送り直しても断られたら、それ以上は送らずにその応答を返す', async () => {
        const body = { model: 'm', max_tokens: 8192 };
        const send = vi.fn(async () => jsonResponse(400, SAKURA_BODY));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = await fetchWithContextOverflowRetry(send, body, 'x');

        expect(send).toHaveBeenCalledTimes(2);
        expect(res.status).toBe(400);
        // 呼び出し側がエラー文を読めるよう、本文は読まれずに残っている
        expect((await res.json()).error.message).toContain('maximum context length');
        warn.mockRestore();
    });

    it('入力だけで埋まっているなら送り直さず、status 400 の「履歴が長すぎます」を投げる', async () => {
        const body = { model: 'm', max_tokens: 8192 };
        const msg = "This model's maximum context length is 4096 tokens and your request has 4000 input tokens";
        const send = vi.fn(async () => jsonResponse(400, { error: { message: msg } }));

        await expect(fetchWithContextOverflowRetry(send, body, 'x')).rejects.toMatchObject({
            status: 400,
            message: expect.stringContaining('履歴が長すぎます'),
        });
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('成功や別のエラーは、そのまま返して本文も読まずに残す', async () => {
        const ok = vi.fn(async () => jsonResponse(200, { choices: [] }));
        expect((await fetchWithContextOverflowRetry(ok, { max_tokens: 8192 }, 'x')).status).toBe(200);
        expect(ok).toHaveBeenCalledTimes(1);

        const other = vi.fn(async () => jsonResponse(400, { error: { message: 'Invalid model' } }));
        const res = await fetchWithContextOverflowRetry(other, { max_tokens: 8192 }, 'x');
        expect(other).toHaveBeenCalledTimes(1);
        expect((await res.json()).error.message).toBe('Invalid model');
    });
});

describe('OpenAI互換アダプタの配線', () => {
    const api = readFileSync(resolve(process.cwd(), 'src/api.js'), 'utf8');

    it('ツール対応アダプタ（さくら・Meta・B.AI・Sakana・Z.ai・OpenRouter）が通す', () => {
        expect(api).toContain('fetchWithContextOverflowRetry(() => fetch(cfg.baseUrl, {');
        expect(api).toContain('}), requestBody, cfg.label);');
    });

    it('ツール非対応アダプタ（Groq・DeepSeek・xAI・Mistral）も通す。設定が空でも 4000 を送るため', () => {
        expect(api).toContain('fetchWithContextOverflowRetry(() => fetch(baseUrl, {');
        expect(api).toContain('}), requestBody, providerName);');
    });
});
