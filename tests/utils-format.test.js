import { describe, it, expect, vi } from 'vitest';
import { sleep, interruptibleSleep, formatFileSize, parseNameMaskRules, applyNameMask } from '../src/utils/format.js';

describe('formatFileSize', () => {
    it('0 バイトを "0 Bytes" で返す', () => {
        expect(formatFileSize(0)).toBe('0 Bytes');
    });

    it('各単位に変換する', () => {
        expect(formatFileSize(1024)).toBe('1 KB');
        expect(formatFileSize(1024 * 1024)).toBe('1 MB');
        expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('小数第2位まで丸める', () => {
        expect(formatFileSize(1536)).toBe('1.5 KB');
        expect(formatFileSize(1234567)).toBe('1.18 MB');
    });
});

describe('sleep', () => {
    it('指定時間後に resolve する', async () => {
        vi.useFakeTimers();
        let done = false;
        const p = sleep(1000).then(() => {
            done = true;
        });
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(1000);
        await p;
        expect(done).toBe(true);
        vi.useRealTimers();
    });
});

describe('parseNameMaskRules', () => {
    it('「本名,別名」を解析する', () => {
        expect(parseNameMaskRules('ゆすら,A')).toEqual([{ from: 'ゆすら', to: 'A' }]);
    });

    it('区切りに 、 → -> => を使える', () => {
        expect(parseNameMaskRules('太郎、主人公')).toEqual([{ from: '太郎', to: '主人公' }]);
        expect(parseNameMaskRules('太郎→主人公')).toEqual([{ from: '太郎', to: '主人公' }]);
        expect(parseNameMaskRules('太郎->主人公')).toEqual([{ from: '太郎', to: '主人公' }]);
    });

    it('複数行を解析し、空行や本名なしの行は無視する', () => {
        const rules = parseNameMaskRules('ゆすら,A\n\n,無視される\n田中太郎,主人公');
        expect(rules).toContainEqual({ from: 'ゆすら', to: 'A' });
        expect(rules).toContainEqual({ from: '田中太郎', to: '主人公' });
        expect(rules).toHaveLength(2);
    });

    it('長い本名から先に並べる（部分一致の崩れ防止）', () => {
        const rules = parseNameMaskRules('太郎,X\n田中太郎,Y');
        expect(rules[0].from).toBe('田中太郎');
    });

    it('別名が空でも許容する（削除用）', () => {
        expect(parseNameMaskRules('秘密,')).toEqual([{ from: '秘密', to: '' }]);
    });

    it('空・非文字列は空配列', () => {
        expect(parseNameMaskRules('')).toEqual([]);
        expect(parseNameMaskRules(null)).toEqual([]);
    });
});

describe('applyNameMask', () => {
    it('全出現を置換する', () => {
        const rules = [{ from: 'ゆすら', to: 'A' }];
        expect(applyNameMask('ゆすらとゆすらの話', rules)).toBe('AとAの話');
    });

    it('長い名前を先に処理して部分崩れを防ぐ', () => {
        const rules = parseNameMaskRules('太郎,X\n田中太郎,Y');
        expect(applyNameMask('田中太郎と太郎', rules)).toBe('YとX');
    });

    it('正規表現の特殊文字を含む名前も安全に置換する', () => {
        const rules = [{ from: 'a.b', to: 'Z' }];
        expect(applyNameMask('a.b axb', rules)).toBe('Z axb');
    });

    it('ルールが空ならそのまま返す', () => {
        expect(applyNameMask('変わらない', [])).toBe('変わらない');
    });
});

describe('interruptibleSleep', () => {
    it('正常に待機を完了する', async () => {
        const ac = new AbortController();
        await expect(interruptibleSleep(5, ac.signal)).resolves.toBeUndefined();
    });

    it('既に中断済みなら即座に AbortError で reject する', async () => {
        const ac = new AbortController();
        ac.abort();
        await expect(interruptibleSleep(1000, ac.signal)).rejects.toMatchObject({
            name: 'AbortError',
        });
    });

    it('待機中の中断で AbortError になる', async () => {
        const ac = new AbortController();
        const p = interruptibleSleep(10000, ac.signal);
        ac.abort();
        await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    });
});
