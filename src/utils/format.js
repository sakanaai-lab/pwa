// 汎用ユーティリティ関数（純粋・副作用なし）。
// app.js から抽出（Phase 1）。挙動は変更していない。

/** 指定ミリ秒待機する */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 名前マスキング用の置換リストを解析する。
 * 1行に1組、「本名,別名」の形式（区切りは , 、 → -> => のいずれか）。
 * 本名が空の行は無視。別名は空でもよい（＝その名前を削除）。
 * 長い本名から先に置換されるよう降順ソートして返す（部分一致の崩れ防止）。
 * @param {string} text - 設定テキストエリアの内容
 * @returns {Array<{from: string, to: string}>}
 */
export function parseNameMaskRules(text) {
    if (!text || typeof text !== 'string') return [];
    const rules = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const m = trimmed.match(/^(.*?)\s*(?:,|、|→|->|=>)\s*(.*)$/);
        if (!m) continue;
        const from = m[1].trim();
        const to = m[2].trim();
        if (!from) continue;
        rules.push({ from, to });
    }
    rules.sort((a, b) => b.from.length - a.from.length);
    return rules;
}

/**
 * テキストに名前マスキングの置換を適用する。
 * 正規表現の特殊文字問題を避けるため split/join による単純置換を使う。
 * @param {string} text - 対象テキスト
 * @param {Array<{from: string, to: string}>} rules - parseNameMaskRules の結果
 * @returns {string} 置換後のテキスト
 */
export function applyNameMask(text, rules) {
    if (!text || !Array.isArray(rules) || rules.length === 0) return text;
    let result = text;
    for (const { from, to } of rules) {
        if (!from) continue;
        result = result.split(from).join(to);
    }
    return result;
}

/**
 * 中断可能なsleep関数
 * @param {number} ms - 待機する時間 (ミリ秒)
 * @param {AbortSignal} signal - 中断を監視するためのAbortSignal
 * @returns {Promise<void>} 待機が完了するとresolveし、中断されるとrejectするPromise
 */
export function interruptibleSleep(ms, signal) {
    return new Promise((resolve, reject) => {
        // 待機開始前にもし既に中断されていたら、即座にエラーを投げる
        if (signal.aborted) {
            const error = new Error('Sleep aborted');
            error.name = 'AbortError';
            return reject(error);
        }

        let timeoutId;

        // 中断信号を受け取った時の処理
        const onAbort = () => {
            clearTimeout(timeoutId); // タイマーをクリア
            const error = new Error('Sleep aborted');
            error.name = 'AbortError';
            reject(error); // Promiseをエラーで終了させる
        };

        // 指定時間後にPromiseを成功させるタイマーを設定
        timeoutId = setTimeout(() => {
            signal.removeEventListener('abort', onAbort); // 成功したので中断リスナーは不要
            resolve();
        }, ms);

        // 中断イベントを監視開始
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

/** ファイルサイズを読みやすい形式にフォーマット */
export function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/** Base64文字列をBlobオブジェクトに変換 (Promise) */
export function base64ToBlob(base64, mimeType) {
    return fetch(`data:${mimeType};base64,${base64}`).then((res) => res.blob());
}
