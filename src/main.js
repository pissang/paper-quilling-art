import ClayAdvancedRenderer from 'claygl-advanced-renderer';
import { application, Vector3, util, Shader, Node, Geometry, Mesh, Material } from 'claygl';
import { parse, stringify, lerp } from 'zrender/src/tool/color';
import TextureUI from './ui/Texture';
import * as colorBrewer from 'd3-scale-chromatic';
import {extrudePolyline} from 'geometry-extrude';
import {generateCircle} from './generator/circle';
import {generatePerlin, perlinSeed} from './generator/perlin';
import {extrude} from './extrude';
import debounce from 'lodash.debounce';
import clustering from 'density-clustering';

var brewerMethods = [
    'BrBG', 'PRGn', 'PiYG', 'PuOr', 'RdBu', 'RdGy', 'RdYlBu', 'RdYlGn', 'Spectral',
    'Viridis', 'Inferno', 'Magma', 'Plasma', 'Warm', 'Cool', 'Rainbow', 'YlGnBu', 'RdPu', 'PuRd',
].map(function (a) {
    return 'interpolate' + a;
});
// var brewerMethods = Object.keys(colorBrewer);

// import standardExtCode from './standard_extend.glsl';
// Shader.import(standardExtCode);

var shader = new Shader(Shader.source('clay.standardMR.vertex'), Shader.source('clay.standardMR.fragment'));

function createDefaultConfig() {
    var config = {
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
        cameraDistance: 10,

        baseColor: [150, 150, 150],

        paperDetail: './img/paper-detail.png',
        paperNormalDetail: './img/paper-normal.jpg',

        paperNormalScale: 1.5,

        clusterColors: true,

        colorNumber: 5,

        $colorNumberRange: [1, 10],

        layers: []
    };

    for (let k = 0; k < 10; k++) {
        config.layers.push({
            color: null,
            intensity: 1
        });
    }
    return config;
}

function createRandomColors() {
    var method = colorBrewer[brewerMethods[Math.round(Math.random() * (brewerMethods.length - 1))]];
    config.layers.forEach(function (layer, idx) {
        layer.color = parse(method(1 - idx / 9)).slice(0, 3);
    });
};


function clusterColors(geometryData, colorCount) {
    let points = geometryData.map(item => item.centroid.slice());
    var kmeans = new clustering.KMEANS();
    var clusters = kmeans.run(points, colorCount);

    for (let i = 0; i < clusters.length; i++) {
        for (let k = 0; k < clusters[i].length; k++) {
            geometryData[clusters[i][k]].colorIndex = i;
        }
    }
}


var config = createDefaultConfig();
createRandomColors();

var app = application.create('#main', {

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
                    enable: true
                }
            }
        });
        // TODO
        // this._advancedRenderer._renderMain._compositor._compositeNode.undefine('TONEMAPPING');

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
        app.methods.updateScrollingPapers();
        app.methods.updatePaperColors();
        app.methods.updateBaseColor();
        app.methods.changePaperDetailTexture(app);
    },

    loop() {
        // this._advancedRenderer.render();
    },

    methods: {
        render() {
            this._advancedRenderer.render();
        },

        updateShadow() {
            var x = -config.shadowDirection[0];
            var y = -config.shadowDirection[1];
            var lightDir = new Vector3(x, y, 1).normalize();
            var normal = Vector3.POSITIVE_Z;
            var ndl = Vector3.dot(lightDir, normal);
            this._dirLight.intensity = 0.7 / ndl;

            this._dirLight.position.set(x, y, 1);
            this._dirLight.lookAt(Vector3.ZERO, Vector3.UP);
            this._advancedRenderer.setShadow({
                kernelSize: config.shadowKernelSize,
                blurSize: Math.max(config.shadowBlurSize, 1)
            });
            this._advancedRenderer.render();
        },

        updateCamera() {
            // TODO RESET CAMERA
            var z = config.cameraDistance;
            var x = config.cameraPosition[0] * z;
            var y = config.cameraPosition[1] * z;

            this._camera.position.set(x, y, z);
            this._camera.lookAt(Vector3.ZERO, Vector3.UP);

            this._advancedRenderer.render();
        },

        updateScrollingPapers() {
            if (!this._paperMesh) {
                this._paperMesh = new Mesh({
                    material: new Material({shader})
                });
                this._paperMesh.culling = false;
                this._paperMesh.material.define('fragment', 'DOUBLE_SIDED');
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
                [-11, -11], [11, 11], config.number, config.trail, config.noiseScale
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

        updateColorNumbers() {
            for (var i = 0; i < config.colorNumber; i++) {
                config.layers.push({
                    color: null,
                    intensity: 1
                });
            }
        },

        updatePaperColors() {
            let colors = config.layers.map(layer => layer.color.map(channel => channel / 255));
            // this._scrollingPapers.forEach((mesh, idx) => {
            //     let color = lerp((idx / (this._scrollingPapers.length - 1) * 4) % 1, colors);
            //     mesh.material.set('color', color);
            // });
            if (this._paperMesh) {
                if (config.clusterColors) {
                    clusterColors(this._geometryData, Math.round(config.colorNumber));
                }
                else {
                    this._geometryData.forEach((item, index) => {
                        let colorPercent =  (index / (this._geometryData.length - 1) * 4) % 1;
                        let colorIndex = Math.floor(colorPercent * (Math.round(config.colorNumber) - 1));
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
                    // color[0] /= 255;
                    // color[1] /= 255;
                    // color[2] /= 255;
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
            var self = this;
            function setDetailTexture(detailTexture) {
                self._paperMesh.material.set('roughness', 1);
                self._paperMesh.material.set('diffuseMap', detailTexture);
                self._groundPlane.material.set('roughness', 1);
                self._groundPlane.material.set('diffuseMap', detailTexture);
                self._groundPlane.material.set('uvRepeat', [8, 8]);

                self._advancedRenderer.render();
            }

            function setDetailNormalMap(normalTexture) {
                self._paperMesh.material.set('normalMap', normalTexture);
                self._paperMesh.material.set('normalScale', config.paperNormalScale);
                self._groundPlane.material.set('normalMap', normalTexture);
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

var updateScrollingPapers = debounce(function () {
    app.methods.updateScrollingPapers();
    app.methods.updatePaperColors();
}, 500);

var controlKit = new ControlKit({
    loadAndSave: false,
    useExternalStyle: true
});

var scenePanel = controlKit.addPanel({ label: 'Settings', width: 250 });

scenePanel.addGroup({ label: 'Generate' })
    .addNumberInput(config, 'thickness', { label: 'Thickness', onChange: updateScrollingPapers, step: 0.005, min: 0.01 })
    .addNumberInput(config, 'height', { label: 'Height', onChange: updateScrollingPapers, step: 0.1, min: 0.1 })
    .addNumberInput(config, 'number', { label: 'Number', onChange: updateScrollingPapers, step: 10, min: 50 })
    // .addNumberInput(config, 'trail', { label: 'Trail', onChange: updateScrollingPapers, step: 5, min: 50 })
    .addNumberInput(config, 'noiseScale', { label: 'Noise Scale', onChange: updateScrollingPapers, step: 1, min: 1 })
    .addCheckbox(config, 'clusterColors', { label: 'Cluster Colors', onChange: app.methods.updatePaperColors })
    .addButton('Random', function () {
        config.seed = Math.random();

        updateScrollingPapers();
    });

scenePanel.addGroup({ label: 'Details', enable: false })
    .addCustomComponent(TextureUI, config, 'paperDetail', { label: 'Detail', onChange: app.methods.changePaperDetailTexture })
    .addCustomComponent(TextureUI, config, 'paperNormalDetail', { label: 'Bump', onChange: app.methods.changePaperDetailTexture })
    .addNumberInput(config, 'paperNormalScale', { label: 'Bump Scale', onChange: app.methods.changePaperDetailTexture, step: 0.1, min: 0 });


scenePanel.addGroup({ label: 'Shadow', enable: false })
    .addPad(config, 'shadowDirection', { label: 'Direction', onChange: app.methods.updateShadow })
    .addNumberInput(config, 'shadowBlurSize', { label: 'Blur Size', onChange: app.methods.updateShadow, step: 0.5, min: 0 });

scenePanel.addGroup({ label: 'Camera', enable: false })
    .addPad(config, 'cameraPosition', { label: 'Position', onChange: app.methods.updateCamera })
    .addNumberInput(config, 'cameraDistance', { label: 'Distance', onChange: app.methods.updateCamera, step: 0.5, min: 0 });

var colorGroup = scenePanel.addGroup({ label: 'Colors' });
colorGroup.addColor(config, 'baseColor', { label: 'Base Color', colorMode: 'rgb', onChange: app.methods.updateBaseColor });

colorGroup.addButton('Random Colors', function () {
    createRandomColors();
    app.methods.updatePaperColors();
    controlKit.update();
});
colorGroup.addSlider(config, 'colorNumber', '$colorNumberRange', { label: 'Vary', onFinish: app.methods.updatePaperColors, step: 1});
for (var i = 0; i < config.layers.length; i++) {
    colorGroup.addColor(config.layers[i], 'color', { label: 'Color ' + (i + 1), colorMode: 'rgb', onChange: app.methods.updatePaperColors  });
    // colorGroup.addNumberInput(config.layers[i], 'intensity', { label: 'Intensity', onChange: app.methods.updatePaperColors, step: 0.1, min: 0  });
}
colorGroup.addButton('Revert Colors', function () {
    var colors = config.layers.map(function (layer) {
        return layer.color;
    }).reverse();
    config.layers.forEach(function (layer, idx) {
        layer.color = colors[idx];
    });
    app.methods.updatePaperColors();
    controlKit.update();
});

window.addEventListener('resize', function () { app.resize(); app.methods.render(); } );

document.getElementById('loading').style.display = 'none';