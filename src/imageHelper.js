const MASK_SIZE = 256;

function createCtx(width, height) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;
    return ctx;
}
export function createTextMaskImage(text, font) {
    const ctx = createCtx(MASK_SIZE, MASK_SIZE);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.translate(MASK_SIZE / 2, MASK_SIZE / 2);
    var scale = 2 / text.length;
    ctx.scale(scale, scale);
    ctx.font = `bold 140px ${font}`;
    ctx.fillStyle = '#000';
    ctx.fillText(text, 0, 0);

    return ctx.canvas;
};

export function resizeImage(image, targetWidth, targetHeight) {
    const ctx = createCtx(targetWidth, targetHeight);
    let originWidth = image.width;
    let originHeight = image.height;

    let aspect = originWidth / originHeight;
    let width;
    let height;
    let x = 0;
    let y = 0;
    if (aspect > targetWidth / targetHeight) {
        width = targetWidth;
        height = targetHeight / aspect;
        y = (targetHeight - height) / 2;
    }
    else {
        height = targetHeight;
        width = targetWidth * aspect;
        x = (targetWidth - width) / 2;
    }
    ctx.drawImage(image, x, y, width, height);
    return ctx.canvas;
}

export function createMaskImageData(image, cutoff, inverse) {
    const canvas = resizeImage(image, MASK_SIZE, MASK_SIZE);
    const ctx = canvas.getContext('2d');

    let data = ctx.getImageData(0, 0, MASK_SIZE, MASK_SIZE);

    let pixels = data.data;
    for (let i = 0; i < pixels.length; i+= 4) {
        var r = pixels[i];
        var g = pixels[i + 1];
        var b = pixels[i + 2];
        let lum = 0.2125 * r + 0.7154 * g + 0.0721 * b;
        if ((!inverse && lum <= cutoff) || (inverse && lum > cutoff)) {
            pixels[i + 3] = 0;
        }
    }

    return data;
};

export function extractOutline() {

}