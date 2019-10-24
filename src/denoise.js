// Denoiser from https://www.shadertoy.com/view/ldKBzG
import * as THREE from 'three';
import {denoiseVert, denoiseFrag} from './denoise.glsl';
import {downsampleVert, downsampleFrag} from './downsample.glsl';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer';
import {ShaderPass} from 'three/examples/jsm/postprocessing/ShaderPass';
import {TexturePass} from 'three/examples/jsm/postprocessing/TexturePass';
// import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass';
// import {SSAARenderPass} from 'three/examples/jsm/postprocessing/SSAARenderPass';

let renderer;

let denoiseComposer;

const inputTexture = new THREE.Texture();
inputTexture.minFilter = THREE.NearestFilter;
inputTexture.maxFilter = THREE.LinearFilter;

const denoisePasses = [];

function initComposer(scene, camera, normalTexture, depthTexture, width, height) {
    denoiseComposer = new EffectComposer(renderer);
    denoiseComposer.addPass(new TexturePass(inputTexture));
    for (let i = 0; i < 4; i++) {
        const pass = new ShaderPass({
            uniforms: {
                tNormal: {value: null},
                tDepth: {value: null},
                tDiffuse: {value: null},
                strength: {value: 1},

                separator: {value: 0.5},

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
        denoiseComposer.addPass(pass);
    }
}

function downsample(renderer, sourceTexture, downsamples) {
    let inTexture = sourceTexture;

    let camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    let mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: {value: null},
            textureSize: {value: new THREE.Vector2()}
        },
        vertexShader: downsampleVert,
        fragmentShader: downsampleFrag
    }));

    for (let i = 0; i < downsamples; i++) {
        let rt = new THREE.WebGLRenderTarget(inTexture.image.width / 2, inTexture.image.height / 2, {
            type: THREE.FloatType,
            minFilter: sourceTexture.minFilter,
            maxFilter: sourceTexture.maxFilter
        });

        mesh.material.uniforms.tDiffuse.value = inTexture;
        mesh.material.uniforms.textureSize.value.set(inTexture.image.width, inTexture.image.height);

        renderer.setRenderTarget(rt);
        renderer.render(mesh, camera);

        inTexture = rt.texture;
    }

    return inTexture;
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
    let normalRenderTarget = new THREE.WebGLRenderTarget(width * 8, height * 8, {
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

    let depthTextureDownsampled = downsample(renderer, depthTexture, 3);
    let normalTextureDownsampled = downsample(renderer, normalRenderTarget.texture, 3);

    initComposer(scene, camera, normalTextureDownsampled, depthTextureDownsampled, width, height);

    return renderer.domElement;
}

export function denoise(sourceImage, separator) {
    inputTexture.image = sourceImage;
    inputTexture.needsUpdate = true;

    denoisePasses.forEach(pass => {
        pass.uniforms.separator.value = separator;
    });

    denoiseComposer.render();
}