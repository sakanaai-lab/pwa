// モデル選択に出す表示名。DOMにもDBにも触らない純粋関数だけを置く。
//
// 「12/31 まで半額」のような期間限定の説明は、表示名に直接書くと割引が終わったあとに
// 書き換えが要る。そこで、推定コストの切り替えに使っている終了日時と同じ定数を見て、
// 期間中だけ説明を付ける。表示と推定コストが同じ日時で切り替わる。
//
// 新しい割引を足すときは、pricing.js に単価と終了日時を足したうえで、ここにも1行足す。

import { GEMINI_FLASH_PROMO_END_AT, GEMINI_ARGON_INTRO_END_AT } from './pricing.js';

/** 期間限定の割引。endAt は割引が終わる日時（この時刻からは通常単価） */
export const MODEL_PROMOS = [
    { models: ['gemini-4-carbon', 'gemini-4-argon'], endAt: GEMINI_ARGON_INTRO_END_AT, note: '半額' },
    { models: ['gemini-3.8-flash', 'gemini-3.6-flash'], endAt: GEMINI_FLASH_PROMO_END_AT, note: '半額' },
];

/**
 * 割引の最終日を「M/D」で返す。終了日時の直前の日付（料金ページの「Through Nov 30」に合わせて UTC）。
 * @param {number} endAt
 * @returns {string}
 */
export function promoLastDay(endAt) {
    const d = new Date(endAt - 1);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * そのモデルに今付ける割引の説明。期間外や対象外なら null。
 * @param {string} model
 * @param {number} now
 * @returns {string|null} 例: '12/31 まで半額'
 */
export function promoNote(model, now) {
    const promo = MODEL_PROMOS.find(p => p.models.includes(model));
    if (!promo || now >= promo.endAt) return null;
    return `${promoLastDay(promo.endAt)} まで${promo.note}`;
}

/**
 * モデル一覧の1項目の表示名。期間中の割引があれば括弧で添える。
 * @param {{value: string, label: string}} entry
 * @param {number} now
 * @returns {string}
 */
export function modelDisplayLabel(entry, now) {
    const note = promoNote(entry.value, now);
    return note ? `${entry.label} (${note})` : entry.label;
}
