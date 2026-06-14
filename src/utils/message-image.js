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

function isWebKitBrowser() {
    const userAgent = navigator.userAgent || '';
    return /AppleWebKit/i.test(userAgent) && !/Edg|OPR/i.test(userAgent);
}

function createCaptureCanvas(width, height) {
    const requestedPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const maxCanvasSide = 4096;
    const pixelRatio = Math.min(requestedPixelRatio, maxCanvasSide / width, maxCanvasSide / height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width * pixelRatio));
    canvas.height = Math.max(1, Math.ceil(height * pixelRatio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('画像生成用Canvasを初期化できませんでした。');
    context.scale(pixelRatio, pixelRatio);
    return { canvas, context };
}

function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('PNGへの変換に失敗しました。'))),
            'image/png'
        );
    });
}

function drawRoundedRect(context, x, y, width, height, radius) {
    const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.lineTo(x + width - safeRadius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    context.lineTo(x + width, y + height - safeRadius);
    context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    context.lineTo(x + safeRadius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    context.lineTo(x, y + safeRadius);
    context.quadraticCurveTo(x, y, x + safeRadius, y);
    context.closePath();
}

function drawElementBox(context, element, captureRect, padding) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)
        return;

    const x = rect.left - captureRect.left + padding;
    const y = rect.top - captureRect.top + padding;
    const radius = parseFloat(style.borderTopLeftRadius) || 0;
    if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        drawRoundedRect(context, x, y, rect.width, rect.height, radius);
        context.fillStyle = style.backgroundColor;
        context.fill();
    }

    const borderWidth = parseFloat(style.borderTopWidth) || 0;
    if (borderWidth > 0 && style.borderTopStyle !== 'none') {
        drawRoundedRect(context, x, y, rect.width, rect.height, radius);
        context.lineWidth = borderWidth;
        context.strokeStyle = style.borderTopColor;
        context.stroke();
    }
}

function drawTextNode(context, textNode, captureRect, padding) {
    const text = textNode.nodeValue || '';
    if (!text) return;

    const parent = textNode.parentElement;
    if (!parent) return;
    const style = window.getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') return;

    context.fillStyle = style.color;
    context.font = [
        style.fontStyle,
        style.fontVariant,
        style.fontWeight,
        style.fontSize,
        style.fontFamily,
    ].join(' ');
    context.textBaseline = 'alphabetic';

    const range = document.createRange();
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (character === '\n' || character === '\r') continue;
        range.setStart(textNode, index);
        range.setEnd(textNode, index + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        context.fillText(
            character,
            rect.left - captureRect.left + padding,
            rect.bottom - captureRect.top + padding - Math.max(1, parseFloat(style.fontSize) * 0.15)
        );
    }
    range.detach();
}

function canDrawImageWithoutTaint(image) {
    if (!image.currentSrc && !image.src) return false;
    const source = image.currentSrc || image.src;
    if (source.startsWith('data:') || source.startsWith('blob:')) return true;
    try {
        return new URL(source, location.href).origin === location.origin;
    } catch {
        return false;
    }
}

async function drawDomNode(context, node, captureRect, padding) {
    if (node.nodeType === Node.TEXT_NODE) {
        drawTextNode(context, node, captureRect, padding);
        return;
    }
    if (!(node instanceof HTMLElement) || shouldExcludeFromCapture(node)) return;

    drawElementBox(context, node, captureRect, padding);
    if (node instanceof HTMLImageElement) {
        const rect = node.getBoundingClientRect();
        if (node.complete && node.naturalWidth > 0 && canDrawImageWithoutTaint(node)) {
            context.drawImage(
                node,
                rect.left - captureRect.left + padding,
                rect.top - captureRect.top + padding,
                rect.width,
                rect.height
            );
        }
        return;
    }

    for (const child of node.childNodes) {
        await drawDomNode(context, child, captureRect, padding);
    }
}

async function messageElementToCanvasBlob(messageElement) {
    const rect = messageElement.getBoundingClientRect();
    const padding = 16;
    const outputWidth = Math.ceil(rect.width) + padding * 2;
    const outputHeight = Math.ceil(rect.height) + padding * 2;
    const { canvas, context } = createCaptureCanvas(outputWidth, outputHeight);
    context.fillStyle = window.getComputedStyle(document.body).backgroundColor || '#ffffff';
    context.fillRect(0, 0, outputWidth, outputHeight);
    await drawDomNode(context, messageElement, rect, padding);
    return canvasToPngBlob(canvas);
}

function copyComputedStyles(source, target) {
    const computedStyle = window.getComputedStyle(source);
    // CSSStyleDeclaration is not iterable on some iOS/Safari versions.
    for (let index = 0; index < computedStyle.length; index++) {
        const property = computedStyle[index];
        target.style.setProperty(
            property,
            computedStyle.getPropertyValue(property),
            computedStyle.getPropertyPriority(property)
        );
    }
}

function inlineElementStyles(source, target) {
    if (shouldExcludeFromCapture(source)) {
        target.remove();
        return;
    }

    copyComputedStyles(source, target);
    const sourceChildren = [...source.children];
    const targetChildren = [...target.children];
    sourceChildren.forEach((sourceChild, index) => {
        const targetChild = targetChildren[index];
        if (targetChild) inlineElementStyles(sourceChild, targetChild);
    });
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('画像の読み込みに失敗しました。'));
        reader.readAsDataURL(blob);
    });
}

async function inlineImages(element) {
    const images = [...element.querySelectorAll('img')];
    await Promise.all(
        images.map(async (image) => {
            if (!image.src || image.src.startsWith('data:')) return;
            const response = await fetch(image.src);
            if (!response.ok) throw new Error(`画像を取得できませんでした (${response.status})`);
            image.src = await blobToDataUrl(await response.blob());
        })
    );
}

function addMessageLabel(messageElement, clone) {
    const turn = messageElement.dataset.turn;
    if (!turn) return;

    const label = document.createElement('div');
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

function loadSvgImage(svgDataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('メッセージ画像の生成に失敗しました。'));
        image.src = svgDataUrl;
    });
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareOrDownloadImage(blob, filename) {
    const file =
        typeof File === 'function' ? new File([blob], filename, { type: 'image/png' }) : null;
    const shareData = file ? { files: [file], title: filename } : null;
    let canShareFile = false;

    if (
        shareData &&
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function'
    ) {
        try {
            canShareFile = navigator.canShare(shareData);
        } catch (error) {
            console.warn('このブラウザでは画像ファイル共有を利用できません。', error);
        }
    }

    if (canShareFile) {
        try {
            await navigator.share(shareData);
            return 'shared';
        } catch (error) {
            if (error?.name === 'AbortError') return 'cancelled';
            console.warn('画像の共有に失敗したため、ダウンロードに切り替えます。', error);
        }
    }

    downloadBlob(blob, filename);
    return 'downloaded';
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

    const rect = messageElement.getBoundingClientRect();
    const width = Math.ceil(Math.max(rect.width, messageElement.scrollWidth));
    const height = Math.ceil(Math.max(rect.height, messageElement.scrollHeight));
    if (width <= 0 || height <= 0) {
        throw new Error('表示されていないメッセージは画像にできません。');
    }

    // Safari/WebKitはforeignObjectを含むSVGをCanvasへ描画するとSecurityErrorになる。
    if (isWebKitBrowser()) {
        return messageElementToCanvasBlob(messageElement);
    }

    const clone = messageElement.cloneNode(true);
    inlineElementStyles(messageElement, clone);
    clone.style.margin = '0';
    clone.style.maxWidth = 'none';
    clone.style.width = `${width}px`;
    clone.style.height = 'auto';
    clone.style.boxSizing = 'border-box';
    addMessageLabel(messageElement, clone);
    await inlineImages(clone);

    const wrapper = document.createElement('div');
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    wrapper.style.cssText = `display:inline-block;padding:16px;background:${window.getComputedStyle(document.body).backgroundColor || '#ffffff'};`;
    wrapper.appendChild(clone);

    const outputWidth = width + 32;
    const outputHeight = Math.ceil(height + 32);
    const serialized = new XMLSerializer().serializeToString(wrapper);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${outputWidth} ${outputHeight}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
    // Blob URLでSVGを読み込むとiOS/SafariでforeignObjectの描画に失敗するためData URLを使う。
    const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const image = await loadSvgImage(svgDataUrl);
    const { canvas, context } = createCaptureCanvas(outputWidth, outputHeight);
    context.drawImage(image, 0, 0, outputWidth, outputHeight);
    return canvasToPngBlob(canvas);
}
