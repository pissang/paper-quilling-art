import ClayAdvancedRenderer from 'claygl-advanced-renderer';
import { application, Vector3, util, Shader, Node, Geometry, Mesh, Material, plugin } from 'claygl';
import { parse, stringify, lerp } from 'zrender/src/tool/color';
import TextureUI from './ui/Texture';
import * as colorBrewer from 'd3-scale-chromatic';
import {extrudePolyline} from 'geometry-extrude';
// import {generateCircle} from './generator/circle';
import {generatePerlin, perlinSeed, rand} from './generator/perlin';
import {extrude} from './extrude';
import debounce from 'lodash.debounce';
import clustering from 'density-clustering';
import clone from 'lodash.clonedeep';
import merge from 'lodash.merge';
import { createTextMaskImage, createMaskImageData, resizeImage } from './imageHelper';
import Portrace from './dep/potrace';
import seedrandom from 'seedrandom';

clustering.KMEANS.prototype.randomCentroid = function() {
    var maxId = this.dataset.length -1;
    var centroid;
    var id;

    do {
        id = Math.round(rand() * maxId);
        centroid = this.dataset[id];
    } while (this.centroids.indexOf(centroid) >= 0);
    return centroid;
};

const BOX_SIZE = 11;
const BOX = [
    [-BOX_SIZE, -BOX_SIZE],
    [BOX_SIZE, BOX_SIZE]
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
let shadowShader = new Shader(Shader.source('clay.standardMR.vertex'), Shader.source('papercut.standard_ext_shadow'));

let CONFIG_SCHEMA_VERSION = 10;
function createDefaultConfig() {
    let config = {

        version: CONFIG_SCHEMA_VERSION,

        seed: Math.random(),

        thickness: 0.01,
        minHeight: 1,
        maxHeight: 1,

        number: 800,
        trail: 100,
        noiseScale: 3,


        // Configuration about mask
        maskImage: '',
        showOutline: true,
        outlineColor: [0, 63, 97],
        outlineThickness: 0.04,
        outlineHeight: 1,

        maskText: '',
        maskTextFont: 'sans-serif',

        // Configuration about shadow
        shadowDirection: [0.2, 0.2],
        shadowKernelSize: 16,
        shadowBlurSize: 4,

        cameraAlpha: 0,
        cameraBeta: 0,
        cameraDistance: 12,

        // Ground and background
        backgroundColor: [48, 48, 48],

        shadowIntensity: 0.8,
        planeColor: [0, 63, 97],
        showPlane: true,
        // Configuration about texture
        paperDetail: './img/paper-detail.png',
        paperNormalDetail: './img/paper-normal.jpg',
        paperNormalScale: 1.5,

        // Configuration about paper color
        clusterColors: true,

        colorNumber: 6,

        $colorNumberRange: [1, 7],
        $normalizedRange: [0, 1],

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
        config: clone(currentConfig.config),
        updateMethod: currentConfig.updateMethod
    }));

    controlKit.update();

    if (currentConfig.updateMethod) {
        currentConfig.updateMethod();
    }
    else {
        app.methods.updateScrollingPapers();
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
    updateMaskImage();
    app.methods.updatePlaneColor();
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
        // this._rootNode.rotation.rotateX(-Math.PI / 2);

        this._camera = app.createCamera([0, 0, 10], [0, 0, 0]);
        this._camera.far = 100;

        this._dirLight = app.createDirectionalLight([0, 0, 0], '#fff', 0.7);
        this._dirLight.shadowResolution = 1024;
        this._dirLight.shadowBias = 0.001;


        this._groundPlane = app.createPlane({
            shader,
            roughness: 1
        });
        this._groundMaterial = this._groundPlane.material;

        this._groundShadowMaterial = new Material({ shader: shadowShader });
        this._groundPlane.scale.set(11, 11, 1);
        this._groundPlane.geometry.generateTangents();
        this._rootNode.add(this._groundPlane);

        app.methods.updateShadow();

        this._paperMesh;

        this._outlineMesh = new Mesh({
            material: new Material({shader})
        });

        this._maskImage;
        this._maskImageData;
        this._maskImageSrc;
        this._maskOutlinePoints;

        let control = new plugin.OrbitControl({
            domElement: app.renderer.canvas,
            target: this._camera,
            timeline: app.timeline,
            damping: 0
        });
        control.setAlpha(config.cameraAlpha);
        control.setBeta(config.cameraBeta);
        control.setDistance(config.cameraDistance);

        control.on('update', () => {
            this._advancedRenderer.render();
            config.cameraAlpha = control.getAlpha();
            config.cameraBeta = control.getBeta();
            config.cameraDistance = control.getDistance();
        });

        app.createAmbientCubemapLight('img/hall.hdr', 0.01, 1, 2);

        app.methods.updatePlaneColor();

        app.methods.updateMaskImage().then(() => {
            app.methods.updateScrollingPapers();
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
            // Use text as higher priority
            if (config.maskText) {
                this._maskImage = createTextMaskImage(config.maskText, config.maskTextFont);
                this._maskImageData = this._maskImage.getContext('2d').getImageData(0, 0, this._maskImage.width, this._maskImage.height);
                this._maskImageSrc = '__text_placeholder__';
                app.methods.updateOutline();
                return Promise.resolve();
            }

            else if (this._maskImageSrc === config.maskImage) {
                app.methods.updateOutline();
                return Promise.resolve(
                    this._maskImage
                );
            }
            else if (!config.maskImage || config.maskImage === 'none') {
                this._maskImage = this._maskImageData = null;
                this._maskImageSrc = '';
                app.methods.updateOutline();
                return Promise.resolve(null);
            }
            else {
                return new Promise(resolve => {
                    let img = new Image();
                    img.onload = () => {
                        this._maskImage = img;
                        // Cutoff the white
                        this._maskImageData = createMaskImageData(img, 220, true);
                        this._maskImageSrc = config.maskImage;

                        app.methods.updateOutline();

                        resolve();
                    };
                    img.src = config.maskImage;
                });
            }
        },

        updateOutline(app) {
            if (!this._maskImage) {
                this._rootNode.remove(this._outlineMesh);
                this._advancedRenderer.render();
                return;
            }

            let potrace = new Portrace(resizeImage(this._maskImage, 128, 128));
            potrace.process();
            let svgStr = potrace.getSVG(1);
            let svg = new DOMParser().parseFromString(svgStr, 'application/xml');

            let div = document.createElement('div');
            div.style.cssText = 'position:absolute;left:0;top:0;z-index:1000';
            // div.appendChild(
            //     div.ownerDocument.importNode(svg.documentElement, true)
            // );
            document.body.appendChild(div);

            let scale = [(BOX[1][0] - BOX[0][0]) / 128, (BOX[1][1] - BOX[0][1]) / 128];
            let translation = [BOX[0][0], BOX[0][1]];

            let pathAll = svg.querySelectorAll('path');
            let polylines = [];
            let maskOutlinePoints = [];
            for (let p = 0; p < pathAll.length; p++) {
                let path = pathAll[p];
                let totalLength = path.getTotalLength();
                let polyline = [];
                for (let i = 0; i <= totalLength; i += 0.2) {
                    let pt = path.getPointAtLength(i);
                    let x = pt.x * scale[0] + translation[0];
                    let y = -(pt.y * scale[1] + translation[1]);
                    polyline.push([x, y]);
                    maskOutlinePoints.push(x);
                    maskOutlinePoints.push(y);
                }
                polylines.push(polyline);
            }
            this._maskOutlinePoints = new Float32Array(maskOutlinePoints);


            if (!(config.outlineHeight > 0 && config.outlineThickness > 0)) {
                this._rootNode.remove(this._outlineMesh);
                this._advancedRenderer.render();
                return;
            }

            this._rootNode.add(this._outlineMesh);


            let {indices, position, normal, uv} = extrudePolyline(polylines, {
                // TODO Configuration
                lineWidth: config.outlineThickness, depth: config.outlineHeight
            });
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

            app.methods.updateOutlineColor();
        },

        updateShadow() {
            let x = -config.shadowDirection[0];
            let y = -config.shadowDirection[1];
            let lightDir = new Vector3(x, y, 1).normalize();
            let normal = Vector3.POSITIVE_Z;
            let ndl = Vector3.dot(lightDir, normal);
            this._dirLight.intensity = 0.7 / ndl;

            this._dirLight.position.set(x, y, 1);
            this._dirLight.lookAt(Vector3.ZERO, new Vector3(0, 1, 0));
            this._advancedRenderer.setShadow({
                kernelSize: config.shadowKernelSize,
                blurSize: Math.max(config.shadowBlurSize, 1)
            });
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
                this._maskImageData,
                this._maskOutlinePoints
            );
            let geometryData = [];
            let vertexCount = 0;
            let indicesCount = 0;
            let geo = this._paperMesh.geometry;

            polylines.forEach((polyline, index) => {
                // let {indices, position, normal} = extrude(polyline, 1);
                let {indices, position, normal, uv} = extrudePolyline([polyline], {
                    // TODO Configuration
                    lineWidth: config.thickness, depth: 1
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
            geo.dirty();

            this._geometryData = geometryData;

            app.methods.updatePaperColorsAndHeights();
        },

        updatePlaneColor() {
            this._groundPlane.material.set('color', config.planeColor.map(rgb => rgb / 255));
            this._advancedRenderer.render();
        },

        updateOutlineColor() {
            if (this._outlineMesh) {
                this._outlineMesh.material.set('color', config.outlineColor.map(rgb => rgb / 255));
            }

            this._advancedRenderer.render();
        },

        showPlane() {
            this._groundPlane.material = this._groundMaterial;
            this._groundPlane.scale.set(BOX_SIZE, BOX_SIZE, 1);
            this._advancedRenderer.render();
        },

        hidePlane() {
            this._groundPlane.material = this._groundShadowMaterial;
            this._groundPlane.scale.set(BOX_SIZE * 2, BOX_SIZE * 2, 1);
            this._advancedRenderer.render();
        },

        updatePlane(app) {
            config.showPlane ? app.methods.showPlane() : app.methods.hidePlane();
            app.methods.updatePlaneColor();
            this._groundPlane.material.set('shadowIntensity', config.shadowIntensity);
        },

        updatePaperColorsAndHeights(app, onlyUpdateHeight) {
            let colors = config.layers.map(layer => layer.color.map(channel => channel / 255));
            let heightsMap = [];
            let fixedRand = seedrandom('height');
            if (this._paperMesh) {
                if (!onlyUpdateHeight) {
                    // DON'T Update colors.
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
                }

                let colorValue = new Float32Array(this._paperMesh.geometry.vertexCount * 4);
                let positionValue = this._paperMesh.geometry.attributes.position.value;
                let off = 0;
                let paperCount = this._geometryData.length;
                for (let idx = 0; idx < paperCount; idx++) {
                    // let color = parse(lerp(, colors));
                    let colorIndex = this._geometryData[idx].colorIndex;
                    let color = colors[colorIndex];
                    let intensity = config.layers[colorIndex].intensity;
                    if (heightsMap[colorIndex] == null) {
                        heightsMap[colorIndex] = fixedRand() * (config.maxHeight - config.minHeight) + config.minHeight;
                    }
                    let vertexOffset = this._geometryData[idx].vertexOffset;
                    let height = heightsMap[colorIndex];
                    for (let k = 0; k < this._geometryData[idx].vertexCount; k++) {
                        for (let i = 0; i < 3; i++) {
                            colorValue[off++] = color[i] * intensity;
                        }
                        colorValue[off++] = 1;

                        if (positionValue[(k + vertexOffset) * 3 + 2] > 0) {
                            positionValue[(k + vertexOffset) * 3 + 2] = Math.max(height, 0.01);
                        }
                    }
                }
                this._paperMesh.geometry.attributes.color.value = colorValue;
                this._paperMesh.geometry.dirtyAttribute('color');
                this._paperMesh.geometry.dirtyAttribute('position');
            }
            this._advancedRenderer.render();

            this._paperMesh.geometry.updateBoundingBox();
        },

        changePaperDetailTexture(app) {
            let self = this;
            function setDetailTexture(detailTexture) {
                self._paperMesh.material.set('roughness', 1);
                self._paperMesh.material.set('detailMap', detailTexture);

                self._groundMaterial.set('detailMap', detailTexture);
                self._groundMaterial.set('detailMapTiling', [8, 8]);

                if (self._outlineMesh) {
                    self._outlineMesh.material.set('roughness', 1);
                    self._outlineMesh.material.set('detailMap', detailTexture);
                    self._outlineMesh.material.set('detailMapTiling', [4, 4]);
                    self._outlineMesh.material.set('uvRepeat', [4, 4]);
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
        app.methods.changePaperDetailTexture(app);
    });
}

function updateMaskImage() {
    doUpdateMaskImage();
    saveStates(() => {
        doUpdateMaskImage();
    });
}

let updateMaskImageDebounced = debounce(updateMaskImage, 700);

function updateOutline() {
    app.methods.updateOutline();
    saveStates(() => {
        app.methods.updateOutline();
    });
}

let updateOutlineDebounced = debounce(updateOutline, 500);

function updateOutlineColor() {
    app.methods.updateOutlineColor();
    saveStates(() => {
        app.methods.updateOutlineColor();
    });
}

function doUpdateScrollingPapers() {
    app.methods.updateScrollingPapers();
}

function updateScrollingPapers() {
    doUpdateScrollingPapers();
    saveStates(() => {
        doUpdateScrollingPapers();
    });
}
let updateScrollingPapersDebounced = debounce(updateScrollingPapers, 500);

function updatePlaneColor() {
    app.methods.updatePlaneColor();
    saveStates(() => {
        app.methods.updatePlaneColor();
    });
}
function updatePaperColors() {
    app.methods.updatePaperColorsAndHeights(false);
    saveStates(() => {
        app.methods.updatePaperColorsAndHeights(false);
    });
}
function updatePaperHeights() {
    app.methods.updatePaperColorsAndHeights(true);
    saveStates(() => {
        app.methods.updatePaperColorsAndHeights(true);
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

function doUpdateBackgroundAndBase() {
    document.body.querySelector('#main').style.backgroundColor = 'rgb(' + config.backgroundColor.join(',') + ')';
    app.methods.updatePlane();
}
function updateBackgroundAndBase() {
    doUpdateBackgroundAndBase();
    saveStates(() => {
        doUpdateBackgroundAndBase();
    });
}
doUpdateBackgroundAndBase();

let controlKit = new ControlKit({
    loadAndSave: false,
    useExternalStyle: true
});

let scenePanel = controlKit.addPanel({ label: 'Settings', width: 250 });

scenePanel.addGroup({ label: 'Generate' })
    .addNumberInput(config, 'thickness', { label: 'Thickness', onChange: updateScrollingPapersDebounced, step: 0.005, min: 0.01 })
    .addNumberInput(config, 'minHeight', { label: 'Min Height', onChange: updatePaperHeights, step: 0.1, min: 0.1 })
    .addNumberInput(config, 'maxHeight', { label: 'Max Height', onChange: updatePaperHeights, step: 0.1, min: 0.1 })
    .addNumberInput(config, 'number', { label: 'Number', onChange: updateScrollingPapersDebounced, step: 10, min: 50 })
    // .addNumberInput(config, 'trail', { label: 'Trail', onChange: updateScrollingPapersDebounced, step: 5, min: 50 })
    .addNumberInput(config, 'noiseScale', { label: 'Noise Scale', onChange: updateScrollingPapersDebounced, step: 1, min: 1 })
    .addCheckbox(config, 'clusterColors', { label: 'Group Color', onChange: updatePaperColors })
    .addButton('Random', function () {
        config.seed = Math.random();

        updateScrollingPapers();
    });

scenePanel.addGroup({ label: 'Background' })
    .addColor(config, 'backgroundColor', { label: 'Background', colorMode: 'rgb', onChange: updateBackgroundAndBase })
    .addSlider(config, 'shadowIntensity', '$normalizedRange', { label: 'Shadow', onChange: updateBackgroundAndBase })
    .addCheckbox(config, 'showPlane', { label: 'Plane', onChange: updateBackgroundAndBase})
    .addColor(config, 'planeColor', { label: 'Plane Color', colorMode: 'rgb', onChange: updatePlaneColor });

scenePanel.addGroup({ label: 'Outline' })
    .addStringInput(config, 'maskText', { label: 'Text Mask', onChange: updateMaskImageDebounced })
    .addCustomComponent(TextureUI, config, 'maskImage', { label: 'Image Mask', onChange: updateMaskImage })
    .addNumberInput(config, 'outlineThickness', { label: 'Thickness', onChange: updateOutlineDebounced, step: 0.005, min: 0.01 })
    .addNumberInput(config, 'outlineHeight', { label: 'Height', onChange: updateOutlineDebounced, step: 0.1, min: 0.1 })
    .addColor(config, 'outlineColor', { label: 'Color', colorMode: 'rgb', onChange: updateOutlineColor });

scenePanel.addGroup({ label: 'Details', enable: false })
    .addCustomComponent(TextureUI, config, 'paperDetail', { label: 'Detail', onChange: changePaperDetailTexture })
    .addCustomComponent(TextureUI, config, 'paperNormalDetail', { label: 'Bump', onChange: changePaperDetailTexture })
    .addNumberInput(config, 'paperNormalScale', { label: 'Bump Scale', onChange: changePaperDetailTexture, step: 0.1, min: 0 });


scenePanel.addGroup({ label: 'Shadow', enable: false })
    .addPad(config, 'shadowDirection', { label: 'Direction', onChange: updateShadow })
    .addNumberInput(config, 'shadowBlurSize', { label: 'Blur Size', onChange: updateShadow, step: 0.5, min: 0 });

let colorGroup = scenePanel.addGroup({ label: 'Colors' });

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