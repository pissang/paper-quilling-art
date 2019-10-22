// Denoiser from https://www.shadertoy.com/view/ldKBzG
import * as THREE from 'three';
import {denoiseVert, denoiseFrag} from './denoise.frag';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer';
import {ShaderPass} from 'three/examples/jsm/postprocessing/ShaderPass';
import {TexturePass} from 'three/examples/jsm/postprocessing/TexturePass';

let renderer;

let composer;

const inputTexture = new THREE.Texture();
inputTexture.minFilter = THREE.LinearFilter;
inputTexture.maxFilter = THREE.LinearFilter;

const denoisePasses = [];

function initComposer(scene, camera, normalTexture, depthTexture, width, height) {
    composer = new EffectComposer(renderer);
    composer.addPass(new TexturePass(inputTexture));
    for (let i = 0; i < 2; i++) {
        const pass = new ShaderPass({
            uniforms: {
                tNormal: {value: null},
                tDepth: {value: null},
                tDiffuse: {value: null},
                strength: {value: 0.5},
                projectionInv: {value: camera.projectionMatrixInverse},
                size: {value: new THREE.Vector2(width, height)}
            },
            vertexShader: denoiseVert,
            fragmentShader: denoiseFrag
        });
        denoisePasses.push(pass);
        // It will clone another texture if passed the texture in the constructor
        pass.uniforms.tNormal.value = normalTexture;
        pass.uniforms.tDepth.value = depthTexture;
        composer.addPass(pass);
    }
}

export function initDenoiseScene(scene, camera, width, height) {
    renderer = new THREE.WebGLRenderer();
    renderer.setSize(width, height);
    renderer.setPixelRatio(1);

    let depthTexture = new THREE.DepthTexture({
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

    scene.overrideMaterial = new THREE.MeshNormalMaterial();
    renderer.setRenderTarget(normalRenderTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    initComposer(scene, camera, normalRenderTarget.texture, depthTexture, width, height);
    return renderer.domElement;
}

export function denoise(sourceImage) {
    inputTexture.image = sourceImage;
    inputTexture.needsUpdate = true;

    composer.render();
}