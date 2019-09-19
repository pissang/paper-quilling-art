const MASK_SIZE = 256;

function createCtx() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.height = MASK_SIZE;
    return ctx;
}
export function createTextMaskImage(text) {
    const ctx = createCtx();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = 'bold 150px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(text, MASK_SIZE / 2, MASK_SIZE / 2);

    return ctx.getImageData(0, 0, MASK_SIZE, MASK_SIZE);
};

export function createMaskImage(image, cutoff, inverse) {
    const ctx = createCtx();
    let originWidth = image.width;
    let originHeight = image.height;

    let aspect = originWidth / originHeight;
    let width;
    let height;
    let x = 0;
    let y = 0;
    if (aspect > 1) {
        width = MASK_SIZE;
        height = MASK_SIZE / aspect;
        y = (MASK_SIZE - height) / 2;
    }
    else {
        height = MASK_SIZE;
        width = MASK_SIZE * aspect;
        x = (MASK_SIZE - width) / 2;
    }

    ctx.drawImage(image, x, y, width, height);
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
}