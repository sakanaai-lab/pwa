// HTML/CSS エスケープ用ユーティリティ。app.js から抽出（Phase 1）。挙動は変更していない。

export const htmlUtils = {
    // HTML要素内のテキストコンテンツ用エスケープ
    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    },

    // HTML属性値用エスケープ（より厳格）
    escapeAttr(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    },

    // CSSセレクタ用の安全な文字列を生成
    escapeSelector(text) {
        if (text === null || text === undefined) return '';
        // CSS.escapeを使用（全ブラウザでサポート済み）
        return CSS.escape(String(text));
    },
};
