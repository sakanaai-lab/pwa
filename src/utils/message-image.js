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

// canvas の上限。iOS では「総面積」が実質的な制約（約 4096^2）。幅は狭いので
// 主に縦長の安全弁として 1 辺上限も持つ。範囲保存はまず1枚に収め、超える場合は
// 縮小、それでも極端に長い場合のみ複数枚へ分割する。
const MAX_CANVAS_AREA = 16777216; // iOS 安全圏（4096^2）
const MAX_CANVAS_SIDE = 16384;
const MIN_FIT_SCALE = 0.3; // これ未満まで縮小が必要なほど長い場合のみ分割

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
    /* html2canvas が line-height を取りこぼして行が重なるのを防ぐため、明示的に行高を指定 */
    .message, .message-content, .message-content p, .message-content li,
    .message-content div, .message-content span, .message-content td, .message-content th {
        line-height: 1.6 !important;
    }
`;

// フォント未ロード状態で撮影すると文字メトリクスがずれて行が重なることがあるため、
// 読み込み完了を待つ。
async function ensureFontsReady() {
    try {
        if (document.fonts?.ready) await document.fonts.ready;
    } catch {
        /* フォントAPI非対応時は無視 */
    }
}

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
            // スタイルシートの !important だけでは html2canvas 上で文字色を
            // 上書きしきれない（テーマの color()/color-mix が残る）ことがあるため、
            // 各要素へインライン !important で黒文字を直接強制する（最優先で確実）。
            clonedDocument.querySelectorAll('.message, .message *').forEach((el) => {
                if (el.style) el.style.setProperty('color', '#1a1a1a', 'important');
            });
            // 閉じている details（思考プロセス等）の中身だけをプログラムで非表示にする。
            // CSS の details:not([open]) を html2canvas が誤解釈して本文まで消すことが
            // あるため、確実に「閉じた details の子要素のみ」を対象にする。
            clonedDocument.querySelectorAll('details:not([open])').forEach((details) => {
                details.querySelectorAll(':scope > *').forEach((child) => {
                    if (child.tagName !== 'SUMMARY' && child.style) {
                        child.style.setProperty('display', 'none', 'important');
                    }
                });
            });
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
    await ensureFontsReady();
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
    await ensureFontsReady();

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

    // まず「1枚」に収めることを優先。上限を超える場合は縮小して1枚に収める。
    const totalWidth = Math.max(...captures.map((i) => i.canvas.width));
    const totalHeight =
        captures.reduce((sum, i) => sum + i.canvas.height, 0) + gap * (captures.length - 1);
    const fit = Math.min(
        1,
        MAX_CANVAS_SIDE / totalWidth,
        MAX_CANVAS_SIDE / totalHeight,
        Math.sqrt(MAX_CANVAS_AREA / (totalWidth * totalHeight))
    );

    if (fit >= MIN_FIT_SCALE) {
        // 1枚にまとめる（必要なら縮小）。user/assistant が分断されない。
        return [await canvasToPngBlob(combineCanvases(captures, backgroundColor, gap, fit))];
    }

    // 縮小しても読めないほど極端に長い場合のみ、等倍で上限に収まるよう複数枚へ分割。
    const maxChunkHeight = Math.min(MAX_CANVAS_SIDE, Math.floor(MAX_CANVAS_AREA / totalWidth));
    const chunks = [];
    let current = [];
    let currentHeight = 0;
    for (const item of captures) {
        const add = item.canvas.height + (current.length ? gap : 0);
        if (current.length && currentHeight + add > maxChunkHeight) {
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
        blobs.push(await canvasToPngBlob(combineCanvases(chunk, backgroundColor, gap, 1)));
    }
    return blobs;
}

function combineCanvases(items, backgroundColor, gap, fit = 1) {
    const logicalWidth = Math.max(...items.map((i) => i.canvas.width));
    const logicalHeight =
        items.reduce((sum, i) => sum + i.canvas.height, 0) + gap * (items.length - 1);

    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.floor(logicalWidth * fit));
    out.height = Math.max(1, Math.floor(logicalHeight * fit));
    const ctx = out.getContext('2d');
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, out.width, out.height);

    let y = 0;
    for (const item of items) {
        const cw = item.canvas.width;
        const ch = item.canvas.height;
        // user は右寄せ・それ以外は左寄せで連結（チャットの見た目に合わせる）。
        const x = item.isUser ? Math.max(0, logicalWidth - cw) : 0;
        ctx.drawImage(
            item.canvas,
            0, 0, cw, ch,
            Math.round(x * fit), Math.round(y * fit), Math.round(cw * fit), Math.round(ch * fit)
        );
        y += ch + gap;
    }
    return out;
}
