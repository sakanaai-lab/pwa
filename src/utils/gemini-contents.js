// Gemini（generateContent）に送る会話履歴の最後の整形。DOMにもDBにも触らない純粋関数だけを置く。
//
// アプリの中では、関数（ツール）の実行結果を role: 'tool' のメッセージとして持っている。
// OpenAI 互換や Anthropic などのアダプタはそれぞれの形に直して送るが、Gemini には
// これまでそのまま送っていた。
//
// 回帰: Gemini 4 Carbon は role を厳しく確かめるため、
//   「Role 'tool' is not supported. Please use a valid role: ... USER, ... MODEL ...」
// の 400 で断られた（関数を使ったことのある会話・関数を呼んだ直後の応答で起きる）。
// 古いモデルは 'tool' を黙って受け付けていたが、公式の書き方では関数の結果は
// role: 'user' のターンに functionResponse として入れる。
// https://ai.google.dev/gemini-api/docs/function-calling
//
// あわせて次の2つも直す。
// - 並列に呼んだ関数の結果が続くときは、公式の書き方どおり1つの user ターンにまとめる
// - functionResponse に付けているアプリ内部の _toolCallId（OpenAI 互換用）は Gemini に送らない

/**
 * 1つの part から、Gemini に送らないアプリ内部の項目を取り除く。
 * @param {object} part
 * @returns {object}
 */
function cleanPart(part) {
    if (!part || !part.functionResponse || !('_toolCallId' in part.functionResponse)) return part;
    const { _toolCallId, ...functionResponse } = part.functionResponse;
    return { ...part, functionResponse };
}

/**
 * アプリ内部の会話履歴を、Gemini の contents に直す。
 * @param {Array<{role: string, parts: object[]}>} messages
 * @returns {Array<{role: string, parts: object[]}>}
 */
export function toGeminiContents(messages) {
    const contents = [];
    let lastWasTool = false;
    for (const msg of messages || []) {
        if (!msg) continue;
        const isTool = msg.role === 'tool';
        const parts = (msg.parts || []).map(cleanPart);
        if (isTool && lastWasTool) {
            // 並列に呼んだ関数の結果は、1つの user ターンにまとめる
            contents[contents.length - 1].parts.push(...parts);
        } else {
            contents.push({ ...msg, role: isTool ? 'user' : msg.role, parts });
        }
        lastWasTool = isTool;
    }
    return contents;
}
