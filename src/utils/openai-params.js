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

/** 設定画面に出す順（弱い → 強い） */
export const OPENAI_REASONING_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

// モデルごとに選べる推論の強さ（各モデルのページの記載。前方一致）。
// 'gpt-6-sol' は前方一致で 'gpt-6-1-sol' に当たらない（正規化後は 'gpt-6-1-sol'）。
const REASONING_LEVELS_BY_MODEL = [
    ['gpt-6-luna',  ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['gpt-6-sol',   ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['gpt-6-1-sol', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['gpt-6-1-terra', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['gpt-6-astra', ['low', 'medium', 'high', 'xhigh', 'max']],
];

/**
 * 選択中のモデルで選べる推論の強さを返す。
 * 表に無い推論モデル（o 系・GPT-5 系・今後のモデル）は、対応外の値を送って 400 になるより
 * 選べないほうがよいので、どのモデルにもある low / medium / high に絞る。
 * @param {string} model
 * @returns {string[]|null} null は推論モデルではない（項目を隠す）
 */
export function getOpenAIReasoningLevels(model) {
    if (!openaiIsReasoningModel(model)) return null;
    const m = normalizeModelName(model);
    const hit = REASONING_LEVELS_BY_MODEL.find(([p]) => m.startsWith(p));
    return hit ? hit[1] : ['low', 'medium', 'high'];
}

/**
 * 推論の強さに 'none' を指定できるか。
 * @param {string} model
 * @returns {boolean}
 */
export function openaiSupportsReasoningNone(model) {
    const levels = getOpenAIReasoningLevels(model);
    return !!levels && levels.includes('none');
}

/**
 * 設定値を、そのモデルに送ってよい推論の強さに直す。送らないなら null（モデルの既定）。
 * @param {string} model
 * @param {string} effort 設定値（'' はモデルの既定）
 * @returns {string|null}
 */
export function resolveOpenAIReasoningEffort(model, effort) {
    const e = typeof effort === 'string' ? effort.trim().toLowerCase() : '';
    if (!e) return null;
    const levels = getOpenAIReasoningLevels(model);
    return levels && levels.includes(e) ? e : null;
}
