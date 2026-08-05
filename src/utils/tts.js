// Irodori-TTS-Server（OpenAI TTS API 互換）連携。
//
// POST {ベースURL}/v1/audio/speech に JSON を送ると wav バイナリが返るので、
// それを Blob として受け取り Audio で再生する。
// ベースURLは cloudflared のトンネルURLで、起動のたびに変わる想定。

import { formatTimestamp } from './format.js';

const TTS_PATH = '/v1/audio/speech';
const TTS_MODEL = 'irodori-tts';
export const DEFAULT_TTS_VOICE = 'hanako';

// speed の許容範囲（サーバー仕様）。範囲外を送ると400になるのでクランプする。
const SPEED_MIN = 0.25;
const SPEED_MAX = 4.0;

// iOSの自動再生制限を解除するための無音WAV（1サンプル）。
const SILENT_WAV =
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

// 再生中の音声。新しい再生が始まったら前のものを止めるために保持する。
let currentAudio = null;
let currentObjectUrl = null;
let currentController = null;
// 再生要求の世代。停止や再要求のあとに、古い要求の音声が鳴り出すのを防ぐ。
let generation = 0;
// 直近に生成した音声を1件だけ保持する。読み上げた直後に保存するとき、
// 同じ内容なら生成し直さずに済ませるため（生成には数秒〜かかる）。
let lastBlob = null;
let lastKey = null;

/** 生成結果の同一性を判定するキー。内容か設定が変われば作り直す。 */
function cacheKey(text, settings = {}) {
    return JSON.stringify([
        String(text),
        settings.voice || '',
        settings.caption || '',
        settings.speed ?? '',
        settings.speakerScale ?? '',
    ]);
}

/** プリセット配列を正規化する（名前・指示が揃っているものだけ、重複名は先勝ち）。 */
function normalizePresets(list) {
    const presets = [];
    const seen = new Set();
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        const caption = typeof item.caption === 'string' ? item.caption.trim() : '';
        if (!name || !caption || seen.has(name)) continue;
        seen.add(name);
        presets.push({ name, caption });
    }
    return presets;
}

/** 旧形式（1行に「名前,指示」）を読む。区切りは最初の1つだけ（指示に「、」が入りうるため）。 */
function parseLegacyPresetLines(text) {
    const presets = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const m = trimmed.match(/^([^,、:：]+)[,、:：]([\s\S]*)$/);
        if (!m) continue;
        presets.push({ name: m[1], caption: m[2] });
    }
    return normalizePresets(presets);
}

/**
 * 読み上げスタイルのプリセットを解析する。
 * 保存形式はJSON配列。過去に使っていた行区切り形式も読めるようにしてある。
 * @param {string|Array} stored
 * @returns {Array<{name: string, caption: string}>}
 */
export function parseStylePresets(stored) {
    if (Array.isArray(stored)) return normalizePresets(stored);
    if (!stored || typeof stored !== 'string') return [];
    const trimmed = stored.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return normalizePresets(parsed);
        } catch {
            /* JSONとして壊れていれば旧形式として読み直す */
        }
    }
    return parseLegacyPresetLines(trimmed);
}

/** プリセット配列を保存用の文字列にする。 */
export function serializeStylePresets(presets) {
    return JSON.stringify(normalizePresets(Array.isArray(presets) ? presets : []));
}

/**
 * プリセットを追加または更新する（同じ名前があれば指示を差し替え、無ければ末尾に追加）。
 * @returns {Array<{name: string, caption: string}>} 新しい配列
 */
export function upsertStylePreset(presets, name, caption) {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const trimmedCaption = typeof caption === 'string' ? caption.trim() : '';
    if (!trimmedName || !trimmedCaption) return normalizePresets(presets || []);
    const list = normalizePresets(presets || []);
    const at = list.findIndex((p) => p.name === trimmedName);
    if (at >= 0) list[at] = { name: trimmedName, caption: trimmedCaption };
    else list.push({ name: trimmedName, caption: trimmedCaption });
    return list;
}

/** 指定した名前のプリセットを削除する。 */
export function removeStylePreset(presets, name) {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    return normalizePresets(presets || []).filter((p) => p.name !== trimmedName);
}

/**
 * 実際に送るキャプションを決める。
 * プリセットが選ばれていればそれを、選ばれていなければ自由入力欄を使う。
 * @param {string} presetsText - プリセット定義
 * @param {string} selectedName - 選択中のプリセット名（未選択なら空）
 * @param {string} freeText - 自由入力欄の内容
 * @returns {string}
 */
export function resolveTtsCaption(presetsText, selectedName, freeText) {
    const name = typeof selectedName === 'string' ? selectedName.trim() : '';
    if (name) {
        const hit = parseStylePresets(presetsText).find((p) => p.name === name);
        if (hit) return hit.caption;
    }
    return typeof freeText === 'string' ? freeText : '';
}

/**
 * 読み上げる文字列を決める。
 * 選択範囲があればそこだけ、無ければメッセージ全文を読む。
 * 「選択が無いと無音になる」のを避けるため、必ず全文へフォールバックする。
 * @param {string} fullText - メッセージ全文
 * @param {string} selectedText - 選択されている文字列（無ければ空）
 * @param {boolean} useSelection - 選択範囲を優先する設定
 * @returns {string}
 */
export function pickSpeechText(fullText, selectedText, useSelection) {
    if (!useSelection) return fullText;
    const selected = typeof selectedText === 'string' ? selectedText.trim() : '';
    return selected || fullText;
}

/** 数値設定を取り出す。空欄・未設定・数値でないものは null（＝送らない）。 */
function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(num) ? num : null;
}

/**
 * ベースURLを正規化する。末尾のスラッシュや、誤ってエンドポイントごと
 * 貼り付けられた場合の `/v1/audio/speech` を取り除く。
 * @param {string} url
 * @returns {string}
 */
export function normalizeTtsBaseUrl(url) {
    if (!url || typeof url !== 'string') return '';
    let base = url.trim().replace(/\/+$/, '');
    if (base.toLowerCase().endsWith(TTS_PATH)) {
        base = base.slice(0, -TTS_PATH.length).replace(/\/+$/, '');
    }
    return base;
}

/**
 * 音声合成リクエスト（URLとfetchオプション）を組み立てる。
 * caption / speed / speakerScale は未設定なら送らないので、既定の挙動は変わらない。
 * @param {string} baseUrl - TTSサーバーのベースURL
 * @param {string} text - 読み上げるテキスト
 * @param {string} [voice] - 音声ID
 * @param {{caption?: string, speed?: number|string, speakerScale?: number|string}} [extra]
 * @returns {{url: string, options: object}}
 */
export function buildSpeechRequest(baseUrl, text, voice, extra = {}) {
    const base = normalizeTtsBaseUrl(baseUrl);
    if (!base) throw new Error('TTSサーバーURLが設定されていません。');
    if (!text || !String(text).trim()) throw new Error('読み上げるテキストがありません。');

    const body = {
        model: TTS_MODEL,
        input: String(text),
        voice: voice || DEFAULT_TTS_VOICE,
        response_format: 'wav',
    };

    const speed = toFiniteNumber(extra.speed);
    if (speed !== null) {
        body.speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
    }

    // サーバー独自の拡張は irodori オブジェクトに入れて送る。
    const irodori = {};
    const caption = typeof extra.caption === 'string' ? extra.caption.trim() : '';
    if (caption) irodori.caption = caption;
    const speakerScale = toFiniteNumber(extra.speakerScale);
    if (speakerScale !== null) irodori.cfg_scale_speaker = speakerScale;
    if (Object.keys(irodori).length > 0) body.irodori = irodori;

    return {
        url: `${base}${TTS_PATH}`,
        options: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        },
    };
}

/**
 * iOS Safari の自動再生制限を解除した Audio 要素を作る。
 * 「タップ → 数秒かかる生成 → 再生」の流れだと、再生時にはユーザー操作の文脈が
 * 切れていて再生を拒否される。タップと同じ同期処理の中でこれを呼び、
 * 無音を一瞬鳴らして再生権を得た要素を使い回すことで回避する。
 * @returns {HTMLAudioElement}
 */
export function createUnlockedAudio() {
    const audio = new Audio(SILENT_WAV);
    try {
        const played = audio.play();
        if (played && typeof played.then === 'function') {
            played.then(() => audio.pause()).catch(() => { /* 解除できなくても続行する */ });
        }
    } catch {
        /* 解除できなくても続行する */
    }
    return audio;
}

/**
 * 音声を合成して Blob を返す。再生も保存もここを通す。
 * @param {string} text
 * @param {object} settings - baseUrl / voice / caption / speed / speakerScale
 * @param {AbortSignal} [signal]
 * @returns {Promise<Blob>}
 */
async function fetchSpeechBlob(text, settings, signal) {
    const { url, options } = buildSpeechRequest(settings.baseUrl, text, settings.voice, settings);

    let response;
    try {
        response = await fetch(url, { ...options, signal });
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        // サーバー停止・トンネルURLの期限切れ・CORS未許可などはここに来る
        throw new Error(`TTSサーバーに接続できませんでした（サーバー停止・URLの期限切れ・CORS設定をご確認ください）: ${error.message}`);
    }

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`TTSサーバーがエラーを返しました (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }

    const blob = await response.blob();
    lastBlob = blob;
    lastKey = cacheKey(text, settings);
    return blob;
}

/**
 * 保存用のファイル名を作る。
 * @param {string|number} [turn] - ターン番号（あれば）
 * @param {Date} [date]
 * @returns {string}
 */
export function createTtsFilename(turn, date = new Date()) {
    const turnPart = turn === undefined || turn === null || turn === '' ? 'message' : String(turn);
    return `Aquarium_Chat_tts_${turnPart}_${formatTimestamp(date)}.wav`;
}

/**
 * テキストを音声に変換して wav ファイルとして保存する。
 * 直前に同じ内容を読み上げていれば、その音声を使い回して生成し直さない。
 * @param {string} text
 * @param {object} settings - baseUrl / voice / caption / speed / speakerScale / filename
 * @returns {Promise<void>}
 */
export async function saveSpeech(text, settings = {}) {
    const key = cacheKey(text, settings);
    const blob = lastBlob && lastKey === key
        ? lastBlob
        : await fetchSpeechBlob(text, settings);

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = settings.filename || createTtsFilename();
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

/** 再生中の音声を停止し、リソースを解放する。 */
export function stopSpeech() {
    generation++;
    if (currentController) {
        currentController.abort();
        currentController = null;
    }
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
    }
}

/**
 * テキストを読み上げる。再生中に呼ばれた場合は前の再生を停止してから開始する。
 * @param {string} text - 読み上げるテキスト
 * @param {{baseUrl: string, voice?: string, caption?: string, speed?: number|string,
 *          speakerScale?: number|string, audio?: HTMLAudioElement}} settings
 * @returns {Promise<boolean>} 再生を開始したら true（新しい要求に追い越された場合は false）
 */
export async function speak(text, settings = {}) {
    const { audio: providedAudio } = settings;
    // URL未設定などはここで弾く（fetchより前に検証する）
    buildSpeechRequest(settings.baseUrl, text, settings.voice, settings);

    stopSpeech(); // 前の再生を止める（generation もここで進む）
    const myGeneration = generation;
    const controller = new AbortController();
    currentController = controller;

    let blob;
    try {
        blob = await fetchSpeechBlob(text, settings, controller.signal);
    } catch (error) {
        if (currentController === controller) currentController = null;
        if (error?.name === 'AbortError') return false;
        throw error;
    }
    if (currentController === controller) currentController = null;
    if (myGeneration !== generation) return false; // 待っている間に新しい要求が来た

    const objectUrl = URL.createObjectURL(blob);
    // iOS対策で先に解除済みの要素が渡されていればそれを使う（無ければその場で作る）
    const audio = providedAudio || new Audio();
    audio.src = objectUrl;
    currentAudio = audio;
    currentObjectUrl = objectUrl;

    const release = () => {
        if (currentObjectUrl === objectUrl) {
            URL.revokeObjectURL(objectUrl);
            currentObjectUrl = null;
            currentAudio = null;
        }
    };
    audio.addEventListener('ended', release);
    audio.addEventListener('error', release);

    try {
        await audio.play();
    } catch (error) {
        release();
        throw new Error(`音声の再生に失敗しました: ${error.message}`);
    }
    return true;
}
