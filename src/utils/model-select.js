// モデル選択の決定ロジック。DOM・DBには触らない純粋関数だけを置く。

/**
 * ドロップダウンを作り直したあとに選ぶべきモデルを決める。
 *
 * 保存済みのモデル（settings.modelName）を最優先する。
 * DOMの現在値を優先すると、ページ再読み込み直後は index.html の静的な既定値
 * （gemini-2.0-flash）が入っているため「このプロバイダーには無い」と誤判定され、
 * 保存済みのモデルが既定値で上書きされてしまう。
 *
 * @param {object} params
 * @param {string} [params.savedModel] 保存済みのモデル（settings.modelName）
 * @param {string[]} [params.availableValues] このプロバイダーで選べるモデルID
 * @param {string} [params.lastUsed] このプロバイダーで最後に選んだモデル
 * @param {string} [params.defaultModel] どれも使えないときの既定値
 * @returns {{model: string, isFallback: boolean}}
 *   isFallback が true のときだけ、保存済みの設定を書き換えてよい
 */
/**
 * 「追加モデル」グループを選択肢の末尾へ移動する。
 *
 * index.html では #user-defined-models-group が静的に置かれているため、
 * 何もしないと標準モデルより前（＝一覧の途中）に表示されてしまう。
 * 既に select の子であっても appendChild で付け直して末尾へ送る。
 * 呼び出し側はこの直後に「API取得モデル」グループを追加するので、
 * 最終的な並びは 標準モデル → 追加モデル → API取得モデル になる。
 *
 * @param {Element} modelSelect モデル選択の select 要素
 * @param {Element} [userDefinedGroup] 追加モデルの optgroup（無ければ何もしない）
 */
export function moveUserDefinedGroupToEnd(modelSelect, userDefinedGroup) {
    if (!modelSelect || !userDefinedGroup) return;
    modelSelect.appendChild(userDefinedGroup);
}

export function resolveSelectedModel({ savedModel, availableValues, lastUsed, defaultModel } = {}) {
    const values = Array.isArray(availableValues) ? availableValues : [];
    if (savedModel && values.includes(savedModel)) {
        return { model: savedModel, isFallback: false };
    }
    // プロバイダーを切り替えた直後など、保存済みモデルが使えない場合だけ落とす
    if (lastUsed && values.includes(lastUsed)) {
        return { model: lastUsed, isFallback: true };
    }
    return { model: defaultModel, isFallback: true };
}
