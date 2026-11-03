import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requestPersistentStorage } from '../src/utils/storage-persist.js';

const fakeStorage = ({ persisted = false, persist = true } = {}) => ({
    persisted: vi.fn(async () => persisted),
    persist: vi.fn(async () => persist),
});

describe('requestPersistentStorage', () => {
    it('保護されていなければ頼み、認められたら granted', async () => {
        const storage = fakeStorage({ persisted: false, persist: true });
        expect(await requestPersistentStorage(storage)).toBe('granted');
        expect(storage.persist).toHaveBeenCalledTimes(1);
    });

    it('断られたら denied（今までと同じ扱いのまま）', async () => {
        expect(await requestPersistentStorage(fakeStorage({ persist: false }))).toBe('denied');
    });

    it('既に保護されているなら頼み直さない（Firefox で毎回聞かれないように）', async () => {
        const storage = fakeStorage({ persisted: true });
        expect(await requestPersistentStorage(storage)).toBe('already');
        expect(storage.persist).not.toHaveBeenCalled();
    });

    it('対応していないブラウザでは何もしない', async () => {
        expect(await requestPersistentStorage(undefined)).toBe('unsupported');
        expect(await requestPersistentStorage({})).toBe('unsupported');
    });

    it('persisted が無くても persist だけで頼める', async () => {
        expect(await requestPersistentStorage({ persist: async () => true })).toBe('granted');
    });

    it('例外が出ても起動を止めない', async () => {
        const storage = { persisted: async () => false, persist: async () => { throw new Error('x'); } };
        expect(await requestPersistentStorage(storage)).toBe('error');
    });
});

describe('起動時の配線', () => {
    it('起動時に保護を頼む（起動を待たせないよう await しない）', () => {
        const src = readFileSync(resolve(process.cwd(), 'src/app-logic/lifecycle.js'), 'utf8');
        expect(src).toContain("import { requestPersistentStorage } from '../utils/storage-persist.js';");
        expect(src).toContain('requestPersistentStorage().then(');
        expect(src).not.toContain('await requestPersistentStorage(');
    });
});
