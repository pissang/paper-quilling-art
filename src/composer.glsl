export var composerVert = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;


export var vignetteFrag = `
varying vec2 vUv;
uniform sampler2D tDiffuse;

uniform float darkness;
uniform float offset;

void main()
{
    vec4 texel = texture2D(tDiffuse, vUv);

    gl_FragColor.rgb = texel.rgb;

    vec2 uv = (vUv - vec2(0.5)) * vec2(offset);

    gl_FragColor = vec4(mix(texel.rgb, vec3(1.0 - darkness), dot(uv, uv)), texel.a);
}
`;


export var sharpenFrag = `
uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 size;
uniform float sharpness;

void main(void)
{
	float step_w = 1.0 / size.x;
	float step_h = 1.0 / size.y;

    float kernel[9];
    kernel[0] = -1.0 * sharpness;
    kernel[1] = -1.0 * sharpness;
    kernel[2] = -1.0 * sharpness;
    kernel[3] = -1.0 * sharpness;
    kernel[4] = 1.0 + 8.0 * sharpness;
    kernel[5] = -1.0 * sharpness;
    kernel[6] = -1.0 * sharpness;
    kernel[7] = -1.0 * sharpness;
    kernel[8] = -1.0 * sharpness;

	vec2 offset[9];
	offset[0] = vec2(-step_w, -step_h);
	offset[1] = vec2(0.0, -step_h);
	offset[2] = vec2(step_w, -step_h);
	offset[3] = vec2(-step_w, 0.0);
	offset[4] = vec2(0.0, 0.0);
	offset[5] = vec2(step_w, 0.0);
	offset[6] = vec2(-step_w, step_h);
	offset[7] = vec2(0.0, step_h);
	offset[8] = vec2(step_w, step_h);
	vec3 sum = vec3(0.0);
    for (int i = 0; i < 9; i++) {
		sum += texture2D(tDiffuse, vUv + offset[i]).rgb * kernel[i];
    }
	gl_FragColor = vec4(sum,1.0);
}
`;