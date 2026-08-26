import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    GEMINI_ADJUSTABLE_HARM_CATEGORIES,
    fetchGeminiWithSafetyRetry,
    getGeminiSafetySettings,
    getGeminiSafetyThreshold,
    isSafetyThresholdRejection,
    noteGeminiSafetyRejection,
    resetGeminiSafetyThreshold,
} from '../src/utils/safety.js';

beforeEach(() => {
    resetGeminiSafetyThreshold();
});

describe('getGeminiSafetySettings', () => {
    it('既定は全カテゴリ OFF', () => {
        expect(getGeminiSafetySettings()).toEqual([
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
        ]);
    });

    // safetySettings で設定できるのはこの4つだけ。CIVIC_INTEGRITY / JAILBREAK を
    // 足すと全リクエストが 400 になり、毎回フォールバックへ落ちてしまう
    it('調整できないカテゴリを含めない', () => {
        expect(GEMINI_ADJUSTABLE_HARM_CATEGORIES).not.toContain('HARM_CATEGORY_CIVIC_INTEGRITY');
        expect(GEMINI_ADJUSTABLE_HARM_CATEGORIES).not.toContain('HARM_CATEGORY_JAILBREAK');
        expect(GEMINI_ADJUSTABLE_HARM_CATEGORIES).toHaveLength(4);
    });
});

describe('isSafetyThresholdRejection', () => {
    it('閾値が弾かれた400を検知する', () => {
        const err = {
            error: {
                message: "Invalid value at 'safety_settings[0].threshold' "
                    + '(type.googleapis.com/google.ai.generativelanguage.v1beta.SafetySetting.HarmBlockThreshold), "OFF"',
            },
        };
        expect(isSafetyThresholdRejection(err)).toBe(true);
    });

    // ここで誤爆すると、本当の原因を隠したまま無駄な再送をしてしまう
    it('関係ない400は検知しない', () => {
        const cases = [
            { error: { message: 'API key not valid. Please pass a valid API key.' } },
            { error: { message: 'models/gemini-9-ultra is not found for API version v1beta' } },
            { error: { message: 'You exceeded your current quota' } },
            { error: {} },
            {},
            null,
            undefined,
        ];
        for (const c of cases) {
            expect(isSafetyThresholdRejection(c)).toBe(false);
        }
    });
});

describe('noteGeminiSafetyRejection', () => {
    it('拒否されたら BLOCK_NONE へ落ちる', () => {
        const err = { error: { message: "Invalid value at 'safety_settings[0].threshold' ... \"OFF\"" } };
        expect(getGeminiSafetyThreshold()).toBe('OFF');
        expect(noteGeminiSafetyRejection(err)).toBe(true);
        expect(getGeminiSafetyThreshold()).toBe('BLOCK_NONE');
        expect(getGeminiSafetySettings().every((s) => s.threshold === 'BLOCK_NONE')).toBe(true);
    });

    it('二度目は false（＝これ以上落とさない・再送しない）', () => {
        const err = { error: { message: "Invalid value at 'safety_settings[0].threshold' ... \"OFF\"" } };
        expect(noteGeminiSafetyRejection(err)).toBe(true);
        expect(noteGeminiSafetyRejection(err)).toBe(false);
    });

    it('関係ないエラーでは落ちない', () => {
        expect(noteGeminiSafetyRejection({ error: { message: 'API key not valid' } })).toBe(false);
        expect(getGeminiSafetyThreshold()).toBe('OFF');
    });
});

describe('fetchGeminiWithSafetyRetry', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const okResponse = () => new Response('{"candidates":[]}', { status: 200 });
    const safetyReject = () => new Response(
        JSON.stringify({ error: { message: "Invalid value at 'safety_settings[0].threshold' ... \"OFF\"" } }),
        { status: 400 },
    );

    it('成功したらそのまま返す（1回だけ送る）', async () => {
        const fetchMock = vi.fn().mockResolvedValue(okResponse());
        vi.stubGlobal('fetch', fetchMock);

        const body = { safetySettings: getGeminiSafetySettings() };
        const res = await fetchGeminiWithSafetyRetry('https://example.test', { method: 'POST' }, body);

        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(getGeminiSafetyThreshold()).toBe('OFF');
    });

    it('OFF が拒否されたら BLOCK_NONE で送り直す', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(safetyReject())
            .mockResolvedValueOnce(okResponse());
        vi.stubGlobal('fetch', fetchMock);

        const body = { safetySettings: getGeminiSafetySettings() };
        const res = await fetchGeminiWithSafetyRetry('https://example.test', { method: 'POST' }, body);

        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const sentFirst = JSON.parse(fetchMock.mock.calls[0][1].body);
        const sentSecond = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(sentFirst.safetySettings.every((s) => s.threshold === 'OFF')).toBe(true);
        expect(sentSecond.safetySettings.every((s) => s.threshold === 'BLOCK_NONE')).toBe(true);
    });

    it('関係ない400は送り直さず、そのまま返す', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }),
        );
        vi.stubGlobal('fetch', fetchMock);

        const res = await fetchGeminiWithSafetyRetry('https://example.test', { method: 'POST' }, { safetySettings: [] });

        expect(res.status).toBe(400);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(getGeminiSafetyThreshold()).toBe('OFF');
    });

    it('400以外のエラーは送り直さない', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }));
        vi.stubGlobal('fetch', fetchMock);

        const res = await fetchGeminiWithSafetyRetry('https://example.test', { method: 'POST' }, { safetySettings: [] });

        expect(res.status).toBe(429);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // 呼び出し側が本文を読めなくなると、エラー内容の表示が壊れる
    it('エラー応答の本文は呼び出し側でも読める（clone している）', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }),
        );
        vi.stubGlobal('fetch', fetchMock);

        const res = await fetchGeminiWithSafetyRetry('https://example.test', { method: 'POST' }, { safetySettings: [] });
        const data = await res.json();
        expect(data.error.message).toBe('API key not valid');
    });

    it('一度落ちたあとは最初から BLOCK_NONE で送る', async () => {
        noteGeminiSafetyRejection({ error: { message: "Invalid value at 'safety_settings[0].threshold' \"OFF\"" } });

        const fetchMock = vi.fn().mockResolvedValue(okResponse());
        vi.stubGlobal('fetch', fetchMock);

        const body = { safetySettings: getGeminiSafetySettings() };
        await fetchGeminiWithSafetyRetry('https://example.test', { method: 'POST' }, body);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(sent.safetySettings.every((s) => s.threshold === 'BLOCK_NONE')).toBe(true);
    });
});
