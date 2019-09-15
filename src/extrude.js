export function extrude(points, height) {
    let vertexCount = points.length / 2;
    let position = new Float32Array(vertexCount * 6);
    let indices = new (vertexCount > 65536 ? Uint32Array : Uint16Array)((vertexCount - 1) * 6);
    let normal = new Float32Array(vertexCount * 6);

    let prevX = 0;
    let prevY = 0;
    let nx;
    let ny;
    let off = 0;
    for(let i = 0; i < vertexCount; i++) {
        let i2 = i * 2;
        let i6 = i * 6;
        let x = points[i2];
        let y = points[i2 + 1];

        // Position
        position[i6] = x;
        position[i6 + 1] = y;
        position[i6 + 2] = 0;
        position[i6 + 3] = x;
        position[i6 + 4] = y;
        position[i6 + 5] = height;

        // Normal
        if (i === vertexCount - 1) {
            let dx = x - prevX;
            let dy = y - prevY;
            nx = -dy;
            ny = dx;
        }
        else {
            let nextX = points[(i + 1) * 2];
            let nextY = points[(i + 1) * 2 + 1];
            let dx2 = nextX - x;
            let dy2 = nextY - y;
            if (i === 0) {
                nx = -dy2;
                ny = dx2;
            }
            else {
                let dx1 = prevX - x;
                let dy1 = prevY - y;

                nx = dx1 + dx2;
                ny = dy1 + dy2;
            }
        }
        let d = Math.sqrt(nx * nx + ny * ny);
        nx /= d;
        ny /= d;
        normal[i6] = normal[i6 + 3] = nx;
        normal[i6 + 1] = normal[i6 + 4] = ny;
        normal[i6 + 2] = normal[i6 + 5] = 0;

        // Indices
        if (i > 0) {
            indices[off++] = i2 - 2;
            indices[off++] = i2;
            indices[off++] = i2 - 1;

            indices[off++] = i2;
            indices[off++] = i2 + 1;
            indices[off++] = i2 - 1;
        }

        prevX = x;
        prevY = y;
    }
    return {position, indices, normal};
}