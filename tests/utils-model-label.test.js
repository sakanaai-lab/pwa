import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODEL_PROMOS, promoLastDay, promoNote, modelDisplayLabel } from '../src/utils/model-label.js';
import { getPricing, GEMINI_FLASH_PROMO_END_AT, GEMINI_ARGON_INTRO_END_AT } from '../src/utils/pricing.js';
import { GEMINI_MODELS } from '../src/constants.js';

const NOV = Date.UTC(2026, 10, 12);

describe('promoLastDay', () => {
    it('終了日時の前日を M/D で返す（料金ページの「Through Nov 30」に合わせる）', () => {
        expect(promoLastDay(GEMINI_ARGON_INTRO_END_AT)).toBe('11/30');
        expect(promoLastDay(GEMINI_FLASH_PROMO_END_AT)).toBe('12/31');
    });
});

describe('promoNote / modelDisplayLabel', () => {
    it('割引期間中は説明を添える', () => {
        expect(modelDisplayLabel({ value: 'gemini-4-carbon', label: 'gemini-4-carbon' }, NOV)).toBe('gemini-4-carbon (11/30 まで半額)');
        expect(modelDisplayLabel({ value: 'gemini-3.8-flash', label: 'gemini-3.8-flash' }, NOV)).toBe('gemini-3.8-flash (12/31 まで半額)');
    });

    it('割引が終わった瞬間から説明は付かない（推定コストの切り替えと同じ時刻）', () => {
        expect(promoNote('gemini-4-argon', GEMINI_ARGON_INTRO_END_AT - 1)).toBe('11/30 まで半額');
        expect(promoNote('gemini-4-argon', GEMINI_ARGON_INTRO_END_AT)).toBeNull();
        expect(promoNote('gemini-3.6-flash', GEMINI_FLASH_PROMO_END_AT)).toBeNull();
        expect(modelDisplayLabel({ value: 'gemini-3.6-flash', label: 'gemini-3.6-flash' }, GEMINI_FLASH_PROMO_END_AT)).toBe('gemini-3.6-flash');
    });

    it('割引の無いモデルはそのまま', () => {
        expect(modelDisplayLabel({ value: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite' }, NOV)).toBe('gemini-3.5-flash-lite');
    });
});

describe('表示と推定コストがずれない', () => {
    // 説明を付けているモデルは、期間中と期間後で単価が実際に変わる（半額 → 通常）
    for (const promo of MODEL_PROMOS) {
        for (const model of promo.models) {
            it(`${model}: 期間中は通常単価の半額`, () => {
                const during = getPricing(model, promo.endAt - 1);
                const after = getPricing(model, promo.endAt);
                expect(during.in * 2).toBeCloseTo(after.in);
                expect(during.out * 2).toBeCloseTo(after.out);
            });

            it(`${model}: モデル一覧に載っている`, () => {
                expect(GEMINI_MODELS.map(m => m.value)).toContain(model);
            });
        }
    }

    it('一覧の表示名に、期限つきの説明を直接書いていない', () => {
        const hardcoded = GEMINI_MODELS.filter(m => /まで|半額|年内/.test(m.label)).map(m => m.label);
        expect(hardcoded).toEqual([]);
    });
});

describe('モデル選択の配線', () => {
    it('表示名は modelDisplayLabel を通す', () => {
        const src = readFileSync(resolve(process.cwd(), 'src/app-logic/lifecycle.js'), 'utf8');
        expect(src).toContain("import { modelDisplayLabel } from '../utils/model-label.js';");
        expect(src).not.toContain('option.textContent = model.label;');
        expect(src.match(/option\.textContent = modelDisplayLabel\(model, labelNow\);/g)).toHaveLength(2);
    });
});
