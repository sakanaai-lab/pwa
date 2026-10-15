import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getRetirementSuccessor, getScheduledRetirementAt, filterLiveModels } from '../src/utils/retirement.js';
import { OPENAI_MODELS, RETIRED_MODEL_MAP, SCHEDULED_RETIREMENTS, DEFAULT_OPENAI_MODEL } from '../src/constants.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const BEFORE_O4 = Date.UTC(2026, 9, 22, 23, 59);   // o4-mini 終了の直前
const AFTER_O4 = Date.UTC(2026, 9, 23);            // o4-mini 終了
const BEFORE_4O = Date.UTC(2027, 0, 13, 23, 59);   // GPT-4o 終了の直前
const AFTER_4O = Date.UTC(2027, 0, 14);            // GPT-4o 終了

describe('getRetirementSuccessor', () => {
    it('終了済み（RETIRED_MODEL_MAP）は日時に関係なく後継を返す', () => {
        expect(getRetirementSuccessor('gemini-3-pro-preview', BEFORE_O4)).toBe('gemini-3.1-pro-preview');
    });

    // 終了日の前に後継へ移すと、まだ使えるモデルを勝手に変えることになる
    it('終了日の前は null（まだ使える）', () => {
        expect(getRetirementSuccessor('o4-mini', BEFORE_O4)).toBeNull();
        expect(getRetirementSuccessor('gpt-4o', BEFORE_4O)).toBeNull();
    });

    it('終了日を過ぎたら公式の移行先を返す', () => {
        expect(getRetirementSuccessor('o4-mini', AFTER_O4)).toBe('gpt-5.6-terra');
        for (const m of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini']) {
            expect(getRetirementSuccessor(m, AFTER_4O)).toBe('gpt-6-luna');
        }
    });

    it('予定に無いモデルと空の名前は null', () => {
        expect(getRetirementSuccessor('gpt-6-luna', AFTER_4O)).toBeNull();
        expect(getRetirementSuccessor('', AFTER_4O)).toBeNull();
        expect(getRetirementSuccessor(undefined, AFTER_4O)).toBeNull();
    });

    // 告知に載っているのはスナップショットだけで、別名の 'o3' は載っていない
    it('告知に無い別名は推測で入れない', () => {
        expect(getRetirementSuccessor('o3', Date.UTC(2027, 0, 1))).toBeNull();
        expect(getRetirementSuccessor('o3-2025-04-16', Date.UTC(2026, 11, 11))).toBe('gpt-5.6-sol');
    });

    it('表を差し替えられる', () => {
        const tables = { retiredMap: {}, scheduled: [{ at: 100, models: { a: 'b' } }] };
        expect(getRetirementSuccessor('a', 99, tables)).toBeNull();
        expect(getRetirementSuccessor('a', 100, tables)).toBe('b');
    });
});

describe('getScheduledRetirementAt', () => {
    it('終了日を返す', () => {
        expect(getScheduledRetirementAt('gpt-4o')).toBe(AFTER_4O);
        expect(getScheduledRetirementAt('o4-mini')).toBe(AFTER_O4);
        expect(getScheduledRetirementAt('gpt-6-luna')).toBeNull();
    });
});

describe('filterLiveModels', () => {
    it('終了日を過ぎたモデルだけ一覧から消える', () => {
        const before = filterLiveModels(OPENAI_MODELS, BEFORE_O4).map((m) => m.value);
        expect(before).toContain('o4-mini');
        expect(before).toContain('gpt-4o');

        const mid = filterLiveModels(OPENAI_MODELS, AFTER_O4).map((m) => m.value);
        expect(mid).not.toContain('o4-mini');
        expect(mid).toContain('gpt-4o');

        const after = filterLiveModels(OPENAI_MODELS, AFTER_4O).map((m) => m.value);
        expect(after).not.toContain('gpt-4o');
        expect(after).toContain('gpt-6-luna');
        expect(after).toContain('o3');
    });
});

describe('終了予定の表の整合', () => {
    const scheduledKeys = SCHEDULED_RETIREMENTS.flatMap(({ models }) => Object.keys(models));

    it('後継が、それ自体終了予定・終了済みのモデルを指していない', () => {
        const bad = SCHEDULED_RETIREMENTS.flatMap(({ models }) => Object.entries(models))
            .filter(([, s]) => scheduledKeys.includes(s) || RETIRED_MODEL_MAP[s])
            .map(([o, s]) => `${o} → ${s}`);
        expect(bad).toEqual([]);
    });

    it('同じモデルが2つの日付に載っていない', () => {
        expect(new Set(scheduledKeys).size).toBe(scheduledKeys.length);
    });

    it('一覧に残している終了予定のモデルは、ラベルに終了日を書いている', () => {
        const unlabeled = OPENAI_MODELS
            .filter((m) => getScheduledRetirementAt(m.value) !== null && !m.label.includes('終了'))
            .map((m) => m.value);
        expect(unlabeled).toEqual([]);
    });

    // 回帰: 既定が終了予定のモデルだと、終了日を過ぎた初回起動でいきなりエラーになる
    it('OpenAI の既定モデルは終了予定に入っていない', () => {
        expect(getScheduledRetirementAt(DEFAULT_OPENAI_MODEL)).toBeNull();
    });
});

describe('終了判定の配線', () => {
    it('一覧の描画で終了日を過ぎたモデルを除いている', () => {
        expect(read('src/app-logic/lifecycle.js')).toContain('models = filterLiveModels(models, Date.now());');
    });

    it('保存済み設定の移行と、エラー時の後継案内が同じ判定を使う', () => {
        expect(read('src/app-logic/profile.js')).toContain('getRetirementSuccessor(current, Date.now())');
        expect(read('src/app-logic/retired-model.js')).toContain('getRetirementSuccessor(deadModel, now)');
    });
});
