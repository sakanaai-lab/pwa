// メッセージ要素を PNG 画像化するユーティリティ。
//
// 以前は「DOM → SVG <foreignObject> → <img> → canvas」方式だったが、WebKit（iOS の
// 全ブラウザ）では foreignObject を描いた canvas が汚染され、toBlob() が
// "The operation is insecure" (SecurityError) で失敗する。これを回避するため、
// foreignObject を使わず DOM を直接描画する html2canvas を使用する。
// さらに iOS の計算済みスタイルは color(srgb …)/color-mix を含むため、それらに対応した
// html2canvas-pro を採用（グローバル名は html2canvas のまま。vendored: html2canvas-pro.min.js）。
//
// 範囲保存は「各メッセージを個別に html2canvas で撮影 → 縦に連結」する方式。
// 親要素依存の CSS 崩れを避けられ、iOS の canvas サイズ上限を超える場合は
// 複数枚へ自動分割できる。

const CAPTURE_EXCLUDED_CLASSES = new Set([
    'message-actions',
    'message-cascade-controls',
    'message-edit-area',
]);

// iOS Safari でも安全な canvas の上限（1辺・総面積）。超える場合は分割する。
const MAX_CANVAS_SIDE = 4096;
const MAX_CANVAS_AREA = 16777216; // 4096 * 4096

function shouldExcludeFromCapture(element) {
    return [...CAPTURE_EXCLUDED_CLASSES].some((className) =>
        element.classList?.contains(className)
    );
}

// 撮影時のみクローン側へ適用する固定配色（白背景＋黒文字）。
// テーマの color-mix() / CSS変数依存だと html2canvas 上で文字色が極端に薄くなり
// 読めない画像になるため、確実に読める高コントラストへ上書きする。実画面には影響しない。
// ターン番号ラベルは .message::before（content: "#" attr(data-turn) ...）が描画するので
// 別途付与はしない。
const CAPTURE_OVERRIDE_CSS = `
    .message, .message * { color: #1a1a1a !important; }
    .message { background: #ffffff !important; box-shadow: none !important; border: 1px solid #e0e0e0 !important; }
    .message.user { background: #eaf2f5 !important; }
    .message-content pre, .message-content code { background: #f3f3f3 !important; color: #1a1a1a !important; border-color: #dddddd !important; }
    .message-content a { color: #1565c0 !important; }
    .message-content blockquote { color: #555555 !important; border-left-color: #cccccc !important; }
    .message::before, .message *::before { color: #888888 !important; opacity: 1 !important; }
`;

function captureParams() {
    // 撮影は固定の白背景にする（テーマ依存の薄文字問題を避けるため）。
    const backgroundColor = '#ffffff';
    // 高解像度でも巨大になりすぎないよう 2x までに制限。
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    return { backgroundColor, scale };
}

// 1つのメッセージ要素を html2canvas で canvas 化する。
// 操作ボタンは除外し、クローン側に高コントラストの撮影用配色を適用する。
async function captureElementToCanvas(messageElement, { backgroundColor, scale }) {
    return await html2canvas(messageElement, {
        backgroundColor,
        scale,
        useCORS: true,
        ignoreElements: (element) => shouldExcludeFromCapture(element),
        onclone: (clonedDocument) => {
            const style = clonedDocument.createElement('style');
            style.textContent = CAPTURE_OVERRIDE_CSS;
            clonedDocument.head.appendChild(style);
        },
    });
}

function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('PNGへの変換に失敗しました。'))),
            'image/png'
        );
    });
}

export function createMessageImageFilename(messageElement, date = new Date()) {
    const role = messageElement.classList.contains('user') ? 'user' : 'assistant';
    const turn = messageElement.dataset.turn || 'message';
    return `Aquarium_Chat_${turn}_${role}_${formatTimestamp(date)}.png`;
}

export function createRangeImageFilename(date = new Date(), part = 0, total = 1) {
    const suffix = total > 1 ? `_${part}of${total}` : '';
    return `Aquarium_Chat_range_${formatTimestamp(date)}${suffix}.png`;
}

function formatTimestamp(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
        '-',
        String(date.getHours()).padStart(2, '0'),
        String(date.getMinutes()).padStart(2, '0'),
        String(date.getSeconds()).padStart(2, '0'),
    ].join('');
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
    const canvas = await captureElementToCanvas(messageElement, captureParams());
    return canvasToPngBlob(canvas);
}

// 複数メッセージを縦に連結し、上限を超える場合は複数 PNG に分割して返す。
// 戻り値: Blob[]（通常1枚、長い範囲では複数枚）。
export async function messagesRangeToPngBlobs(messageElements) {
    if (typeof html2canvas === 'undefined') {
        throw new Error('画像生成ライブラリ（html2canvas）が読み込まれていません。ページを再読み込みしてください。');
    }
    const { backgroundColor, scale } = captureParams();

    const captures = [];
    for (const element of messageElements) {
        if (!(element instanceof HTMLElement)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const canvas = await captureElementToCanvas(element, { backgroundColor, scale });
        captures.push({ canvas, isUser: element.classList.contains('user') });
    }
    if (captures.length === 0) {
        throw new Error('表示されているメッセージがありません。');
    }

    const gap = Math.round(12 * scale);

    // 連結後の高さが上限を超えないように分割（1メッセージが上限超なら単独で1枚）。
    const chunks = [];
    let current = [];
    let currentHeight = 0;
    for (const item of captures) {
        const add = item.canvas.height + (current.length ? gap : 0);
        if (current.length && currentHeight + add > MAX_CANVAS_SIDE) {
            chunks.push(current);
            current = [];
            currentHeight = 0;
        }
        current.push(item);
        currentHeight += item.canvas.height + (current.length > 1 ? gap : 0);
    }
    if (current.length) chunks.push(current);

    const blobs = [];
    for (const chunk of chunks) {
        blobs.push(await canvasToPngBlob(combineCanvases(chunk, backgroundColor, gap)));
    }
    return blobs;
}

function combineCanvases(items, backgroundColor, gap) {
    let width = Math.max(...items.map((i) => i.canvas.width));
    let height = items.reduce((sum, i) => sum + i.canvas.height, 0) + gap * (items.length - 1);

    // 念のため上限でクランプ（通常は分割済みで超えない）。
    width = Math.min(width, MAX_CANVAS_SIDE);
    height = Math.min(height, MAX_CANVAS_SIDE);
    if (width * height > MAX_CANVAS_AREA) {
        const ratio = Math.sqrt(MAX_CANVAS_AREA / (width * height));
        width = Math.floor(width * ratio);
        height = Math.floor(height * ratio);
    }

    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    let y = 0;
    for (const item of items) {
        // user は右寄せ・それ以外は左寄せで連結（チャットの見た目に合わせる）。
        const x = item.isUser ? Math.max(0, width - item.canvas.width) : 0;
        ctx.drawImage(item.canvas, x, y);
        y += item.canvas.height + gap;
    }
    return out;
}
