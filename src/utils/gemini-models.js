// 「全プロバイダーの最新モデルを取得」で Gemini のモデル一覧を読む部分。
// DOMにもDBにも触らない（fetch は引数で受け取る）。
//
// 回帰: 以前は pageSize=100 の1ページ目だけを読んでいた。Gemini API の一覧には
// 埋め込み・画像・動画・Gemma なども並ぶので100件では収まらず、2ページ目以降に
// 載った新しいモデル（Gemini 4 Carbon など）が取得しても出てこなかった。
// 一覧は1ページ最大1000件で、続きがあれば nextPageToken が返る。
// https://ai.google.dev/api/models#method:-models.list

export const GEMINI_MODELS_LIST_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
/** 1ページに頼む件数（API の上限） */
export const GEMINI_LIST_PAGE_SIZE = 1000;
/** 念のための上限。nextPageToken が返り続けても、これ以上は読まない */
export const GEMINI_LIST_MAX_PAGES = 10;

/**
 * 一覧の1ページぶんの URL。
 * @param {string} apiKey
 * @param {string} [pageToken]
 * @returns {string}
 */
export function geminiModelsListUrl(apiKey, pageToken) {
    let url = `${GEMINI_MODELS_LIST_URL}?key=${encodeURIComponent(apiKey)}&pageSize=${GEMINI_LIST_PAGE_SIZE}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    return url;
}

/**
 * 全ページを読み、モデルの一覧（API の形のまま）を返す。
 * どこかのページで失敗したら、その応答を返す（呼び出し側がエラー文を読む）。
 * @param {string} apiKey
 * @param {(url: string) => Promise<Response>} fetchFn
 * @returns {Promise<{ok: true, models: object[]} | {ok: false, response: Response}>}
 */
export async function listAllGeminiModels(apiKey, fetchFn) {
    const models = [];
    let pageToken = '';
    for (let page = 0; page < GEMINI_LIST_MAX_PAGES; page++) {
        const response = await fetchFn(geminiModelsListUrl(apiKey, pageToken));
        if (!response.ok) return { ok: false, response };
        const data = await response.json();
        models.push(...(data.models || []));
        pageToken = data.nextPageToken || '';
        if (!pageToken) break;
    }
    return { ok: true, models };
}

/**
 * チャットに使える Gemini モデルの ID だけを取り出す
 * （generateContent に対応していて、名前に gemini を含むもの）。
 * @param {object[]} models API の一覧の models
 * @returns {string[]} 'models/' を外した ID
 */
export function pickGeminiChatModelIds(models) {
    return (models || [])
        .filter(m => m && m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => String(m.name || '').replace('models/', ''))
        .filter(id => id.includes('gemini'));
}
