import { describe, it, expect } from 'vitest';
import { normalizeTtsBaseUrl, buildSpeechRequest, createTtsFilename, pickSpeechText, parseStylePresets, serializeStylePresets, upsertStylePreset, removeStylePreset, resolveTtsCaption, DEFAULT_TTS_VOICE } from '../src/utils/tts.js';

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
        const { url } = buildSpeechRequest('https://x.trycloudflare.com', 'こんにちは', 'hanako');
        expect(url).toBe('https://x.trycloudflare.com/v1/audio/speech');
    });

    it('仕様どおりのJSONボディとヘッダーを作る', () => {
        const { options } = buildSpeechRequest('https://x.trycloudflare.com', 'こんにちは', 'hanako');
        expect(options.method).toBe('POST');
        expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(JSON.parse(options.body)).toEqual({
            model: 'irodori-tts',
            input: 'こんにちは',
            voice: 'hanako',
            response_format: 'wav',
        });
    });

    it('音声IDが未指定なら既定値を使う', () => {
        const { options } = buildSpeechRequest('https://x.trycloudflare.com', 'テスト');
        expect(JSON.parse(options.body).voice).toBe(DEFAULT_TTS_VOICE);
        expect(DEFAULT_TTS_VOICE).toBe('hanako');
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

describe('buildSpeechRequest — 追加パラメータ', () => {
    const parse = (extra) =>
        JSON.parse(buildSpeechRequest('https://x.trycloudflare.com', 'テスト', 'hanako', extra).options.body);

    it('未指定なら speed も irodori も送らない（既定の挙動を変えない）', () => {
        const body = parse({});
        expect(body).not.toHaveProperty('speed');
        expect(body).not.toHaveProperty('irodori');
    });

    it('キャプションを irodori.caption に入れる', () => {
        expect(parse({ caption: '明るく元気な話し方。' }).irodori).toEqual({ caption: '明るく元気な話し方。' });
    });

    it('空白だけのキャプションは送らない', () => {
        expect(parse({ caption: '   ' })).not.toHaveProperty('irodori');
    });

    it('speed をトップレベルに入れる', () => {
        expect(parse({ speed: 1.5 }).speed).toBe(1.5);
        expect(parse({ speed: '1.25' }).speed).toBe(1.25);
    });

    it('speed を 0.25〜4.0 にクランプする', () => {
        expect(parse({ speed: 10 }).speed).toBe(4);
        expect(parse({ speed: 0.01 }).speed).toBe(0.25);
    });

    it('speakerScale を irodori.cfg_scale_speaker に入れる', () => {
        expect(parse({ speakerScale: 2.5 }).irodori).toEqual({ cfg_scale_speaker: 2.5 });
    });

    it('caption と speakerScale を同じ irodori にまとめる', () => {
        expect(parse({ caption: '落ち着いた声', speakerScale: 3 }).irodori).toEqual({
            caption: '落ち着いた声',
            cfg_scale_speaker: 3,
        });
    });

    it('null・空文字・数値でない値は送らない', () => {
        expect(parse({ speed: null, speakerScale: '' })).not.toHaveProperty('speed');
        expect(parse({ speed: '', speakerScale: 'abc' })).not.toHaveProperty('irodori');
    });
});

describe('createTtsFilename', () => {
    const date = new Date(2026, 6, 27, 9, 5, 3); // 2026-07-27 09:05:03

    it('ターン番号と日時からwavのファイル名を作る', () => {
        expect(createTtsFilename(12, date)).toBe('Aquarium_Chat_tts_12_20260727-090503.wav');
    });

    it('ターン番号が無ければ message にする', () => {
        expect(createTtsFilename(undefined, date)).toBe('Aquarium_Chat_tts_message_20260727-090503.wav');
        expect(createTtsFilename('', date)).toBe('Aquarium_Chat_tts_message_20260727-090503.wav');
    });
});

describe('pickSpeechText', () => {
    it('選択範囲があればその部分だけを読む', () => {
        expect(pickSpeechText('全文です。ここも全文。', 'ここも全文。', true)).toBe('ここも全文。');
    });

    // 回帰: 選択が無いときに無音になると「押しても鳴らない」状態になるため必ず全文へ落とす
    it('選択が無ければ全文を読む', () => {
        expect(pickSpeechText('全文です。', '', true)).toBe('全文です。');
        expect(pickSpeechText('全文です。', null, true)).toBe('全文です。');
        expect(pickSpeechText('全文です。', undefined, true)).toBe('全文です。');
    });

    it('空白だけの選択は選択なし扱いにする', () => {
        expect(pickSpeechText('全文です。', '   \n  ', true)).toBe('全文です。');
    });

    it('設定がOFFなら選択範囲を無視して全文を読む', () => {
        expect(pickSpeechText('全文です。', 'ここだけ', false)).toBe('全文です。');
    });

    it('選択の前後の空白は取り除く', () => {
        expect(pickSpeechText('全文', '  ここだけ  ', true)).toBe('ここだけ');
    });
});

describe('parseStylePresets', () => {
    it('JSON配列を読む', () => {
        const json = JSON.stringify([{ name: '通常', caption: '自然に' }]);
        expect(parseStylePresets(json)).toEqual([{ name: '通常', caption: '自然に' }]);
    });

    it('配列をそのまま渡しても読む', () => {
        expect(parseStylePresets([{ name: '通常', caption: '自然に' }])).toEqual([
            { name: '通常', caption: '自然に' },
        ]);
    });

    it('名前・指示が欠けた要素は無視する', () => {
        const json = JSON.stringify([
            { name: '通常', caption: '自然に' },
            { name: '', caption: '指示だけ' },
            { name: '名前だけ', caption: '' },
            null,
        ]);
        expect(parseStylePresets(json)).toEqual([{ name: '通常', caption: '自然に' }]);
    });

    it('同じ名前は先に出たものを使う', () => {
        const json = JSON.stringify([
            { name: '通常', caption: '古い' },
            { name: '通常', caption: '新しい' },
        ]);
        expect(parseStylePresets(json)).toEqual([{ name: '通常', caption: '古い' }]);
    });

    // 旧形式（1行に「名前,指示」）で保存されていても読めるようにしてある
    it('旧形式の行区切りも読める', () => {
        expect(parseStylePresets('通常,自然に\n怒り,荒く')).toEqual([
            { name: '通常', caption: '自然に' },
            { name: '怒り', caption: '荒く' },
        ]);
    });

    it('旧形式では指示に含まれる「、」で切らない', () => {
        expect(parseStylePresets('怒り,強い怒りを込めた、荒い口調')).toEqual([
            { name: '怒り', caption: '強い怒りを込めた、荒い口調' },
        ]);
    });

    it('壊れたJSONでも落ちない', () => {
        expect(parseStylePresets('[{壊れて')).toEqual([]);
    });

    it('空・非文字列は空配列', () => {
        expect(parseStylePresets('')).toEqual([]);
        expect(parseStylePresets(null)).toEqual([]);
    });
});

describe('upsertStylePreset / removeStylePreset / serializeStylePresets', () => {
    const base = [{ name: '通常', caption: '自然に' }];

    it('新しい名前なら末尾に追加する', () => {
        expect(upsertStylePreset(base, '怒り', '荒く')).toEqual([
            { name: '通常', caption: '自然に' },
            { name: '怒り', caption: '荒く' },
        ]);
    });

    it('同じ名前なら指示を上書きする（順序は保つ）', () => {
        const out = upsertStylePreset([...base, { name: '怒り', caption: '荒く' }], '通常', 'とても自然に');
        expect(out).toEqual([
            { name: '通常', caption: 'とても自然に' },
            { name: '怒り', caption: '荒く' },
        ]);
    });

    it('名前や指示が空なら何も追加しない', () => {
        expect(upsertStylePreset(base, '', '指示')).toEqual(base);
        expect(upsertStylePreset(base, '名前', '')).toEqual(base);
    });

    it('前後の空白は取り除いて登録する', () => {
        expect(upsertStylePreset([], '  怒り  ', '  荒く  ')).toEqual([{ name: '怒り', caption: '荒く' }]);
    });

    it('指定した名前を削除する', () => {
        expect(removeStylePreset([...base, { name: '怒り', caption: '荒く' }], '怒り')).toEqual(base);
    });

    it('存在しない名前の削除は何も変えない', () => {
        expect(removeStylePreset(base, '無い名前')).toEqual(base);
    });

    it('保存用の文字列に変換して読み戻せる', () => {
        const text = serializeStylePresets(base);
        expect(parseStylePresets(text)).toEqual(base);
    });

    it('配列でないものを渡しても空として扱う', () => {
        expect(serializeStylePresets(null)).toBe('[]');
        expect(removeStylePreset(null, 'x')).toEqual([]);
    });
});

describe('resolveTtsCaption', () => {
    const presets = serializeStylePresets([
        { name: '通常', caption: '自然な話し方' },
        { name: '怒りモード', caption: '強い怒りを込めた、荒い口調' },
    ]);

    it('選択中のプリセットの指示を返す', () => {
        expect(resolveTtsCaption(presets, '怒りモード', '自由入力')).toBe('強い怒りを込めた、荒い口調');
    });

    it('プリセット未選択なら自由入力を使う', () => {
        expect(resolveTtsCaption(presets, '', '自由入力')).toBe('自由入力');
    });

    // 回帰: プリセットを削除したあとも古い選択名が残っていると空になりかねない
    it('選択名が定義に無ければ自由入力へ落とす', () => {
        expect(resolveTtsCaption(presets, '存在しない名前', '自由入力')).toBe('自由入力');
    });

    it('どちらも無ければ空文字（＝指定なし）', () => {
        expect(resolveTtsCaption('', '', '')).toBe('');
        expect(resolveTtsCaption(null, null, null)).toBe('');
    });
});
