import {perlin2, seed} from '../dep/noise2';
import seedrandom from 'seedrandom';

let ALPHA_THRESHOLD = 240;
let random = seedrandom('seedrandom');

function halton(index, base) {

    var result = 0;
    var f = 1 / base;
    var i = index;
    while (i > 0) {
        result = result + f * (i % base);
        i = Math.floor(i / base);
        f = f / base;
    }
    return result;
}

function getIdx(px, py, imageWidth, imageHeight) {
    return Math.round((1 - py) * (imageHeight - 1)) * imageWidth + Math.round(px * (imageWidth - 1));
}

function lineGenerator(x, y, min, max, trail, noiseScale, maskImage) {
    let jitter = Math.random() / 20;
    let points = [[x, y]];
    let pixels = maskImage && maskImage.data;
    let imageWidth = maskImage && maskImage.width;
    let imageHeight = maskImage && maskImage.height;
    let randomInPixels = !!maskImage;
    let width = max[0] - min[0];
    let height = max[1] - min[1];
    // https://github.com/wangyasai/Perlin-Noise/blob/gh-pages/js/sketch.js#L97
    for (let i = 0; i < trail; i++) {
        for (let k = 0; k < 10; k++) {
            let angle = perlin2(x / noiseScale, y / noiseScale) * Math.PI * 2 * 40 * noiseScale;
            let vx = Math.cos(angle) / 200;
            let vy = Math.sin(angle) / 200;
            x += vx;
            y += vy;
        }

        if (x > max[0] || x < min[0] || y > max[1] || y < min[1]) {
            break;
        }

        if (randomInPixels) {
            let px = (x - min[0]) / width;
            let py = (y - min[1]) / height;
            let idx = getIdx(px, py, imageWidth, imageHeight);
            let a = pixels[idx * 4 + 3];
            if (a < ALPHA_THRESHOLD) {
                break;
            }
        }

        points.push([x + jitter, y + jitter]);
    }
    return points;
}

function countAvailablePercent(pixels) {
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        let a = pixels[i + 3];
        if (a > ALPHA_THRESHOLD) {
            count++;
        }
    }
    return count / pixels.length;
}

export function generatePerlin(min, max, number, trail, noiseScale, maskImage, outlinePoints) {
    let polylines = [];
    let width = max[0] - min[0];
    let height = max[1] - min[1];
    let pixels = maskImage && maskImage.data;
    // let percent = maskImage ? countAvailablePercent(maskImage.data) : 1;
    let randomInPixels = !!maskImage;
    let imageWidth = maskImage && maskImage.width;
    let imageHeight = maskImage && maskImage.height;
    let outlinePointsCount = outlinePoints && outlinePoints.length / 2;

    // number *= Math.sqrt(Math.sqrt(percent));   // PENDING

    let count = 0;
    let iter = 0;
    while (count < number
        && iter < 1e6   // Safe protection
    ) {
        iter++;
        let x;
        let y;
        // if (randomInPixels) {
        //     let idx = Math.round(random() * outlinePointsCount - 1);
        //     x = outlinePoints[idx * 2];
        //     y = outlinePoints[idx * 2 + 1];
        // }
        // else {
        //     x = halton(iter, 2) * width + min[0];
        //     y = halton(iter, 3) * height + min[1];
        // }
        let px = halton(iter, 2);
        let py = halton(iter, 3);
        let idx = getIdx(px, py, imageWidth, imageHeight);
        if (randomInPixels) {
            let a = pixels[idx * 4 + 3];
            if (a < ALPHA_THRESHOLD) {
                continue;
            }
        }
        x = px * width + min[0];
        y = py * height + min[1];

        let polyline = lineGenerator(x, y, min, max, trail, noiseScale, maskImage);
        if (polyline.length < 10) {
            continue;
        }
        polylines.push(polyline);

        count++;
    }


    if (randomInPixels) {
        count = iter = 0;
        // Add more points
        while (count < number / 5
            && iter < 1e6   // Safe protection
        ) {
            iter++;
            let idx = Math.round(random() * outlinePointsCount - 1);
            let x = outlinePoints[idx * 2];
            let y = outlinePoints[idx * 2 + 1];

            let polyline = lineGenerator(x, y, min, max, trail, noiseScale, maskImage);
            if (polyline.length < 10) {
                continue;
            }
            polylines.push(polyline);

            count++;
        }

    }

    return polylines;
}

export function perlinSeed(value) {
    random = seedrandom(value.toString());
    seed(value);
}