// https://www.shadertoy.com/view/ldKBzG

export var downsampleVert = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export var downsampleFrag = `

uniform sampler2D tDiffuse;
uniform vec2 textureSize;

varying vec2 vUv;

// Brightness function
float brightness(vec3 c)
{
    return max(max(c.r, c.g), c.b);
}

void main()
{
    vec4 d = vec4(-1.0, -1.0, 1.0, 1.0) / textureSize.xyxy;

#ifdef ANTI_FLICKER
    // https://github.com/keijiro/KinoBloom/blob/master/Assets/Kino/Bloom/Shader/Bloom.cginc#L96
    // TODO
    vec3 s1 = texture2D(tDiffuse, vUv + d.xy).rgb;
    vec3 s2 = texture2D(tDiffuse, vUv + d.zy).rgb;
    vec3 s3 = texture2D(tDiffuse, vUv + d.xw).rgb;
    vec3 s4 = texture2D(tDiffuse, vUv + d.zw).rgb;

    // Karis's luma weighted average (using brightness instead of luma)
    float s1w = 1.0 / (brightness(s1) + 1.0);
    float s2w = 1.0 / (brightness(s2) + 1.0);
    float s3w = 1.0 / (brightness(s3) + 1.0);
    float s4w = 1.0 / (brightness(s4) + 1.0);
    float oneDivideSum = 1.0 / (s1w + s2w + s3w + s4w);

    vec4 color = vec4(
        (s1 * s1w + s2 * s2w + s3 * s3w + s4 * s4w) * oneDivideSum,
        1.0
    );
#else
    vec4 color = texture2D(tDiffuse, vUv + d.xy);
    color += texture2D(tDiffuse, vUv + d.zy);
    color += texture2D(tDiffuse, vUv + d.xw);
    color += texture2D(tDiffuse, vUv + d.zw);
    color *= 0.25;
#endif

    gl_FragColor = color;
}

`;