// https://www.shadertoy.com/view/ldKBzG

export var denoiseVert = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export var denoiseFrag = `
uniform sampler2D tDiffuse;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform sampler2D tId;
uniform float strength;

uniform mat4 projectionInv;

uniform vec2 size;

varying vec2 vUv;

uniform float separator;

vec3 fetchPos(vec2 uv) {
    vec4 projected = vec4(uv * 2.0 - 1.0, texture2D(tDepth, uv).r * 2.0 - 1.0, 1.0);
    vec4 pos = projectionInv * projected;
    return pos.xyz / pos.w;
}

void main() {
    vec2 offset[25];
    offset[0] = vec2(-2.0, -2.0);
    offset[1] = vec2(-1.0, -2.0);
    offset[2] = vec2(0.0, -2.0);
    offset[3] = vec2(1.0, -2.0);
    offset[4] = vec2(2.0, -2.0);

    offset[5] = vec2(-2.0, -1.0);
    offset[6] = vec2(-1.0, -1.0);
    offset[7] = vec2(0.0, -1.0);
    offset[8] = vec2(1.0, -1.0);
    offset[9] = vec2(2.0, -1.0);

    offset[10] = vec2(-2.0, 0.0);
    offset[11] = vec2(-1, 0.0);
    offset[12] = vec2(0.0, 0.0);
    offset[13] = vec2(1.0, 0.0);
    offset[14] = vec2(2.0, 0.0);

    offset[15] = vec2(-2.0, 1.0);
    offset[16] = vec2(-1.0, 1.0);
    offset[17] = vec2(0.0, 1.0);
    offset[18] = vec2(1.0, 1.0);
    offset[19] = vec2(2.0, 1.0);

    offset[20] = vec2(-2.0, 2.0);
    offset[21] = vec2(-1.0, 2.0);
    offset[22] = vec2(0.0, 2.0);
    offset[23] = vec2(1.0, 2.0);
    offset[24] = vec2(2.0, 2.0);


    float kernel[25];
    kernel[0] = 1.0 / 256.0;
    kernel[1] = 1.0 / 64.0;
    kernel[2] = 3.0 / 128.0;
    kernel[3] = 1.0 / 64.0;
    kernel[4] = 1.0 / 256.0;

    kernel[5] = 1.0 / 64.0;
    kernel[6] = 1.0 / 16.0;
    kernel[7] = 3.0 / 32.0;
    kernel[8] = 1.0 / 16.0;
    kernel[9] = 1.0 / 64.0;

    kernel[10] = 3.0 / 128.0;
    kernel[11] = 3.0 / 32.0;
    kernel[12] = 9.0 / 64.0;
    kernel[13] = 3.0 / 32.0;
    kernel[14] = 3.0 / 128.0;

    kernel[15] = 1.0 / 64.0;
    kernel[16] = 1.0 / 16.0;
    kernel[17] = 3.0 / 32.0;
    kernel[18] = 1.0 / 16.0;
    kernel[19] = 1.0 / 64.0;

    kernel[20] = 1.0 / 256.0;
    kernel[21] = 1.0 / 64.0;
    kernel[22] = 3.0 / 128.0;
    kernel[23] = 1.0 / 64.0;
    kernel[24] = 1.0 / 256.0;

    vec4 sum = vec4(0.0);
    float c_phi = 1.0;
    float n_phi = 1.0;
    float p_phi = 1.0;
	vec4 cval = texture2D(tDiffuse, vUv);
    vec3 idVal = texture2D(tId, vUv).rgb;
    // TODO, Why need to normalize?
	vec3 nval = normalize(texture2D(tNormal, vUv).xyz * 2.0 - 1.0);
	vec3 pval = fetchPos(vUv);

    float cum_w = 0.0;
    for(int i = 0; i < 25; i++)
    {
        vec2 uv = vUv + offset[i] / size * strength;
        vec4 ctmp = texture2D(tDiffuse, uv);
        vec4 t = cval - ctmp;
        float dist2 = dot(t, t);
        float c_w = min(exp(-(dist2) / c_phi), 1.0);

        float n_w = 1.0;
        float id_w = 1.0;

        // for (int k = 1; k < 5; k++) {
            // vec2 uv2 = vUv + offset[i] / size * (strength * float(k) / 4.0);
            vec3 ntmp = normalize(texture2D(tNormal, uv).xyz * 2.0 - 1.0);
            // vec3 t2 = nval - ntmp;
            dist2 = max(1.0 - dot(nval, ntmp), 0.0);
            n_w *= dist2 > 0.2 ? 0.0 : min(exp(-(dist2) / n_phi), 1.0);

            vec3 idTmp = texture2D(tId, uv).xyz;
            id_w *= idTmp == idVal ? 1.0 : 0.0;
        // }

        vec3 ptmp = fetchPos(vUv);
        // vec3 t2 = pval - ptmp;
        // dist2 = dot(t2, t2);

        // position and normal are in view space.
        vec3 dir = normalize(ptmp - pval);
        dist2 = abs(dot(dir, nval));
        float p_w = dist2 > 0.1 ? 0.0 : min(exp(-(dist2) / p_phi), 1.0);

        float weight = c_w * n_w * p_w * id_w;
        sum += texture2D(tDiffuse, uv) * weight * kernel[i];
        cum_w += weight * kernel[i];
    }


    if (vUv.x < separator - 0.0005) {
        // gl_FragColor = cval;
        gl_FragColor = vec4(nval, 1.0);
    }
    else if (vUv.x < separator) {
        gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
    }
    else {
        gl_FragColor = sum / cum_w;
    }

}
`;