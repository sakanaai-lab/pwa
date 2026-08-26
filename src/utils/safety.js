// Gemini のセーフティ設定（センシティブフィルター）をまとめる。
//
// 公式ドキュメントで調整できるのは次の4カテゴリだけ。CIVIC_INTEGRITY / JAILBREAK は
// HarmCategory の列挙には出てくるが safetySettings では設定できないため、送ると
// 400 になる。増やさないこと。
// 児童安全など中核的な危害は設定に関係なく常にブロックされる（API側の固定）。
export const GEMINI_ADJUSTABLE_HARM_CATEGORIES = [
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_DANGEROUS_CONTENT',
];

// 'OFF' はフィルターそのものを止める。'BLOCK_NONE' は判定はした上で確率に関わらず
// 返す、という意味なので 'OFF' の方が緩い。Gemini 2.5 / 3 系は既定が 'OFF' で、
// むしろ 'BLOCK_NONE' を明示する方が厳しくなっていた。
// ただし 'OFF' に対応しない古いモデルもあるため、拒否されたら 'BLOCK_NONE' へ落とす。
export const GEMINI_SAFETY_THRESHOLD_PRIMARY = 'OFF';
export const GEMINI_SAFETY_THRESHOLD_FALLBACK = 'BLOCK_NONE';

// 現在の閾値。'OFF' が拒否された時点で 'BLOCK_NONE' に落ちる。
// 保存はしない（＝再読み込みで 'OFF' から試し直す）。モデル側が対応した時に
// 設定を消して回らなくても自然に復帰させるため。
let currentThreshold = GEMINI_SAFETY_THRESHOLD_PRIMARY;

/**
 * いま使う safetySettings を組み立てて返す。
 * @returns {Array<{category: string, threshold: string}>}
 */
export function getGeminiSafetySettings() {
    return GEMINI_ADJUSTABLE_HARM_CATEGORIES.map((category) => ({
        category,
        threshold: currentThreshold,
    }));
}

/** 現在の閾値を返す（表示・テスト用）。 */
export function getGeminiSafetyThreshold() {
    return currentThreshold;
}

/** 閾値を 'OFF' に戻す（テスト用）。 */
export function resetGeminiSafetyThreshold() {
    currentThreshold = GEMINI_SAFETY_THRESHOLD_PRIMARY;
}

/**
 * エラー応答が「safetySettings の閾値が受け付けられなかった」ものかを判定する。
 *
 * 400 は他の理由（モデル名が違う・リクエストが壊れている等）でも出るので、
 * セーフティ設定に触れている文言があるときだけ true にする。
 * ここで誤爆すると、本当の原因を隠したまま無駄な再送をしてしまう。
 *
 * @param {object|null} errorData APIのエラーレスポンス(JSON)
 * @returns {boolean}
 */
export function isSafetyThresholdRejection(errorData) {
    const message = errorData?.error?.message;
    if (typeof message !== 'string' || !message) return false;
    const m = message.toLowerCase();
    const mentionsSafety = m.includes('safety_settings')
        || m.includes('safetysettings')
        || m.includes('harmblockthreshold')
        || m.includes('harm_category');
    if (!mentionsSafety) return false;
    // 閾値そのものが弾かれている場合に限る（カテゴリ名の誤りなどは対象外）
    return m.includes('threshold') || m.includes('off') || m.includes('invalid');
}

/**
 * 閾値の拒否を受けて 'BLOCK_NONE' へ落とす。
 * @param {object|null} errorData APIのエラーレスポンス(JSON)
 * @returns {boolean} 実際に落としたときだけ true（＝再送する価値がある）
 */
export function noteGeminiSafetyRejection(errorData) {
    if (currentThreshold === GEMINI_SAFETY_THRESHOLD_FALLBACK) return false;
    if (!isSafetyThresholdRejection(errorData)) return false;
    currentThreshold = GEMINI_SAFETY_THRESHOLD_FALLBACK;
    console.warn(
        `[Safety] このモデルは threshold='${GEMINI_SAFETY_THRESHOLD_PRIMARY}' に非対応でした。`
        + `'${GEMINI_SAFETY_THRESHOLD_FALLBACK}' で送り直します。`
    );
    return true;
}

/**
 * Gemini へ POST する。'OFF' が拒否されたら 'BLOCK_NONE' に落として一度だけ送り直す。
 *
 * requestBody.safetySettings は呼び出し側で getGeminiSafetySettings() を入れておくこと。
 * 再送時はこの関数が新しい閾値で差し替える。
 *
 * @param {string} endpoint
 * @param {object} init fetch のオプション（body 以外。headers/signal など）
 * @param {object} requestBody 送信するリクエストボディ（再送時に書き換える）
 * @returns {Promise<Response>}
 */
export async function fetchGeminiWithSafetyRetry(endpoint, init, requestBody) {
    const send = () => fetch(endpoint, { ...init, body: JSON.stringify(requestBody) });

    const response = await send();
    if (response.ok || response.status !== 400) return response;

    // 本文は呼び出し側でも読むので clone してから覗く
    let errorData = null;
    try {
        errorData = await response.clone().json();
    } catch (e) {
        return response;
    }
    if (!noteGeminiSafetyRejection(errorData)) return response;

    requestBody.safetySettings = getGeminiSafetySettings();
    return send();
}
