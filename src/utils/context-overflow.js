// OpenAI互換APIで「max_tokens が文脈長に収まらない」400 を受けたときの立て直し。
// DOMにもDBにも触らない純粋関数だけを置く。
//
// 最大トークン数の設定は全プロバイダー共通なので、Claude などに合わせた 8192 のまま
// 文脈長 4096 の LLM-jp（さくらのAI Engine）に切り替えると、短い入力でも必ず 400 になる。
// モデルごとの文脈長は公表されていないことが多く、表を持つと推測で埋めることになるため、
// サーバーがエラー文で教えてくれる本当の文脈長と入力トークン数を使って送り直す。
//
// vLLM 系（さくらのAI Engine など）のエラー文の例:
//   'max_tokens' or 'max_completion_tokens' is too large: 8192. This model's maximum context
//   length is 4096 tokens and your request has 37 input tokens (8192 > 4096 - 37).
//   This model's maximum context length is 4096 tokens. However, you requested 8229 tokens
//   (37 in the messages, 8192 in the completion).

/** 送り直すときに入力と出力のあいだに空けておく余白（トークン） */
export const CONTEXT_OVERFLOW_MARGIN = 16;
/** これより少ない出力しか残らないなら、送り直さずに「履歴が長すぎます」と伝える */
export const MIN_OUTPUT_TOKENS = 256;

/**
 * エラー文から文脈長と入力トークン数を取り出す。読めなければ null。
 * @param {string} message
 * @returns {{contextLength:number, inputTokens:number}|null}
 */
export function parseContextOverflow(message) {
    if (typeof message !== 'string') return null;
    const ctx = /maximum context length is (\d+) tokens/i.exec(message);
    if (!ctx) return null;
    const input = /request has (\d+) input tokens/i.exec(message)
        || /\((\d+) in the messages/i.exec(message)
        || /messages resulted in (\d+) tokens/i.exec(message);
    if (!input) return null;
    return { contextLength: Number(ctx[1]), inputTokens: Number(input[1]) };
}

/**
 * 400 のエラー文と、送った max_tokens から、次にどうするかを決める。
 * @param {string} message エラー文（JSON の本文そのままでもよい）
 * @param {number|undefined} requested 送った max_tokens（送っていなければ undefined）
 * @returns {{action:'retry', maxTokens:number, contextLength:number, inputTokens:number}
 *          |{action:'tooLong', contextLength:number, inputTokens:number}
 *          |null} null はこの種類のエラーではない
 */
export function resolveContextOverflow(message, requested) {
    const parsed = parseContextOverflow(message);
    if (!parsed) return null;
    const room = parsed.contextLength - parsed.inputTokens - CONTEXT_OVERFLOW_MARGIN;
    if (room < MIN_OUTPUT_TOKENS) return { action: 'tooLong', ...parsed };
    // max_tokens を送っていない、または既に収まっているのに断られたなら、下げても直らない
    if (typeof requested !== 'number' || room >= requested) return null;
    return { action: 'retry', maxTokens: room, ...parsed };
}

/**
 * 「履歴が長すぎます」の案内文。
 * @param {{contextLength:number, inputTokens:number}} info
 * @returns {string}
 */
export function contextTooLongMessage({ contextLength, inputTokens }) {
    return `履歴が長すぎます。このモデルが一度に扱えるのは ${contextLength} トークンまでですが、`
        + `システムプロンプトと会話履歴だけで ${inputTokens} トークンあり、返答を書く余地がほとんどありません。`
        + '古いメッセージを削除するか、新しいチャットで続けてください。';
}

/**
 * 送って、文脈長の 400 なら max_tokens を下げて1回だけ送り直す。
 * 入力だけで埋まっているなら送り直さず「履歴が長すぎます」を投げる
 * （status 400 なのでリトライされずに、そのままチャットのエラーとして出る）。
 * @param {() => Promise<Response>} send requestBody をその場で JSON にして送る関数
 *   （下げた値で送り直せるように、本文は呼ぶたびに作る）
 * @param {{model?:string, max_tokens?:number}} requestBody 送り直すときは max_tokens を書き換える
 * @param {string} label ログに出すプロバイダー名
 * @returns {Promise<Response>}
 */
export async function fetchWithContextOverflowRetry(send, requestBody, label) {
    const response = await send();
    if (response.status !== 400) return response;
    const text = await response.clone().text().catch(() => '');
    const fix = resolveContextOverflow(text, requestBody.max_tokens);
    if (!fix) return response;
    if (fix.action === 'tooLong') {
        const e = new Error(contextTooLongMessage(fix));
        e.status = 400;
        throw e;
    }
    console.warn(`[max_tokens] ${label} ${requestBody.model}: ${requestBody.max_tokens} → ${fix.maxTokens}`
        + `（文脈長 ${fix.contextLength}・入力 ${fix.inputTokens}）に下げて送り直します`);
    requestBody.max_tokens = fix.maxTokens;
    return await send();
}
