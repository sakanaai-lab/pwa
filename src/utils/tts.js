// Irodori-TTS-Server（OpenAI TTS API 互換）連携。
//
// POST {ベースURL}/v1/audio/speech に JSON を送ると wav バイナリが返るので、
// それを Blob として受け取り Audio で再生する。
// ベースURLは cloudflared のトンネルURLで、起動のたびに変わる想定。

const TTS_PATH = '/v1/audio/speech';
const TTS_MODEL = 'irodori-tts';
export const DEFAULT_TTS_VOICE = 'kouko';

// 再生中の音声。新しい再生が始まったら前のものを止めるために保持する。
let currentAudio = null;
let currentObjectUrl = null;
let currentController = null;
// 再生要求の世代。停止や再要求のあとに、古い要求の音声が鳴り出すのを防ぐ。
let generation = 0;

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
 * @param {string} baseUrl - TTSサーバーのベースURL
 * @param {string} text - 読み上げるテキスト
 * @param {string} [voice] - 音声ID
 * @returns {{url: string, options: object}}
 */
export function buildSpeechRequest(baseUrl, text, voice) {
    const base = normalizeTtsBaseUrl(baseUrl);
    if (!base) throw new Error('TTSサーバーURLが設定されていません。');
    if (!text || !String(text).trim()) throw new Error('読み上げるテキストがありません。');
    return {
        url: `${base}${TTS_PATH}`,
        options: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: TTS_MODEL,
                input: String(text),
                voice: voice || DEFAULT_TTS_VOICE,
                response_format: 'wav',
            }),
        },
    };
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
 * @param {{baseUrl: string, voice?: string}} settings
 * @returns {Promise<boolean>} 再生を開始したら true（新しい要求に追い越された場合は false）
 */
export async function speak(text, { baseUrl, voice } = {}) {
    const { url, options } = buildSpeechRequest(baseUrl, text, voice);

    stopSpeech(); // 前の再生を止める（generation もここで進む）
    const myGeneration = generation;
    const controller = new AbortController();
    currentController = controller;

    let response;
    try {
        response = await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (currentController === controller) currentController = null;
        if (error?.name === 'AbortError') return false;
        // サーバー停止・トンネルURLの期限切れ・CORS未許可などはここに来る
        throw new Error(`TTSサーバーに接続できませんでした（サーバー停止・URLの期限切れ・CORS設定をご確認ください）: ${error.message}`);
    }
    if (currentController === controller) currentController = null;
    if (myGeneration !== generation) return false;

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`TTSサーバーがエラーを返しました (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }

    const blob = await response.blob();
    if (myGeneration !== generation) return false; // 待っている間に新しい要求が来た

    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
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
