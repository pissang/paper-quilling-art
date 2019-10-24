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

function initComposer(scene, camera, normalTexture, depthTexture, idTexture, width, height) {
    denoiseComposer = new EffectComposer(renderer);
    denoiseComposer.addPass(new TexturePass(inputTexture));
    for (let i = 0; i < 4; i++) {
        const pass = new ShaderPass({
            uniforms: {
                tNormal: {value: null},
                tDepth: {value: null},
                tDiffuse: {value: null},
                tId: {value: null},
                strength: {value: 0.5},

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
        pass.uniforms.tId.value = idTexture;

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
            type: sourceTexture.type === THREE.UnsignedByteType ? THREE.UnsignedByteType : THREE.FloatType,
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

function renderIdTexture(renderer, scene, camera, width, height) {
    scene.traverse(mesh => {
        if (mesh.idColorArray) {
            if (mesh.geometry.attributes.color) {
                let oldColorArray = mesh.geometry.attributes.color.value;
                mesh.geometry.attributes.color.value = mesh.idColorArray;
                mesh.geometry.needsUpdate = true;
                mesh.oldColorArray = oldColorArray;
            }
            else {
                mesh.geometry.addAttribute('color', new THREE.BufferAttribute(mesh.idColorArray, 3, false));
            }

            mesh.oldMaterial = mesh.material;
            mesh.material = new THREE.MeshBasicMaterial({
                vertexColors: THREE.VertexColors
            });
        }
        else if (mesh.idColor) {
            mesh.oldMaterial = mesh.material;
            mesh.material = new THREE.MeshBasicMaterial({
                color: new THREE.Color(mesh.idColor[0], mesh.idColor[1], mesh.idColor[2])
            });
        }
    });

    let rt = new THREE.WebGLRenderTarget(width, height);
    renderer.setRenderTarget(rt);
    scene.overrideMaterial = null;
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    scene.traverse(mesh => {
        if (mesh.oldMaterial) {
            mesh.material = mesh.oldMaterial;
            mesh.oldMaterial = null;
        }

        if (mesh.idColorArray) {
            if (mesh.oldColorArray) {
                mesh.geometry.attributes.color.value = mesh.oldColorArray;
            }
            else {
                mesh.geometry.removeAttribute('color');
            }
            mesh.geometry.needsUpdate = true;
        }
    });

    return rt.texture;
}

export function initDenoiseScene(scene, camera, width, height) {
    renderer = new THREE.WebGLRenderer();
    renderer.setSize(width, height);
    renderer.setPixelRatio(1);

    let depthTexture = new THREE.DepthTexture({
        minFilter: THREE.LinearFilter,
        maxFilter: THREE.LinearFilter,
        type: THREE.UnsignedIntType
    });
    let normalRenderTarget = new THREE.WebGLRenderTarget(width * 8, height * 8, {
        minFilter: THREE.LinearFilter,
        maxFilter: THREE.LinearFilter,
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

    let idTextureDownsampled = downsample(renderer, renderIdTexture(renderer, scene, camera, width * 8, height * 8), 3);

    initComposer(scene, camera, normalTextureDownsampled, depthTextureDownsampled, idTextureDownsampled, width, height);

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