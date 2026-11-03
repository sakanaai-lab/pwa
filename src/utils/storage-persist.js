// チャットなどの保存データ（IndexedDB）を、ブラウザに「消さないで」と頼む。
//
// 頼まないと、ブラウザはこのサイトのデータを「お試し扱い（best-effort）」にしておき、
// 端末の空き容量が足りなくなったときにサイトごと丸ごと消してよいことになっている。
// Android で「チャット履歴がある日まとめて消える」という報告の、一番ありそうな原因。
//
// - Chrome は確認を出さない。ホーム画面に追加している・よく使っているなどのサイトなら黙って認める
// - Firefox は「データの保存を許可しますか？」と1回聞くことがある
// - 断られても今までと同じ扱いのままで、悪くなることはない
// - 使う人が自分でサイトのデータを消したときは、頼んでいても消える
//
// https://developer.mozilla.org/docs/Web/API/StorageManager/persist

/**
 * 保存データの保護を頼み、結果を返す。
 * @param {StorageManager|undefined} storage 普段は navigator.storage（テストでは差し替える）
 * @returns {Promise<'unsupported'|'already'|'granted'|'denied'|'error'>}
 */
export async function requestPersistentStorage(storage = globalThis.navigator?.storage) {
    if (!storage || typeof storage.persist !== 'function') return 'unsupported';
    try {
        // 既に保護されているなら頼み直さない（Firefox で毎回聞かれないように）
        if (typeof storage.persisted === 'function' && await storage.persisted()) return 'already';
        return (await storage.persist()) ? 'granted' : 'denied';
    } catch {
        return 'error';
    }
}
