import {RayTracingRenderer} from 'ray-tracing-renderer';
import {EnvironmentLight} from 'ray-tracing-renderer/src/EnvironmentLight';
import {SoftDirectionalLight} from 'ray-tracing-renderer/src/SoftDirectionalLight';
import * as THREE from 'three';
import {RGBELoader} from 'three/examples/jsm/loaders/RGBELoader';
import {initDenoiser} from './denoise';
import Tweakpane from 'tweakpane';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer';
import {TexturePass} from 'three/examples/jsm/postprocessing/TexturePass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';
import {composerVert, vignetteFrag, sharpenFrag} from './composer.glsl';

const RAY_TRACING = true;
const TOTAL_SAMPLES = 500;

const renderConfig = {
    denoise: false,
    denoiseStrength: 0.5,

    showSeparate: false,

    separator: 0.5,

    sharpness: 0
};

window.THREE = THREE;
// THREE.EnvironmentLight = EnvironmentLight;
// THREE.SoftDirectionalLight = SoftDirectionalLight;

const WIDTH = 1920;
const HEIGHT = 1080;

const scene = new THREE.Scene();
const offlineRenderCanvas = document.createElement('canvas');
if (RAY_TRACING) {
    // create context here TODO
    offlineRenderCanvas.getContext('webgl2', {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
        failIfMajorPerformanceCaveat: true
    });
}
const offlineRenderer = new (RAY_TRACING ? RayTracingRenderer : THREE.WebGLRenderer)({
    canvas: offlineRenderCanvas
});
offlineRenderer.setSize(WIDTH, HEIGHT);
offlineRenderer.gammaOutput = true;
offlineRenderer.gammaFactor = 2.2;
offlineRenderer.toneMapping = THREE.ACESFilmicToneMapping;
offlineRenderer.toneMappingExposure = 1.5;

const camera = new THREE.PerspectiveCamera();
camera.aspect = WIDTH / HEIGHT;
camera.position.set(0, 0, 5);
camera.updateProjectionMatrix();

let finished = false;

let denoiserPasses = [];
let sharpenPass;
let vignettePass;

function initComposer() {
    sharpenPass = new ShaderPass({
        uniforms: {
            sharpness: {value: renderConfig.sharpness},
            size: {value: new THREE.Vector2(WIDTH, HEIGHT)},
            tDiffuse: {value: null}
        },
        vertexShader: composerVert,
        fragmentShader: sharpenFrag
    });
    vignettePass = new ShaderPass({
        uniforms: {
            darkness: {value: 1},
            offset: {value: 1},
            tDiffuse: {value: null}
        },
        vertexShader: composerVert,
        fragmentShader: vignetteFrag
    });
    composer.addPass(sharpenPass);
    // composer.addPass(vignettePass);
}

function init() {

    if (RAY_TRACING) {
        denoiserPasses = initDenoiser(composerRenderer, scene, camera, WIDTH, HEIGHT)
        denoiserPasses.forEach(pass => {
            pass.enabled = renderConfig.denoise;
            composer.addPass(pass);
        });
        initComposer();

    }

    function render() {
        if (finished) {
            return;
        }
        try {
            offlineRenderer.render(scene, camera);
        }
        catch(e) {
            console.log(e);
            alert('Render failed. Please use \'random\' button to regenerate and render again.');
            return;
        }
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
}

const composerRenderer = new THREE.WebGLRenderer();
composerRenderer.setSize(WIDTH, HEIGHT);
composerRenderer.setPixelRatio(1);
document.querySelector('#viewport').appendChild(composerRenderer.domElement);

const inputTexture = new THREE.CanvasTexture(offlineRenderCanvas);
inputTexture.minFilter = THREE.LinearFilter;
inputTexture.maxFilter = THREE.LinearFilter;

const composer = new EffectComposer(composerRenderer);
composer.addPass(new TexturePass(inputTexture));

const envMap = new RGBELoader().load('img/canyon.hdr', () => {
    window.postMessage({
        type: 'prepared'
    });

    // Test scene
    if (!window.opener) {
        let sphere = new THREE.Mesh(new THREE.SphereBufferGeometry(1, 50, 50), new THREE.MeshStandardMaterial({
            color: 0x0000ff
        }));
        sphere.position.x = -1;
        let cube = new THREE.Mesh(new THREE.TorusBufferGeometry(), new THREE.MeshStandardMaterial({
            color: 0xff0000
        }));
        cube.position.x = 0.5;
        scene.add(sphere);
        scene.add(cube);
        init();
    }
});
if (RAY_TRACING) {
    const envLlight = new EnvironmentLight(envMap, 0xffffff, 5);
    const mainLight = new SoftDirectionalLight(0xffffff, 1, 1);
    mainLight.position.set(1, 1, 2);

    // Env Light will cause firefly
    scene.add(envLlight);
    // scene.add(mainLight);
}
else {
    const mainLight = new THREE.DirectionalLight();
    const ambientLight = new THREE.HemisphereLight();
    scene.add(mainLight);
    scene.add(ambientLight);
}

function stopRender() {
    finished = true;
    let progressDiv = document.querySelector('#progress');
    let statusDiv = document.querySelector('#status');
    progressDiv && (progressDiv.style.display = 'none');
    statusDiv && (statusDiv.style.display = 'none');
}

offlineRenderer.onSampleRendered = samples => {
    let progressDiv = document.querySelector('#progress');
    let statusDiv = document.querySelector('#status');
    if (samples > TOTAL_SAMPLES) {
        stopRender();
    }
    let progress = Math.round(
        samples / TOTAL_SAMPLES * 70 + 30
    );
    progressDiv && (progressDiv.style.width = progress + '%');
    statusDiv && (statusDiv.innerHTML = 'RENDERING');

    inputTexture.needsUpdate = true;
    // Do Denoise
    composer.render();
};

document.querySelector('#viewport').addEventListener('click', function (e) {
    if (renderConfig.showSeparate) {
        renderConfig.separator = e.offsetX / WIDTH;
        denoiserPasses.forEach(pass => {
            pass.uniforms.separator.value = renderConfig.separator;
        });
    }
    if (finished) {
        composer.render();
    }
});


function packVertexColorToTexture(color) {
    let colorsIndex = {};
    let colors = [];
    let uv = new Float32Array(color.length / 3 * 2);
    let count = 0;
    for (let i = 0; i < color.length; i += 3) {
        let r = color[i];
        let g = color[i + 1];
        let b = color[i + 2];
        let key = r.toFixed(3) + '-' + g.toFixed(3) + '-' + b.toFixed(3);

        if (colorsIndex[key] == null) {
            colorsIndex[key] = count;
            colors.push([r, g, b]);
            count++;
        }
        // Scale to 3x to avoid sampling issues in rt renderer.
        uv[i / 3 * 2] = colorsIndex[key] * 3 + 1;

    }

    for (let i = 0; i < uv.length; i += 2) {
        uv[i] /= count * 3;
        uv[i + 1] = 0.5;
    }

    let canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d');
    canvas.width = count * 3;
    canvas.height = 1;

    let imgData = ctx.getImageData(0, 0, count * 3, 1);
    for (let i = 0; i < count; i++) {
        for (let n = 0; n < 3; n++) {
            for (let k = 0; k < 3; k++) {
                imgData.data[(i * 3 + n) * 4 + k] = colors[i][k] * 255;
            }
            imgData.data[(i * 3 + n) * 4 + 3] = 255;
        }
    }
    ctx.putImageData(imgData, 0, 0);

    // canvas.style.cssText = 'position:absolute;left:0;top:0;z-index:1000;height:20px;';
    // document.body.appendChild(canvas);
    return {canvas, uv};

}

function intToRgb(int, rgb) {
    var red = int >> 16;
    var green = int - (red << 16) >> 8;
    var blue = int - (red << 16) - (green << 8);
    rgb[0] = red / 255;
    rgb[1] = green / 255;
    rgb[2] = blue / 255;
    return rgb;
}

window.addEventListener('message', function (e) {
    if (!e.data.objects) {
        return;
    }

    let objIdOffset = 0;

    e.data.objects.forEach(obj => {
        let bufferGeo = new THREE.BufferGeometry();
        bufferGeo.addAttribute('position', new THREE.BufferAttribute(obj.attributes.position, 3));
        bufferGeo.addAttribute('normal', new THREE.BufferAttribute(obj.attributes.normal, 3));

        let map = null;
        if (obj.attributes.color) {
            let vertexColor = new Float32Array(obj.attributes.color.length / 4 * 3);
            for (let i = 0; i < vertexColor.length / 3; i++) {
                let i3 = i * 3;
                let i4 = i * 4;

                for (let k = 0; k < 3; k++) {
                    vertexColor[i3 + k] = obj.attributes.color[i4 + k];
                }
            }

            // bufferGeo.addAttribute('color', new THREE.BufferAttribute(vertexColor, 3));
            let {uv, canvas} = packVertexColorToTexture(vertexColor);

            bufferGeo.addAttribute('uv', new THREE.BufferAttribute(uv, 2));

            map = new THREE.CanvasTexture(canvas);
            map.minFilter = THREE.NearestFilter;
            map.magFilter = THREE.NearestFilter;

        }
        else {
            bufferGeo.addAttribute('uv', new THREE.BufferAttribute(obj.attributes.uv, 2));
        }

        bufferGeo.setIndex(new THREE.BufferAttribute(obj.indices, 1));

        let transform = obj.transform;
        let mesh = new THREE.Mesh(bufferGeo, new THREE.MeshStandardMaterial({
            roughness: 1,
            color: new THREE.Color(obj.material.color[0], obj.material.color[1], obj.material.color[2]),
            map
        }));
        mesh.matrix.fromArray(transform);
        mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);

        let idColorArrTmp = [];
        if (obj.attributes.segments) {
            let idColor = new Float32Array(obj.attributes.segments.length * 4);
            let maxSegId = 0;
            let off = 0;
            for (let i = 0; i < obj.attributes.segments.length; i++) {
                let segId = obj.attributes.segments[i];
                maxSegId = Math.max(maxSegId, segId);
                intToRgb(segId + objIdOffset, idColorArrTmp);

                for (let k = 0; k < 3; k++) {
                    idColor[off++] = idColorArrTmp[k];
                }
            }

            objIdOffset += maxSegId;

            mesh.idColorArray = idColor;
        }
        else {
            mesh.idColor = intToRgb(objIdOffset++, []);
        }

        scene.add(mesh);
    });

    camera.matrix.fromArray(e.data.camera.transform);
    camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);

    // Add ground
    let ground = new THREE.Mesh(new THREE.PlaneBufferGeometry(), new THREE.MeshStandardMaterial({
        roughness: 1,
        color: new THREE.Color(e.data.plane.color[0], e.data.plane.color[1], e.data.plane.color[2]),
    }));
    // ground.material.shadowCatcher = true;
    ground.scale.set(100, 100, 1);
    scene.add(ground);

    init();
});

function updateComposer() {
    sharpenPass.uniforms.sharpness.value = renderConfig.sharpness;
    composer.render();
}

const pane = new Tweakpane({
    container: document.querySelector('#config'),
    title: 'Render Config'
});
pane.addButton({
    title: 'Stop Render'
}).on('click', () => {
    stopRender();
});

const denoiseFolder = pane.addFolder({
    title: 'Denoise'
});
denoiseFolder.addInput(renderConfig, 'denoise', {
    label: 'Enable'
}).on('change', () => {
    denoiserPasses.forEach(pass => {
        pass.enabled = renderConfig.denoise;
    });
    composer.render();
});
denoiseFolder.addInput(renderConfig, 'denoiseStrength', {
    label: 'Strength',
    min: 0,
    max: 1
}).on('change', () => {
    denoiserPasses.forEach(pass => {
        pass.uniforms.strength.value = renderConfig.denoiseStrength;
    });
    composer.render();
});
denoiseFolder.addInput(renderConfig, 'showSeparate', {
    label: 'Separate'
}).on('change', () => {
    denoiserPasses.forEach(pass => {
        pass.uniforms.separator.value = renderConfig.showSeparate
            ? renderConfig.separator : 0;
    });
    composer.render();
});

pane.addFolder({
    title: 'Sharpen'
}).addInput(renderConfig, 'sharpness', {
    min: 0,
    max: 0.2
}).on('change', updateComposer);