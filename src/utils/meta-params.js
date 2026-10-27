// Meta Model API（Muse）に送るパラメータの判定。DOMにもDBにも触らない純粋関数だけを置く。
//
// Muse Spark / Wonder は常に推論する（reasoning_effort: 'none' は 400）。
// https://dev.meta.ai/docs/reasoning
// 推論の中身（reasoning_content）は外部の API キーには空で返るので、思考の表示はできない。
// タイトル生成・翻訳・メモリ学習のような短い作業では、推論で小さい max_tokens を使い切って
// 本文が空にならないよう、いちばん軽い 'minimal' を指定する。

/**
 * Muse のモデルか。
 * @param {string} model
 * @returns {boolean}
 */
export function isMetaMuseModel(model) {
    return typeof model === 'string' && model.toLowerCase().startsWith('muse-');
}

/**
 * 短い作業向けに推論をいちばん軽くするパラメータ。Muse 以外なら null。
 * @param {string} model
 * @returns {object|null}
 */
export function metaLightReasoningParams(model) {
    return isMetaMuseModel(model) ? { reasoning_effort: 'minimal' } : null;
}

/**
 * 学習に使われる代わりに安い Contributor 版か。
 * @param {string} model
 * @returns {boolean}
 */
export function isMetaContributorModel(model) {
    return isMetaMuseModel(model) && model.toLowerCase().endsWith('-contributor');
}
