import { describe, it, expect } from 'vitest';
import { normalizeTtsBaseUrl, buildSpeechRequest, DEFAULT_TTS_VOICE } from '../src/utils/tts.js';

describe('normalizeTtsBaseUrl', () => {
    it('前後の空白を除去する', () => {
        expect(normalizeTtsBaseUrl('  https://x.trycloudflare.com  ')).toBe('https://x.trycloudflare.com');
    });

    it('末尾のスラッシュを除去する', () => {
        expect(normalizeTtsBaseUrl('https://x.trycloudflare.com/')).toBe('https://x.trycloudflare.com');
        expect(normalizeTtsBaseUrl('https://x.trycloudflare.com///')).toBe('https://x.trycloudflare.com');
    });

    it('エンドポイントごと貼られた場合はベースURLに戻す', () => {
        expect(normalizeTtsBaseUrl('https://x.trycloudflare.com/v1/audio/speech')).toBe('https://x.trycloudflare.com');
        expect(normalizeTtsBaseUrl('https://x.trycloudflare.com/v1/audio/speech/')).toBe('https://x.trycloudflare.com');
    });

    it('空・非文字列は空文字を返す', () => {
        expect(normalizeTtsBaseUrl('')).toBe('');
        expect(normalizeTtsBaseUrl(null)).toBe('');
        expect(normalizeTtsBaseUrl(undefined)).toBe('');
    });
});

describe('buildSpeechRequest', () => {
    it('エンドポイントURLを組み立てる', () => {
        const { url } = buildSpeechRequest('https://x.trycloudflare.com', 'こんにちは', 'kouko');
        expect(url).toBe('https://x.trycloudflare.com/v1/audio/speech');
    });

    it('仕様どおりのJSONボディとヘッダーを作る', () => {
        const { options } = buildSpeechRequest('https://x.trycloudflare.com', 'こんにちは', 'kouko');
        expect(options.method).toBe('POST');
        expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(JSON.parse(options.body)).toEqual({
            model: 'irodori-tts',
            input: 'こんにちは',
            voice: 'kouko',
            response_format: 'wav',
        });
    });

    it('音声IDが未指定なら既定値を使う', () => {
        const { options } = buildSpeechRequest('https://x.trycloudflare.com', 'テスト');
        expect(JSON.parse(options.body).voice).toBe(DEFAULT_TTS_VOICE);
        expect(DEFAULT_TTS_VOICE).toBe('kouko');
    });

    it('ベースURL未設定ならエラーにする', () => {
        expect(() => buildSpeechRequest('', 'テスト')).toThrow(/TTSサーバーURL/);
        expect(() => buildSpeechRequest('   ', 'テスト')).toThrow(/TTSサーバーURL/);
    });

    it('読み上げテキストが空ならエラーにする', () => {
        expect(() => buildSpeechRequest('https://x.trycloudflare.com', '')).toThrow(/テキスト/);
        expect(() => buildSpeechRequest('https://x.trycloudflare.com', '   ')).toThrow(/テキスト/);
    });
});
