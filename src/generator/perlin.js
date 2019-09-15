// import {noise, noiseSeed} from '../dep/noise';
import {perlin2, seed} from '../dep/noise2';

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


function lineGenerator(x, y, min, max, trail, noiseScale) {
    // let points = new Float32Array(20000);
    // let off = 0;
    // points[off++] = x;
    // points[off++] = y;
    let points = [[x, y]];
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

        points.push([x, y]);
        // points[off++] = x;
        // points[off++] = y;
    }
    return points;
    // return points.subarray(0, off);
}
export function generatePerlin(min, max, number, trail, noiseScale) {
    let polylines = [];
    let width = max[0] - min[0];
    let height = max[1] - min[1];
    for (let i = 0; i < number; i++) {
        let x = halton(i, 2) * width + min[0];
        let y = halton(i, 3) * height + min[1];
        // let x = Math.random() * width + min[0];
        // let y = Math.random() * height + min[1];

        let polyline = lineGenerator(x, y, min, max, trail, noiseScale);
        if (polyline.length >= 10) {
            polylines.push(polyline);
        }
    }

    return polylines;
}
export function perlinSeed(value) {
    seed(value);
}