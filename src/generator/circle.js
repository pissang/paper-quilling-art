export function generateCircle(center, innerRadius, outerRadius, gap) {
    let polylines = [];
    let cx = center[0];
    let cy = center[1];
    for (let r = innerRadius; r <= outerRadius; r += gap) {
        let polyline = [];
        for (let a = 0; a <= 360; a += 1) {
            let x = cx + Math.cos(a / 180 * Math.PI) * r;
            let y = cy + Math.sin(a / 180 * Math.PI) * r;
            polyline.push([x, y]);
        }

        polylines.push(polyline);
    }
    return polylines;
};