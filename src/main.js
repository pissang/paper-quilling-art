import ClayAdvancedRenderer from 'claygl-advanced-renderer';
import { application, Vector3, util, Shader, Node, Geometry, Mesh, Material, plugin } from 'claygl';
import { parse, stringify, lerp } from 'zrender/src/tool/color';
import TextureUI from './ui/Texture';
import * as colorBrewer from 'd3-scale-chromatic';
import {extrudePolyline} from 'geometry-extrude';
// import {generateCircle} from './generator/circle';
import {generatePerlin, perlinSeed} from './generator/perlin';
import {extrude} from './extrude';
import debounce from 'lodash.debounce';
import clustering from 'density-clustering';
import clone from 'lodash.clonedeep';
import merge from 'lodash.merge';
import { createTextMaskImage, createMaskImage, resizeImage } from './imageHelper';
import Portrace from './dep/potrace';

const BOX = [
    [-11, -11],
    [11, 11]
];

let brewerMethods = [
    'BrBG', 'PuOr', 'RdBu', 'RdGy', 'RdYlBu', 'RdYlGn', 'Spectral',
    'Viridis', 'Inferno', 'Magma', 'Plasma', 'Warm', 'Cool', 'Rainbow', 'PuRd',
].map(function (a) {
    return 'interpolate' + a;
});
// let brewerMethods = Object.keys(colorBrewer);

import standardExtCode from './standard_extend.glsl';
Shader.import(standardExtCode);

let shader = new Shader(Shader.source('clay.standardMR.vertex'), Shader.source('papercut.standard_ext'));

let CONFIG_SCHEMA_VERSION = 2;
function createDefaultConfig() {
    let config = {

        version: CONFIG_SCHEMA_VERSION,

        seed: Math.random(),

        thickness: 0.01,
        height: 1,

        number: 800,
        trail: 100,
        noiseScale: 3,

        shadowDirection: [0.2, 0.2],
        shadowKernelSize: 16,
        shadowBlurSize: 2,

        cameraPosition: [0, 0],
        cameraDistance: 12,

        baseColor: [0, 63, 97],

        maskImage: '',

        paperDetail: './img/paper-detail.png',
        paperNormalDetail: './img/paper-normal.jpg',

        paperNormalScale: 1.5,

        clusterColors: true,

        colorNumber: 6,

        $colorNumberRange: [1, 7],

        layers: []
    };

    let initialColors = [
        [4, 38, 77],
        [37, 106, 168],
        [11, 51, 77],
        [97, 202, 255],
        [0, 162, 255],
        [255, 217, 0],
        [255, 244, 137]
    ];
    for (let k = 0; k < 7; k++) {
        config.layers.push({
            color: initialColors[k],
            intensity: 1
        });
    }
    return config;
}

function createRandomColors() {
    let method = colorBrewer[brewerMethods[Math.round(Math.random() * (brewerMethods.length - 1))]];
    config.layers.forEach(function (layer, idx) {
        layer.color = parse(method(1 - idx / 9)).slice(0, 3);
    });
};


function clusterColors(geometryData, colorCount) {
    let points = geometryData.map(item => item.centroid.slice());
    let kmeans = new clustering.KMEANS();
    let clusters = kmeans.run(points, colorCount);

    for (let i = 0; i < clusters.length; i++) {
        for (let k = 0; k < clusters[i].length; k++) {
            geometryData[clusters[i][k]].colorIndex = i;
        }
    }
}

let config;

try {
    config = JSON.parse(localStorage.getItem('main-config'));
    if (!config) {
        throw new Error('Unkown config');
    }
    if (+config.version !== CONFIG_SCHEMA_VERSION) {
        throw new Error('Config schema changed');
    }
    config.maskImage = '';
    console.log('Restored');
}
catch(e) {
    console.log(e);
    config = createDefaultConfig();
}

let undoStates = [
    { config: clone(config) }
];
let redoStates = [];

function undo() {
    if (undoStates.length < 2) {
        return;
    }
    let currentConfig = undoStates.pop();
    let lastConfig = undoStates[undoStates.length - 1];

    merge(config, lastConfig.config);
    redoStates.push(clone({
        config: currentConfig.config,
        updateMethod: currentConfig.updateMethod
    }));

    controlKit.update();

    if (currentConfig.updateMethod) {
        currentConfig.updateMethod();
    }
    else {
        app.methods.updateScrollingPapers();
        app.methods.updatePaperColors();
    }
}

function redo() {
    let redoConfig = redoStates.pop();
    if (redoConfig) {
        merge(config, redoConfig);
        redoStates.push({
            config: clone(redoConfig),
            updateMethod: redoConfig.updateMethod
        });

        controlKit.update();
        updateScrollingPapers();
    }
}

const saveStates = debounce(function (updateMethod) {
    undoStates.push({
        config: clone(config),
        updateMethod
    });
    if (undoStates.length > 20) {
        undoStates.shift();
    }
    redoStates.length = 0;
}, 300);

function reset() {
    let newConfig = createDefaultConfig();
    merge(config, newConfig);

    controlKit.update();

    updateScrollingPapers();
    app.methods.updateBaseColor();
}

// Auto save
setInterval(() => {
    localStorage.setItem('main-config', JSON.stringify(config));
    // console.log('Saved');
}, 3000);

document.getElementById('undo').addEventListener('click', undo);
document.getElementById('redo').addEventListener('click', redo);
document.getElementById('reset').addEventListener('click', reset);

let app = application.create('#main', {

    autoRender: false,

    devicePixelRatio: 1,

    init(app) {
        this._rootNode = new Node();
        app.scene.add(this._rootNode);

        this._renderer = app.renderer;
        this._advancedRenderer = new ClayAdvancedRenderer(app.renderer, app.scene, app.timeline, {
            temporalSuperSampling: {
                dynamic: false
            },
            shadow: {
                enable: true
            },
            postEffect: {
                bloom: {
                    enable: true
                },
                screenSpaceAmbientOcclusion: {
                    enable: true,
                    radius: 1,
                    intensity: 1.2,
                    quality: 'high'
                },
                screenSpaceReflection: {
                    enable: false
                }
            }
        });
        // TODO
        // this._advancedRenderer._renderMain._compositor._compositeNode.undefine('TONEMAPPING');
        this._rootNode.rotation.rotateX(-Math.PI / 2);

        this._camera = app.createCamera([0, 0, 10], [0, 0, 0]);
        this._camera.far = 50;

        this._dirLight = app.createDirectionalLight([0, 0, 0], '#fff', 0.7);
        this._dirLight.shadowResolution = 1024;
        this._dirLight.shadowBias = 0.001;

        app.createAmbientCubemapLight('img/pisa.hdr', 1, 1, 2);

        this._groundPlane = app.createPlane({
            shader: shader
        });
        this._groundPlane.scale.set(11, 11, 1);
        this._groundPlane.geometry.generateTangents();
        this._rootNode.add(this._groundPlane);

        app.methods.updateShadow();
        app.methods.updateCamera();

        this._paperMesh;
        this._outlineMesh;

        this._maskImage;
        this._maskImageSrc;
        this._maskImageOutlines;

        app.methods.updateBaseColor();

        app.methods.updateMaskImage().then(() => {
            app.methods.updateScrollingPapers();
            app.methods.updatePaperColors();
            app.methods.changePaperDetailTexture(app);
        });
    },

    loop() {
        // this._advancedRenderer.render();
    },

    methods: {
        render() {
            this._advancedRenderer.render();
        },

        updateMaskImage(app) {
            // this._maskImage = createTextMaskImage('A');
            // return Promise.resolve();

            if (this._maskImageSrc === config.maskImage) {
                return Promise.resolve(
                    this._maskImage
                );
            }
            else if (!config.maskImage || config.maskImage === 'none') {
                this._maskImage = null;
                this._maskImageSrc = '';
                return Promise.resolve(null);
            }
            else {
                return new Promise(resolve => {
                    let img = new Image();
                    img.onload = () => {
                        // Cutoff the white
                        this._maskImage = createMaskImage(img, 220, true);
                        this._maskImageSrc = config.maskImage;

                        app.methods.updateOutline(img);

                        resolve(this._maskImage);
                    };
                    img.src = config.maskImage;
                });
            }
        },

        updateOutline(app, img) {
            let potrace = new Portrace(resizeImage(img, 256, 256));
            potrace.process();
            let svg = potrace.getSVG(1);
            let doc = new DOMParser().parseFromString(svg, 'application/xml');
            let path = doc.querySelector('path');


            let scale = [(BOX[1][0] - BOX[0][0]) / 256, (BOX[1][1] - BOX[0][1]) / 256];
            let translation = [BOX[0][0], BOX[0][1]];

            let totalLength = path.getTotalLength();
            let points = [];
            for (let i = 0; i < 2000; i++) {
                let pt = path.getPointAtLength(i / 1000 * totalLength);
                points.push(
                    [pt.x * scale[0] + translation[0],
                    -(pt.y * scale[1] + translation[1])]
                );
            }

            let {indices, position, normal, uv} = extrudePolyline([points], {
                // TODO Configuration
                lineWidth: config.thickness * 5, depth: config.depth
            });

            if (!this._outlineMesh) {
                this._outlineMesh = new Mesh({
                    material: new Material({shader})
                });
                this._rootNode.add(this._outlineMesh);
            }
            if (this._outlineMesh.geometry) {
                this._outlineMesh.geometry.dispose(this._renderer);
            }
            let geo = this._outlineMesh.geometry = new Geometry();
            geo.attributes.position.value = position;
            geo.attributes.normal.value = normal;
            geo.attributes.texcoord0.value = uv;
            geo.indices = indices;
            geo.generateTangents();
            geo.updateBoundingBox();
            geo.dirty();
        },

        updateShadow() {
            let x = -config.shadowDirection[0];
            let z = config.shadowDirection[1];
            let lightDir = new Vector3(x, 1, z).normalize();
            let normal = Vector3.POSITIVE_Y;
            let ndl = Vector3.dot(lightDir, normal);
            this._dirLight.intensity = 0.7 / ndl;

            this._dirLight.position.set(x, 1, z);
            this._dirLight.lookAt(Vector3.ZERO, new Vector3(0, 0, -1));
            this._advancedRenderer.setShadow({
                kernelSize: config.shadowKernelSize,
                blurSize: Math.max(config.shadowBlurSize, 1)
            });
            this._advancedRenderer.render();
        },

        updateCamera() {
            // TODO RESET CAMERA
            let y = config.cameraDistance;
            let x = config.cameraPosition[0] * y;
            let z = -config.cameraPosition[1] * y;

            this._camera.position.set(x, y, z);
            this._camera.lookAt(Vector3.ZERO, new Vector3(0, 0, -1));

            this._advancedRenderer.render();
        },

        updateScrollingPapers() {
            if (!this._paperMesh) {
                this._paperMesh = new Mesh({
                    material: new Material({shader})
                });
                this._paperMesh.material.define('VERTEX_COLOR');
                this._rootNode.add(this._paperMesh);
            }
            if (this._paperMesh.geometry) {
                this._paperMesh.geometry.dispose(this._renderer);
            }
            this._paperMesh.geometry = new Geometry();

            perlinSeed(config.seed);
            // let polylines = generateCircle([0, 0], 0.1, 10, 0.5);
            let polylines = generatePerlin(
                BOX[0], BOX[1],
                config.number,
                config.trail,
                config.noiseScale,
                this._maskImage
            );
            let geometryData = [];
            let vertexCount = 0;
            let indicesCount = 0;
            let geo = this._paperMesh.geometry;

            polylines.forEach((polyline, index) => {
                // let {indices, position, normal} = extrude(polyline, 1);
                let {indices, position, normal, uv} = extrudePolyline([polyline], {
                    // TODO Configuration
                    lineWidth: config.thickness, depth: config.height
                });
                geometryData.push({
                    indices, position, normal, uv,
                    centroid: polyline[0].slice(),  // Use first point as centroid
                    vertexOffset: vertexCount,
                    indicesOffset: indicesCount,
                    vertexCount: position.length / 3
                });
                vertexCount += position.length / 3;
                indicesCount += indices.length;
            });
            let positionTotal = new Float32Array(vertexCount * 3);
            let normalTotal = new Float32Array(vertexCount * 3);
            let uvTotal = new Float32Array(vertexCount * 2);
            let indicesTotal = new (vertexCount > 65536 ? Uint32Array : Uint16Array)(indicesCount);
            geometryData.forEach(item => {
                positionTotal.set(item.position, item.vertexOffset * 3);
                normalTotal.set(item.normal, item.vertexOffset * 3);
                uvTotal.set(item.uv, item.vertexOffset * 2);
                for (let i = 0; i < item.indices.length; i++) {
                    indicesTotal[item.indicesOffset + i] = item.vertexOffset + item.indices[i];
                }
            });
            geo.attributes.position.value = positionTotal;
            geo.attributes.normal.value = normalTotal;
            geo.attributes.texcoord0.value = uvTotal;
            geo.indices = indicesTotal;
            geo.generateTangents();
            geo.updateBoundingBox();
            geo.dirty();

            this._geometryData = geometryData;
        },

        updateBaseColor() {
            this._groundPlane.material.set('color', stringify(config.baseColor, 'rgb'));
            this._advancedRenderer.render();
        },

        updatePaperColors() {
            let colors = config.layers.map(layer => layer.color.map(channel => channel / 255));
            if (this._paperMesh) {
                if (config.clusterColors
                    && this._geometryData.length > config.colorNumber * 4   // Needs to have enough data
                ) {
                    clusterColors(this._geometryData, Math.round(config.colorNumber));
                }
                else {
                    this._geometryData.forEach((item, index) => {
                        let colorIndex = index % Math.round(config.colorNumber);
                        item.colorIndex = colorIndex;
                    });
                }

                let colorValue = new Float32Array(this._paperMesh.geometry.vertexCount * 4);
                let off = 0;
                let paperCount = this._geometryData.length;
                for (let idx = 0; idx < paperCount; idx++) {
                    // let color = parse(lerp(, colors));
                    let colorIndex = this._geometryData[idx].colorIndex;
                    let color = colors[colorIndex];
                    let intensity = config.layers[colorIndex].intensity;
                    for (let k = 0; k < this._geometryData[idx].vertexCount; k++) {
                        for (let i = 0; i < 3; i++) {
                            colorValue[off++] = color[i] * intensity;
                        }
                        colorValue[off++] = 1;
                    }
                }
                this._paperMesh.geometry.attributes.color.value = colorValue;
                this._paperMesh.geometry.dirtyAttribute('color');
            }
            this._advancedRenderer.render();
        },

        changePaperDetailTexture(app) {
            let self = this;
            function setDetailTexture(detailTexture) {
                self._paperMesh.material.set('roughness', 1);
                self._paperMesh.material.set('detailMap', detailTexture);

                self._groundPlane.material.set('roughness', 1);
                self._groundPlane.material.set('detailMap', detailTexture);
                self._groundPlane.material.set('detailMapTiling', [8, 8]);

                if (self._outlineMesh) {
                    self._outlineMesh.material.set('rougness', 1);
                    self._outlineMesh.material.set('detailMap', detailTexture);
                }

                self._advancedRenderer.render();
            }

            function setDetailNormalMap(normalTexture) {
                self._paperMesh.material.set('normalMap', normalTexture);
                self._paperMesh.material.set('normalScale', config.paperNormalScale);
                if (self._outlineMesh) {
                    self._outlineMesh.material.set('normalMap', normalTexture);
                    self._outlineMesh.material.set('normalScale', config.paperNormalScale);
                }
                self._advancedRenderer.render();
            }

            if (config.paperDetail && config.paperDetail !== 'none') {
                app.loadTexture(config.paperDetail, {
                    convertToPOT: true
                }).then(setDetailTexture);
            }
            else {
                setDetailTexture(null);
            }

            if (config.paperNormalDetail && config.paperNormalDetail !== 'none') {
                app.loadTexture('img/paper-normal.jpg', {
                    convertToPOT: true
                }).then(setDetailNormalMap);
            }
            else {
                setDetailNormalMap(null);
            }
        }
    }
});

function doUpdateMaskImage() {
    app.methods.updateMaskImage().then(() => {
        app.methods.updateScrollingPapers();
        app.methods.updatePaperColors();
        app.methods.changePaperDetailTexture(app);
    });
}

function updateMaskImage() {
    doUpdateMaskImage();
    saveStates(() => {
        doUpdateMaskImage();
    });
}

function doUpdateScrollingPapers() {
    app.methods.updateScrollingPapers();
    app.methods.updatePaperColors();
}

function updateScrollingPapersImme() {
    doUpdateScrollingPapers();
    saveStates(() => {
        doUpdateScrollingPapers();
    });
}

let updateScrollingPapers = debounce(updateScrollingPapersImme, 500);

function updateBaseColor() {
    app.methods.updateBaseColor();
    saveStates(() => {
        app.methods.updateBaseColor();
    });
}
function updatePaperColors() {
    app.methods.updatePaperColors();
    saveStates(() => {
        app.methods.updatePaperColors();
    });
}
function changePaperDetailTexture() {
    app.methods.changePaperDetailTexture();
    saveStates(() => {
        app.methods.changePaperDetailTexture();
    });
}
function updateShadow() {
    app.methods.updateShadow();
    saveStates(() => {
        app.methods.updateShadow();
    });
}
function updateCamera() {
    app.methods.updateCamera();
    saveStates(() => {
        app.methods.updateCamera();
    });
}


let controlKit = new ControlKit({
    loadAndSave: false,
    useExternalStyle: true
});

let scenePanel = controlKit.addPanel({ label: 'Settings', width: 250 });

scenePanel.addGroup({ label: 'Generate' })
    .addNumberInput(config, 'thickness', { label: 'Thickness', onChange: updateScrollingPapers, step: 0.005, min: 0.01 })
    .addNumberInput(config, 'height', { label: 'Height', onChange: updateScrollingPapers, step: 0.1, min: 0.1 })
    .addNumberInput(config, 'number', { label: 'Number', onChange: updateScrollingPapers, step: 10, min: 50 })
    // .addNumberInput(config, 'trail', { label: 'Trail', onChange: updateScrollingPapers, step: 5, min: 50 })
    .addNumberInput(config, 'noiseScale', { label: 'Noise Scale', onChange: updateScrollingPapers, step: 1, min: 1 })
    .addCustomComponent(TextureUI, config, 'maskImage', { label: 'Mask', onChange: updateMaskImage })
    .addCheckbox(config, 'clusterColors', { label: 'Group Color', onChange: updatePaperColors })
    .addButton('Random', function () {
        config.seed = Math.random();

        updateScrollingPapersImme();
    });

scenePanel.addGroup({ label: 'Details', enable: false })
    .addCustomComponent(TextureUI, config, 'paperDetail', { label: 'Detail', onChange: changePaperDetailTexture })
    .addCustomComponent(TextureUI, config, 'paperNormalDetail', { label: 'Bump', onChange: changePaperDetailTexture })
    .addNumberInput(config, 'paperNormalScale', { label: 'Bump Scale', onChange: changePaperDetailTexture, step: 0.1, min: 0 });


scenePanel.addGroup({ label: 'Shadow', enable: false })
    .addPad(config, 'shadowDirection', { label: 'Direction', onChange: updateShadow })
    .addNumberInput(config, 'shadowBlurSize', { label: 'Blur Size', onChange: updateShadow, step: 0.5, min: 0 });

scenePanel.addGroup({ label: 'Camera', enable: false })
    .addPad(config, 'cameraPosition', { label: 'Position', onChange: updateCamera })
    .addNumberInput(config, 'cameraDistance', { label: 'Distance', onChange: updateCamera, step: 0.5, min: 0 });

let colorGroup = scenePanel.addGroup({ label: 'Colors' });
colorGroup.addColor(config, 'baseColor', { label: 'Base Color', colorMode: 'rgb', onChange: updateBaseColor });

colorGroup.addButton('Random Colors', function () {
    createRandomColors();
    updatePaperColors();
    controlKit.update();
});
colorGroup.addSlider(config, 'colorNumber', '$colorNumberRange', { label: 'lety', onFinish: updatePaperColors, step: 1});
for (let i = 0; i < config.layers.length; i++) {
    colorGroup.addColor(config.layers[i], 'color', { label: 'Color ' + (i + 1), colorMode: 'rgb', onChange: updatePaperColors  });
    // colorGroup.addNumberInput(config.layers[i], 'intensity', { label: 'Intensity', onChange: updatePaperColors, step: 0.1, min: 0  });
}
colorGroup.addButton('Revert Colors', function () {
    let colors = config.layers.map(function (layer) {
        return layer.color;
    }).reverse();
    config.layers.forEach(function (layer, idx) {
        layer.color = colors[idx];
    });
    updatePaperColors();
    controlKit.update();
});

window.addEventListener('resize', function () { app.resize(); app.methods.render(); } );

document.getElementById('loading').style.display = 'none';