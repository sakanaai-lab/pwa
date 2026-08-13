import { describe, it, expect } from 'vitest';
import { getPricing, isDeepSeekPeak, DEEPSEEK_V4_PRICE_CHANGE_AT } from '../src/utils/pricing.js';

const BEFORE = DEEPSEEK_V4_PRICE_CHANGE_AT - 1;
const AFTER = DEEPSEEK_V4_PRICE_CHANGE_AT;

describe('getPricing', () => {
    it('モデル名の前方一致で単価を引く', () => {
        expect(getPricing('claude-opus-5', AFTER).out).toBe(25);
        expect(getPricing('claude-sonnet-4-5-20250929', AFTER).in).toBe(3);
    });

    it('大文字でも引ける', () => {
        expect(getPricing('Claude-Opus-5', AFTER).out).toBe(25);
    });

    // 前方一致なので、長いキーが短いキーより先に一致する必要がある
    it('より具体的なキーを優先する', () => {
        expect(getPricing('claude-opus-4-1', AFTER).in).toBe(15);
        expect(getPricing('claude-opus-4-8', AFTER).in).toBe(5);
        expect(getPricing('claude-haiku-4-5-20251001', AFTER).in).toBe(1);
    });

    it('知らないモデルは null', () => {
        expect(getPricing('gemini-2.5-pro', AFTER)).toBeNull();
        expect(getPricing('', AFTER)).toBeNull();
        expect(getPricing(undefined, AFTER)).toBeNull();
    });
});

describe('getPricing — DeepSeek V4の値上げ（2026-08-16 16:00 UTC）', () => {
    it('改定後は新料金を使う', () => {
        expect(getPricing('deepseek-v4-pro', AFTER)).toMatchObject({ in: 0.66, out: 1.98, cr: 0.022 });
        expect(getPricing('deepseek-v4-flash', AFTER)).toMatchObject({ in: 0.22, out: 0.66, cr: 0.007 });
    });

    // 回帰: 過去のチャットのコストが後から跳ね上がって見えないようにする
    it('改定前のメッセージは旧料金で計算する', () => {
        expect(getPricing('deepseek-v4-pro', BEFORE)).toMatchObject({ in: 0.435, out: 0.87, cr: 0.003625 });
        expect(getPricing('deepseek-v4-flash', BEFORE)).toMatchObject({ in: 0.14, out: 0.28, cr: 0.0028 });
    });

    it('境界のちょうどその時刻から新料金', () => {
        expect(getPricing('deepseek-v4-pro', DEEPSEEK_V4_PRICE_CHANGE_AT).in).toBe(0.66);
        expect(getPricing('deepseek-v4-pro', DEEPSEEK_V4_PRICE_CHANGE_AT - 1).in).toBe(0.435);
    });

    it('時刻が無い古いデータは旧料金として扱う', () => {
        expect(getPricing('deepseek-v4-pro').in).toBe(0.435);
        expect(getPricing('deepseek-v4-pro', 0).in).toBe(0.435);
    });

    it('値上げの対象はV4だけで、他のDeepSeekや他社は時刻で変わらない', () => {
        expect(getPricing('deepseek-chat', BEFORE)).toEqual(getPricing('deepseek-chat', AFTER));
        expect(getPricing('deepseek-reasoner', BEFORE)).toEqual(getPricing('deepseek-reasoner', AFTER));
        expect(getPricing('claude-opus-5', BEFORE)).toEqual(getPricing('claude-opus-5', AFTER));
    });

    it('ピーク倍率は改定の前後どちらも2倍', () => {
        expect(getPricing('deepseek-v4-pro', BEFORE).peakMul).toBe(2);
        expect(getPricing('deepseek-v4-pro', AFTER).peakMul).toBe(2);
    });

    it('改定後の値上げ幅（出力は約2.3倍）', () => {
        const pro = getPricing('deepseek-v4-pro', AFTER).out / getPricing('deepseek-v4-pro', BEFORE).out;
        const flash = getPricing('deepseek-v4-flash', AFTER).out / getPricing('deepseek-v4-flash', BEFORE).out;
        expect(pro).toBeCloseTo(2.276, 3);
        expect(flash).toBeCloseTo(2.357, 3);
    });
});

describe('isDeepSeekPeak', () => {
    const at = (utcHour) => Date.UTC(2026, 7, 20, utcHour, 30, 0);

    it('UTC 01:00-04:00 はピーク（日本時間 10-13時）', () => {
        expect(isDeepSeekPeak(at(1))).toBe(true);
        expect(isDeepSeekPeak(at(3))).toBe(true);
    });

    it('UTC 06:00-10:00 はピーク（日本時間 15-19時）', () => {
        expect(isDeepSeekPeak(at(6))).toBe(true);
        expect(isDeepSeekPeak(at(9))).toBe(true);
    });

    it('境界の外はオフピーク', () => {
        expect(isDeepSeekPeak(Date.UTC(2026, 7, 20, 0, 59))).toBe(false);
        expect(isDeepSeekPeak(Date.UTC(2026, 7, 20, 4, 0))).toBe(false);
        expect(isDeepSeekPeak(Date.UTC(2026, 7, 20, 5, 59))).toBe(false);
        expect(isDeepSeekPeak(Date.UTC(2026, 7, 20, 10, 0))).toBe(false);
    });

    it('時刻が無ければオフピーク扱い', () => {
        expect(isDeepSeekPeak(undefined)).toBe(false);
        expect(isDeepSeekPeak(0)).toBe(false);
    });
});
