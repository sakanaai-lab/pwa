// OpenAI（純正）に送るパラメータの判定。DOMにもDBにも触らない純粋関数だけを置く。
//
// GPT-5 以降と o 系は推論モデルで、Chat Completions では次の制約がある
// （GPT-6 開発者ガイド https://developers.openai.com/api/docs/guides/latest-model ）:
//   - 推論の強さが none 以外のときは temperature / top_p / top_logprobs を外す
//   - 出力上限は max_tokens ではなく max_completion_tokens
// アプリは推論の強さを送らないので各モデルの既定（GPT-6 は medium）になる。
// そのため、これらのモデルには temperature / top_p を送らない。
//
// GPT-4.x から GPT-6 Luna への移行案内では、推論の強さを none から始めるよう勧めている。
// none を受け付けるのは GPT-6 Sol と GPT-6 Luna だけで、Astra と 6.1 Sol は受け付けない。

import { normalizeModelName } from './pricing.js';

/**
 * 推論モデル（temperature / top_p を送らず、max_completion_tokens を使う）か。
 * 'gpt-4o' / 'gpt-4.1' は false。今後の GPT-7 なども推論モデルとして扱う。
 * @param {string} model
 * @returns {boolean}
 */
export function openaiIsReasoningModel(model) {
    const m = normalizeModelName(model);
    if (/^o\d/.test(m)) return true;
    const g = /^gpt-(\d+)/.exec(m);
    return !!g && Number(g[1]) >= 5;
}

// 推論の強さに none を指定できると公式に書かれているモデル。
// 'gpt-6-sol' は前方一致で 'gpt-6-1-sol' に当たらない（正規化後は 'gpt-6-1-sol'）。
const SUPPORTS_NONE = ['gpt-6-luna', 'gpt-6-sol'];

/**
 * 推論の強さに 'none' を指定できるか。
 * @param {string} model
 * @returns {boolean}
 */
export function openaiSupportsReasoningNone(model) {
    const m = normalizeModelName(model);
    return SUPPORTS_NONE.some((p) => m.startsWith(p));
}
