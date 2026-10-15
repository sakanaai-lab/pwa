// Claude の「思考の深さ: OFF（思考なし）」をモデルごとに正しく送るための判定。
// DOMにもDBにも触らない純粋関数だけを置く。
//
// 以前は OFF のとき全モデルに thinking: { type: 'disabled' } を送っていたが、
// 新しいモデルでは受け付けない（Claude API の公式ドキュメントより）:
//   - Fable 5 / 5.1、Mythos 5 / 5.1、Opus 5.5: 思考は常に ON。disabled は 400。
//     thinking を送らず、Effort をいちばん低い low にするしかない
//   - Sonnet 5.5: disabled は 400。思考を止めるには { type: 'between_tools' }
//     （Effort が high 以下のときだけ。OFF では Effort を送らないので既定の high になる）
//   - Opus 5 / Sonnet 5 / Haiku 5.5 など: disabled を受け付ける（Effort high 以下。OFF では送らない）
//   - Claude 3.x / 2.x: thinking パラメータ自体が無い

import { normalizeModelName } from './pricing.js';

// 思考を止められないモデル（前方一致。'claude-fable-5' は 5.1 も含む）
const ALWAYS_THINKS = ['claude-fable-5', 'claude-mythos-5', 'claude-opus-5-5'];
// disabled の代わりに between_tools で止めるモデル
const BETWEEN_TOOLS = ['claude-sonnet-5-5'];

/**
 * 思考を止められないモデルか（OFF を選んでも low で考える）。
 * @param {string} model
 * @returns {boolean}
 */
export function anthropicAlwaysThinks(model) {
    const m = normalizeModelName(model);
    return ALWAYS_THINKS.some((p) => m.startsWith(p));
}

/**
 * 「OFF（思考なし）」のときに送る thinking と Effort。
 * @param {string} model
 * @returns {{ thinking: object|null, effort: string|null }}
 *   thinking が null なら thinking を送らない。effort が null なら Effort を送らない
 */
export function anthropicThinkingOff(model) {
    const m = normalizeModelName(model);
    if (m.startsWith('claude-3') || m.startsWith('claude-2')) return { thinking: null, effort: null };
    if (ALWAYS_THINKS.some((p) => m.startsWith(p))) return { thinking: null, effort: 'low' };
    if (BETWEEN_TOOLS.some((p) => m.startsWith(p))) return { thinking: { type: 'between_tools' }, effort: null };
    return { thinking: { type: 'disabled' }, effort: null };
}
