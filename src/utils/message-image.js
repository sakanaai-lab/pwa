// メッセージ要素を PNG 画像化するユーティリティ。
//
// 以前は「DOM → SVG <foreignObject> → <img> → canvas」方式だったが、WebKit（iOS の
// 全ブラウザ）では foreignObject を描いた canvas が汚染され、toBlob() が
// "The operation is insecure" (SecurityError) で失敗する。これを回避するため、
// foreignObject を使わず DOM を直接描画する html2canvas を使用する。
// html2canvas は index.html で読み込むグローバル（vendored: html2canvas.min.js）。

const CAPTURE_EXCLUDED_CLASSES = new Set([
    'message-actions',
    'message-cascade-controls',
    'message-edit-area',
]);

function shouldExcludeFromCapture(element) {
    return [...CAPTURE_EXCLUDED_CLASSES].some((className) =>
        element.classList?.contains(className)
    );
}

function addMessageLabel(messageElement, clone) {
    const turn = messageElement.dataset.turn;
    if (!turn) return;

    const label = clone.ownerDocument.createElement('div');
    label.textContent = `#${turn}${messageElement.dataset.model ? `  ${messageElement.dataset.model}` : ''}`;
    label.style.cssText = [
        'display:block',
        'font-size:10px',
        'line-height:1',
        'opacity:0.7',
        'margin-bottom:2px',
        `text-align:${messageElement.classList.contains('user') ? 'right' : 'left'}`,
    ].join(';');
    clone.prepend(label);
}

export function createMessageImageFilename(messageElement, date = new Date()) {
    const role = messageElement.classList.contains('user') ? 'user' : 'assistant';
    const turn = messageElement.dataset.turn || 'message';
    const timestamp = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
        '-',
        String(date.getHours()).padStart(2, '0'),
        String(date.getMinutes()).padStart(2, '0'),
        String(date.getSeconds()).padStart(2, '0'),
    ].join('');
    return `Aquarium_Chat_${turn}_${role}_${timestamp}.png`;
}

export async function messageElementToPngBlob(messageElement) {
    if (!(messageElement instanceof HTMLElement)) {
        throw new TypeError('保存対象のメッセージが見つかりません。');
    }
    if (typeof html2canvas === 'undefined') {
        throw new Error('画像生成ライブラリ（html2canvas）が読み込まれていません。ページを再読み込みしてください。');
    }

    const rect = messageElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        throw new Error('表示されていないメッセージは画像にできません。');
    }

    const backgroundColor =
        window.getComputedStyle(document.body).backgroundColor || '#ffffff';
    // iOS の高解像度でも巨大になりすぎないよう 2x までに制限。
    const scale = Math.min(window.devicePixelRatio || 1, 2);

    const canvas = await html2canvas(messageElement, {
        backgroundColor,
        scale,
        useCORS: true,
        // 操作ボタン等は画像に含めない
        ignoreElements: (element) => shouldExcludeFromCapture(element),
        // クローン側にターン番号ラベルを付与（元のDOMは変更しない）
        onclone: (clonedDocument) => {
            const index = messageElement.dataset.index;
            const clonedElement =
                index != null
                    ? clonedDocument.querySelector(`.message[data-index="${index}"]`)
                    : null;
            if (clonedElement) addMessageLabel(messageElement, clonedElement);
        },
    });

    return await new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('PNGへの変換に失敗しました。'))),
            'image/png'
        );
    });
}
