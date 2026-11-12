import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toGeminiContents } from '../src/utils/gemini-contents.js';

const user = (text) => ({ role: 'user', parts: [{ text }] });
const call = (name) => ({ role: 'model', parts: [{ functionCall: { name, args: {} } }] });
const result = (name, extra = {}) => ({ role: 'tool', parts: [{ functionResponse: { name, response: { ok: true }, ...extra } }] });

describe('toGeminiContents', () => {
    // 回帰: Gemini 4 Carbon が「Role 'tool' is not supported」の 400 で断った
    it('関数の結果（role: tool）は role: user で送る', () => {
        const out = toGeminiContents([user('やほ'), call('save_memory'), result('save_memory')]);
        expect(out.map(c => c.role)).toEqual(['user', 'model', 'user']);
        expect(out[2].parts[0].functionResponse.name).toBe('save_memory');
        expect(out.some(c => c.role === 'tool')).toBe(false);
    });

    it('並列に呼んだ関数の結果は1つの user ターンにまとめる', () => {
        const out = toGeminiContents([
            user('調べて'),
            { role: 'model', parts: [{ functionCall: { name: 'a', args: {} } }, { functionCall: { name: 'b', args: {} } }] },
            result('a'),
            result('b'),
            { role: 'model', parts: [{ text: 'できたよ' }] },
        ]);
        expect(out.map(c => c.role)).toEqual(['user', 'model', 'user', 'model']);
        expect(out[2].parts.map(p => p.functionResponse.name)).toEqual(['a', 'b']);
    });

    it('関数の結果の直後のふつうの発言はまとめない', () => {
        const out = toGeminiContents([call('a'), result('a'), user('ありがとう')]);
        expect(out.map(c => c.role)).toEqual(['model', 'user', 'user']);
        expect(out[1].parts).toHaveLength(1);
        expect(out[2].parts[0].text).toBe('ありがとう');
    });

    it('アプリ内部の _toolCallId は送らない', () => {
        const out = toGeminiContents([call('a'), result('a', { _toolCallId: 'call_123' })]);
        expect(out[1].parts[0].functionResponse).toEqual({ name: 'a', response: { ok: true } });
    });

    it('元の履歴は書き換えない', () => {
        const history = [call('a'), result('a', { _toolCallId: 'call_123' }), result('b')];
        const before = JSON.stringify(history);
        toGeminiContents(history);
        expect(JSON.stringify(history)).toBe(before);
    });

    it('関数を使っていない会話はそのまま', () => {
        const history = [user('a'), { role: 'model', parts: [{ text: 'b' }] }, user('c')];
        expect(toGeminiContents(history)).toEqual(history);
    });

    it('空でも落ちない', () => {
        expect(toGeminiContents(undefined)).toEqual([]);
        expect(toGeminiContents([null])).toEqual([]);
    });
});

describe('Gemini アダプタの配線', () => {
    it('generateContent に送る contents は toGeminiContents を通す', () => {
        const api = readFileSync(resolve(process.cwd(), 'src/api.js'), 'utf8');
        expect(api).toContain("import { toGeminiContents } from './utils/gemini-contents.js';");
        expect(api).toContain('contents: toGeminiContents(messagesForApi),');
        expect(api).not.toContain('contents: messagesForApi,');
    });
});
