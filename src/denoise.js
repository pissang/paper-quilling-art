// Denoiser from https://www.shadertoy.com/view/ldKBzG
import * as THREE from 'three';
import {denoiseVert, denoiseFrag} from './denoise.frag';

let renderer;

const denoiseMaterial = new THREE.ShaderMaterial({
    uniforms: {
        tNormal: {value: null},
        tDepth: {value: null},
        tInput: {value: null},
        size: {value: new THREE.Vector2()}
    },
    vertexShader: denoiseVert,
    fragmentShader: denoiseFrag
});
const fullQuadMesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), denoiseMaterial);
const fullQuadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const inputTexture = new THREE.Texture();
inputTexture.minFilter = THREE.LinearFilter;
inputTexture.maxFilter = THREE.LinearFilter;
denoiseMaterial.uniforms.tInput.value = inputTexture;

export function initDenoiseScene(scene, camera, width, height) {
    renderer = new THREE.WebGLRenderer();
    renderer.setSize(width, height);
    renderer.setPixelRatio(1);

    denoiseMaterial.uniforms.size.value.set(width, height);

    let depthTexture = denoiseMaterial.uniforms.tDepth.value = new THREE.DepthTexture({
        minFilter: THREE.NearestFilter,
        maxFilter: THREE.NearestFilter,
        type: THREE.UnsignedIntType
    });
    let normalRenderTarget = new THREE.WebGLRenderTarget(width * 2, height * 2, {
        minFilter: THREE.NearestFilter,
        maxFilter: THREE.NearestFilter,
        type: THREE.FloatType,

        depthTexture,
        depthBuffer: true
    });
    denoiseMaterial.uniforms.tNormal.value = normalRenderTarget.texture;

    scene.overrideMaterial = new THREE.MeshNormalMaterial();
    renderer.setRenderTarget(normalRenderTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    return renderer.domElement;
}

export function denoise(sourceImage) {
    inputTexture.image = sourceImage;
    inputTexture.needsUpdate = true;
    renderer.render(fullQuadMesh, fullQuadCamera);
}