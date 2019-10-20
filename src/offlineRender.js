import {RayTracingRenderer} from 'three.js-ray-tracing-renderer';
import {EnvironmentLight} from 'three.js-ray-tracing-renderer/src/EnvironmentLight';
import {SoftDirectionalLight} from 'three.js-ray-tracing-renderer/src/SoftDirectionalLight';
import * as THREE from 'three';
import {RGBELoader} from 'three/examples/jsm/loaders/RGBELoader';

const RAY_TRACING = true;
const TOTAL_SAMPLES = 200;

window.THREE = THREE;
// THREE.EnvironmentLight = EnvironmentLight;
// THREE.SoftDirectionalLight = SoftDirectionalLight;

const width = 1920;
const height = 1080;

const scene = new THREE.Scene();
const renderer = new (RAY_TRACING ? RayTracingRenderer : THREE.WebGLRenderer)({
    canvas: document.querySelector('canvas')
});
renderer.setSize(width, height);

const camera = new THREE.PerspectiveCamera();
camera.aspect = width / height;
camera.position.set(0, 0, 5);

let finished = false;

function init() {
    function render() {
        if (finished) {
            return;
        }
        try {
            renderer.render(scene, camera);
        }
        catch(e) {
            alert('Render failed. Please use \'random\' button to regenerate and render again.');
        }
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
}


const envMap = new RGBELoader().load('img/canyon.hdr', () => {
    window.postMessage({
        type: 'prepared'
    });
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

renderer.gammaOutput = true;
renderer.gammaFactor = 2.2;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.5;

renderer.onSampleRendered = samples => {
    let progressDiv = document.querySelector('#progress');
    let statusDiv = document.querySelector('#status');
    if (samples > TOTAL_SAMPLES) {
        finished = true;
        progressDiv && (progressDiv.style.display = 'none');
        statusDiv && (statusDiv.style.display = 'none');
    }
    let progress = Math.round(
        samples / TOTAL_SAMPLES * 70 + 30
    );
    progressDiv && (progressDiv.style.width = progress + '%');
    statusDiv && (statusDiv.innerHTML = 'RENDERING');
};


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

window.addEventListener('message', function (e) {
    if (!e.data.objects) {
        return;
    }
    e.data.objects.forEach(obj => {
        let bufferGeo = new THREE.BufferGeometry();
        bufferGeo.addAttribute('position', new THREE.BufferAttribute(obj.attributes.position, 3));
        bufferGeo.addAttribute('normal', new THREE.BufferAttribute(obj.attributes.normal, 3));

        let map = null
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
            map
        }));
        mesh.matrix.fromArray(transform);
        mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
        scene.add(mesh);
    });

    camera.matrix.fromArray(e.data.camera.transform);
    camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);

    // Add ground
    let ground = new THREE.Mesh(new THREE.PlaneBufferGeometry(), new THREE.MeshStandardMaterial({
        roughness: 1,
        color: 0xaaaaaa
    }));
    ground.scale.set(50, 50, 1);
    scene.add(ground);

    init();
});