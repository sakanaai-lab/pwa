// 提供終了したモデル・終了日が決まっているモデルの判定。DOMにもDBにも触らない純粋関数だけを置く。
//
// - RETIRED_MODEL_MAP: すでに終了したモデル → 後継
// - SCHEDULED_RETIREMENTS: 終了日が告知されていて、まだ使えるモデル。終了日を過ぎたら
//   RETIRED_MODEL_MAP と同じ扱いにする
//
// 終了日の前に後継へ移してしまうと、まだ使えるモデルを勝手に変えることになる。
// 終了日の後まで一覧に残すと、選んで送って初めてエラーになる。
// どちらも避けるため、日時で切り替える。

import { RETIRED_MODEL_MAP, SCHEDULED_RETIREMENTS } from '../constants.js';

/**
 * そのモデルが now の時点で終了していれば後継を返す。終了していなければ null。
 * @param {string} model
 * @param {number} now epoch ms
 * @param {object} [tables] テスト用に差し替えられるようにしてある
 * @returns {string|null}
 */
export function getRetirementSuccessor(model, now, {
    retiredMap = RETIRED_MODEL_MAP,
    scheduled = SCHEDULED_RETIREMENTS,
} = {}) {
    if (!model) return null;
    if (retiredMap[model]) return retiredMap[model];
    for (const { at, models } of scheduled) {
        if (now >= at && models[model]) return models[model];
    }
    return null;
}

/**
 * 終了日が決まっているモデルなら、その終了日（epoch ms）を返す。無ければ null。
 * @param {string} model
 * @param {object[]} [scheduled]
 * @returns {number|null}
 */
export function getScheduledRetirementAt(model, scheduled = SCHEDULED_RETIREMENTS) {
    for (const { at, models } of scheduled) {
        if (models[model]) return at;
    }
    return null;
}

/**
 * モデル一覧から、now の時点で終了しているモデルを取り除く。
 * @param {{value: string}[]} list
 * @param {number} now
 * @param {object} [tables]
 * @returns {{value: string}[]}
 */
export function filterLiveModels(list, now, tables) {
    return list.filter((m) => getRetirementSuccessor(m.value, now, tables) === null);
}
