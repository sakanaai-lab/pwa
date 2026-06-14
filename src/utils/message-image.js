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

function copyComputedStyles(source, target) {
    const computedStyle = window.getComputedStyle(source);
    for (const property of computedStyle) {
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

function loadSvgImage(svgUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('メッセージ画像の生成に失敗しました。'));
        image.src = svgUrl;
    });
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
    const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));

    try {
        const image = await loadSvgImage(svgUrl);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(outputWidth * pixelRatio);
        canvas.height = Math.ceil(outputHeight * pixelRatio);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('画像生成用Canvasを初期化できませんでした。');
        context.scale(pixelRatio, pixelRatio);
        context.drawImage(image, 0, 0, outputWidth, outputHeight);

        return await new Promise((resolve, reject) => {
            canvas.toBlob(
                (blob) => (blob ? resolve(blob) : reject(new Error('PNGへの変換に失敗しました。'))),
                'image/png'
            );
        });
    } finally {
        URL.revokeObjectURL(svgUrl);
    }
}
