import { describe, it, expect } from 'vitest';
import { normalizeTtsBaseUrl, buildSpeechRequest, createTtsFilename, pickSpeechText, parseStylePresets, resolveTtsCaption, DEFAULT_TTS_VOICE } from '../src/utils/tts.js';

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
    it('「名前,指示」を解析する', () => {
        expect(parseStylePresets('通常,落ち着いた自然な話し方。')).toEqual([
            { name: '通常', caption: '落ち着いた自然な話し方。' },
        ]);
    });

    // 指示の中に句読点の「、」が入るので、最初の区切りだけで分割する必要がある
    it('指示に含まれる「、」で切ってしまわない', () => {
        expect(parseStylePresets('怒りモード,強い怒りを込めた、荒く低い口調。')).toEqual([
            { name: '怒りモード', caption: '強い怒りを込めた、荒く低い口調。' },
        ]);
    });

    it('区切りに 、 : ： も使える', () => {
        expect(parseStylePresets('通常、自然な声')[0]).toEqual({ name: '通常', caption: '自然な声' });
        expect(parseStylePresets('通常:自然な声')[0]).toEqual({ name: '通常', caption: '自然な声' });
        expect(parseStylePresets('通常：自然な声')[0]).toEqual({ name: '通常', caption: '自然な声' });
    });

    it('複数行を順番どおりに解析する', () => {
        const presets = parseStylePresets('通常,自然に\n怒り,荒く\nASMR風,ささやくように');
        expect(presets.map((p) => p.name)).toEqual(['通常', '怒り', 'ASMR風']);
    });

    it('空行・名前だけ・指示だけの行は無視する', () => {
        expect(parseStylePresets('通常,自然に\n\n名前だけ\n,指示だけ')).toEqual([
            { name: '通常', caption: '自然に' },
        ]);
    });

    it('同じ名前が複数あれば最初のものを使う', () => {
        expect(parseStylePresets('通常,古い\n通常,新しい')).toEqual([{ name: '通常', caption: '古い' }]);
    });

    it('空・非文字列は空配列', () => {
        expect(parseStylePresets('')).toEqual([]);
        expect(parseStylePresets(null)).toEqual([]);
    });
});

describe('resolveTtsCaption', () => {
    const presets = '通常,自然な話し方\n怒りモード,強い怒りを込めた、荒い口調';

    it('選択中のプリセットの指示を返す', () => {
        expect(resolveTtsCaption(presets, '怒りモード', '自由入力')).toBe('強い怒りを込めた、荒い口調');
    });

    it('プリセット未選択なら自由入力を使う', () => {
        expect(resolveTtsCaption(presets, '', '自由入力')).toBe('自由入力');
    });

    // 回帰: プリセット定義を消したあとも古い選択名が残っていると空になりかねない
    it('選択名が定義に無ければ自由入力へ落とす', () => {
        expect(resolveTtsCaption(presets, '存在しない名前', '自由入力')).toBe('自由入力');
    });

    it('どちらも無ければ空文字（＝指定なし）', () => {
        expect(resolveTtsCaption('', '', '')).toBe('');
        expect(resolveTtsCaption(null, null, null)).toBe('');
    });
});
