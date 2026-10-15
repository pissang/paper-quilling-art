import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Engine, Render, RenderLoop, THREESync, type DenoiserOptions } from '@meimu/mutracer';
import { MAX_COLORS, type Config, type RGB } from '../config';
import { useConfig, useRenderInfo, useRenderMode, type RenderPhase } from '../store';
import { BOX_SIZE, ORNAMENT_COLOR, PAPER_SLOTS, TINTS, analyzeSource, buildArtwork, type Artwork } from './generate';
import type { Analysis } from './analyze';
import type { Element } from './compose';
import { applyHeight, type StripLayout } from './stripGeometry';

/** Beyond the orbit controls' max distance so the camera never passes a light. */
const LIGHT_DISTANCE = 150;
/** Angular size of the fill and sky lights in degrees. */
const FILL_ANGLE = 50;
const SKY_ANGLE = 100;
const FILL_COLOR: RGB = [196, 214, 255];
const SKY_COLOR: RGB = [236, 241, 255];
const PAPER_UV_SCALE = 1.5;
const GROUND_UV_SCALE = 0.35;
/** Default view angle from straight above, in degrees. */
const CAMERA_TILT = 25;

type Keys = (keyof Config)[];
const ANALYSIS_KEYS: Keys = ['image', 'colorNumber', 'detail', 'removeBackground'];
const BUILD_KEYS: Keys = [
  'seed', 'elementSize', 'minElementSize', 'gap', 'flowers', 'thickness', 'imperfection',
  'coilTurns', 'coilEccentricity', 'tipPull', 'heightJitter',
  'contourLines', 'contourSpacing', 'lineFill', 'ornaments', 'baseCard', 'swirls', 'swirlStrips', 'swirlSize', 'swirlTightness', 'flowSmoothing',
  'edgeSmoothing', 'shadedContours', 'coilFillers'
];
const HEIGHT_KEYS: Keys = ['stripHeight', 'silhouette'];
const VARIATION_KEYS: Keys = ['heightVariation'];
const MATERIAL_KEYS: Keys = [
  'paperRoughness', 'paperTexture', 'bumpScale', 'translucency', 'bevel', 'colorBoost', 'ornamentColor', 'cardTone'
];
const VISIBILITY_KEYS: Keys = ['paperVisible', 'silhouette'];
const GROUND_KEYS: Keys = ['showPlane', 'planeColor', 'planeGloss', 'planeRoughness', 'shadowColor', 'shadowIntensity', 'backgroundColor'];
const LIGHT_KEYS: Keys = ['lightDirection', 'lightIntensity', 'lightSoftness', 'lightColor', 'fillIntensity', 'skyIntensity'];
const DISPLAY_KEYS: Keys = ['exposure', 'toneMapping', 'contrast', 'saturation', 'vignette', 'bloom'];
const RENDER_KEYS: Keys = ['maxSamples', 'bounces', 'denoise', 'liveDenoise'];
const SCALE_KEYS: Keys = ['renderScale'];

function changed(prev: Config | null, next: Config, keys: Keys) {
  return !prev || keys.some(key => prev[key] !== next[key]);
}

function srgbToLinear(rgb: RGB): [number, number, number] {
  return new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace)
    .toArray() as [number, number, number];
}

function setColor(color: THREE.Color, rgb: RGB) {
  color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
}

function createPaperMaterial() {
  return new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
}

export interface ExportOptions {
  width: number;
  height: number;
  samples: number;
  signal?: AbortSignal;
}

export class PaperRenderer {
  readonly canvas: HTMLCanvasElement;
  private engine?: Engine;
  private loop?: RenderLoop;
  private sync?: THREESync;
  private tracerReady?: Promise<void>;
  private traceCanvas?: HTMLCanvasElement;
  private raster: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private lookPass: ShaderPass;
  private exporting = false;
  private rasterLights = new THREE.Group();
  private rasterKey = new THREE.DirectionalLight();
  private rasterFill = new THREE.HemisphereLight();
  private rasterSky = new THREE.DirectionalLight();
  private shadowGround: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;

  /** Z-up group holding the artwork; rotated so Z maps to world Y. */
  private content = new THREE.Group();
  /** Instanced pieces, one batch per prototype and color, and contour strips per color. */
  private paperGroup = new THREE.Group();
  private paperMaterials: THREE.MeshStandardMaterial[] = [];
  private batches: { mesh: THREE.InstancedMesh; elements: Element[] }[] = [];
  private prototypes: THREE.BufferGeometry[] = [];
  private contourMeshes: THREE.Mesh[] = [];
  /** Base card under each region, one material per palette color. */
  private cardMeshes: THREE.Mesh[] = [];
  private cardMaterials: THREE.MeshStandardMaterial[] = [];
  private ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
  // Analytic area lights for path tracing.
  private keyLight = new THREE.RectAreaLight(0xffffff, 1, 1, 1);
  private fillLight = new THREE.RectAreaLight(0xffffff, 1, 1, 1);
  private skyLight = new THREE.RectAreaLight(0xffffff, 1, 1, 1);

  private textureLoader = new THREE.TextureLoader();
  private textures = new Map<string, THREE.Texture>();
  private normalMap: THREE.Texture;

  private config: Config | null = null;
  private analysis: Analysis | null = null;
  private artwork: Artwork | null = null;
  private generation = 0;
  private generateTimer = 0;
  private unsubscribers: (() => void)[] = [];
  private resizeObserver: ResizeObserver;
  /** Viewport size at full screen resolution, in device pixels. */
  private fullSize = { width: 1, height: 1 };
  private disposed = false;

  constructor(private container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewport-canvas';
    container.appendChild(this.canvas);
    this.raster = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.raster.shadowMap.enabled = true;
    this.raster.shadowMap.type = THREE.PCFShadowMap;

    // Scene ----------------------------------------------------------------
    this.content.rotation.x = -Math.PI / 2;
    this.scene.add(this.content);
    this.scene.userData.mutracerHiddenBackground = true;

    for (let i = 0; i < PAPER_SLOTS; i++) {
      this.paperMaterials.push(createPaperMaterial());
    }
    for (let i = 0; i < MAX_COLORS; i++) {
      this.cardMaterials.push(createPaperMaterial());
    }
    this.content.add(this.paperGroup);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(BOX_SIZE * 2, BOX_SIZE * 2),
      // Matte paper under a clear coat, like a varnished or laminated board.
      new THREE.MeshPhysicalMaterial({ roughness: 0.9 })
    );
    this.ground.receiveShadow = true;
    this.content.add(this.ground);
    this.shadowGround = new THREE.Mesh(this.ground.geometry, new THREE.ShadowMaterial());
    this.shadowGround.scale.setScalar(4);
    this.shadowGround.receiveShadow = true;
    this.content.add(this.shadowGround);

    this.rasterKey.castShadow = true;
    this.rasterKey.shadow.mapSize.set(2048, 2048);
    const shadowCamera = this.rasterKey.shadow.camera;
    shadowCamera.left = shadowCamera.bottom = -BOX_SIZE * 1.5;
    shadowCamera.right = shadowCamera.top = BOX_SIZE * 1.5;
    shadowCamera.far = LIGHT_DISTANCE * 2;
    this.rasterKey.shadow.normalBias = 0.015;
    this.rasterLights.add(this.rasterKey, this.rasterFill, this.rasterSky);
    this.scene.add(this.rasterLights);

    this.scene.add(this.keyLight, this.fillLight, this.skyLight);

    this.normalMap = this.textureLoader.load('./img/paper-normal.jpg');

    // Camera ---------------------------------------------------------------
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    // Standard orbit controls: left drag orbits, right drag pans, wheel zooms.
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 120;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;

    const previewTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: Math.min(4, this.raster.capabilities.maxSamples)
    });
    this.composer = new EffectComposer(this.raster, previewTarget);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, 0.4, 0.9);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.lookPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        contrast: { value: 1 },
        saturation: { value: 1 },
        vignette: { value: 0 }
      },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse;
        uniform float contrast, saturation, vignette;
        varying vec2 vUv;
        void main() {
          vec4 pixel = texture2D(tDiffuse, vUv);
          float luminance = dot(pixel.rgb, vec3(0.2126, 0.7152, 0.0722));
          vec3 color = mix(vec3(luminance), pixel.rgb, saturation);
          color = (color - 0.5) * contrast + 0.5;
          vec2 edge = (vUv - 0.5) * 2.0;
          color *= 1.0 - vignette * smoothstep(0.25, 1.4, length(edge));
          gl_FragColor = vec4(color, pixel.a);
        }`
    });
    this.composer.addPass(this.lookPass);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.camera.fov = useConfig.getState().config.fov;
    this.resetCamera();

    // Config ---------------------------------------------------------------
    this.applyConfig(useConfig.getState().config);
    this.unsubscribers.push(useConfig.subscribe(state => this.applyConfig(state.config)));

    this.unsubscribers.push(useRenderMode.subscribe(() => { void this.updateMode(); }));
    void this.updateMode();
  }

  private isTracing() {
    return useRenderMode.getState().mode === 'pathtracing';
  }

  /** Keep one camera and scene while each backend owns its own canvas/context. */
  private async updateMode() {
    this.loop?.stop();
    this.raster.setAnimationLoop(null);
    const tracing = this.isTracing();
    // The transparent Three.js canvas remains the pointer surface in both modes.
    this.canvas.style.opacity = tracing ? '0' : '1';
    if (this.traceCanvas) this.traceCanvas.style.visibility = tracing ? 'visible' : 'hidden';
    this.updateLight();
    this.updateGround();
    if (!tracing) {
      useRenderInfo.setState({ phase: 'realtime', samples: 0, backend: 'webgl', error: undefined });
      this.raster.setAnimationLoop(() => {
        if (!this.exporting && !document.hidden) {
          this.controls.update();
          this.composer.render();
        }
      });
      return;
    }
    useRenderInfo.setState({ phase: 'preparing', samples: 0, backend: '', error: undefined });
    try {
      await this.ensureTracer();
      if (this.disposed || !this.isTracing() || this.exporting) return;
      useRenderInfo.setState({
        phase: this.loop!.status as RenderPhase,
        samples: this.loop!.samples,
        backend: this.engine!.info?.backend ?? '',
        adapter: this.engine!.info?.adapterName ?? ''
      });
      this.loop!.start();
    }
    catch (error) {
      if (!this.disposed && this.isTracing()) {
        useRenderInfo.setState({ phase: 'error', error: String((error as Error)?.message ?? error) });
      }
    }
  }

  private ensureTracer() {
    if (!this.tracerReady) {
      this.traceCanvas = document.createElement('canvas');
      this.traceCanvas.className = 'viewport-canvas viewport-trace-canvas';
      this.traceCanvas.style.visibility = this.isTracing() ? 'visible' : 'hidden';
      this.container.appendChild(this.traceCanvas);
      const backend = new URLSearchParams(location.search).has('webgl') ? 'webgl' : 'auto';
      const engine = this.engine = new Engine({ canvas: this.traceCanvas, backend });
      this.sync = new THREESync(engine, { scene: this.scene, camera: this.camera, controls: this.controls });
      this.loop = new RenderLoop(engine, { sync: this.sync, final: { maxSamples: 512, bounces: 5 } });
      this.bindStatus();
      this.resize();
      this.updateDisplay();
      this.updateGround();
      this.updateRenderSettings();
      this.tracerReady = engine.init().then(() => {
        if (!this.disposed) this.updateDenoiser();
      });
    }
    return this.tracerReady;
  }

  private bindStatus() {
    const info = useRenderInfo;
    const loop = this.loop!;
    const engine = this.engine!;
    this.unsubscribers.push(
      loop.on('status', ({ status }) => {
        if (this.isTracing() && !this.disposed) info.setState({ phase: status as RenderPhase, samples: loop.samples });
      }),
      loop.on('sample', ({ samples }) => {
        if (this.isTracing() && !this.disposed) info.setState({ samples });
      }),
      engine.on('error', error => {
        console.error(error);
        if (this.isTracing() && !this.disposed) info.setState({ phase: 'error', error: error.message });
      })
    );
  }

  private resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) {
      return;
    }
    const ratio = Math.min(window.devicePixelRatio, 2);
    this.fullSize = { width: Math.round(width * ratio), height: Math.round(height * ratio) };
    // The viewport traces at a fraction of the screen resolution; exports use the full size.
    const scale = this.config?.renderScale ?? 1;
    this.raster.setSize(this.fullSize.width, this.fullSize.height, false);
    this.composer.setSize(this.fullSize.width, this.fullSize.height);
    this.engine?.display.setSize(
      Math.max(1, Math.round(this.fullSize.width * scale)),
      Math.max(1, Math.round(this.fullSize.height * scale))
    );
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Slightly tilted view that fits the whole board, so the strip walls show. */
  resetCamera() {
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const fitSize = BOX_SIZE * 1.08;
    const distance = fitSize / (tanHalf * Math.min(this.camera.aspect, 1)) + 1;
    const tilt = THREE.MathUtils.degToRad(CAMERA_TILT);
    this.camera.position.set(0, distance * Math.cos(tilt), distance * Math.sin(tilt));
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  // Config application -------------------------------------------------------

  private applyConfig(next: Config) {
    const prev = this.config;
    if (prev === next || this.disposed) {
      return;
    }
    this.config = next;

    if (changed(prev, next, ANALYSIS_KEYS)) {
      this.scheduleGenerate(true, prev !== null);
    }
    else if (changed(prev, next, BUILD_KEYS)) {
      this.scheduleGenerate(false, true);
    }
    else {
      if (changed(prev, next, HEIGHT_KEYS)) {
        this.updateStripHeight();
      }
      if (changed(prev, next, VARIATION_KEYS)) {
        this.updateMatrices();
      }
    }
    if (changed(prev, next, MATERIAL_KEYS)) {
      this.updateMaterials();
    }
    if (changed(prev, next, VISIBILITY_KEYS)) {
      this.updateVisibility();
    }
    if (changed(prev, next, GROUND_KEYS)) {
      this.updateGround();
    }
    if (changed(prev, next, LIGHT_KEYS)) {
      this.updateLight();
    }
    if (changed(prev, next, DISPLAY_KEYS)) {
      this.updateDisplay();
    }
    if (changed(prev, next, RENDER_KEYS)) {
      this.updateRenderSettings();
    }
    if (changed(prev, next, SCALE_KEYS)) {
      this.resize();
    }
    if (!prev || prev.spinAngle !== next.spinAngle) {
      this.content.rotation.z = next.spinAngle;
    }
    if (!prev || prev.fov !== next.fov) {
      this.camera.fov = next.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private scheduleGenerate(reanalyze: boolean, debounce: boolean) {
    clearTimeout(this.generateTimer);
    useRenderInfo.setState({ generating: true });
    this.generateTimer = window.setTimeout(() => this.generate(reanalyze), debounce ? 250 : 0);
  }

  private async generate(reanalyze: boolean) {
    const token = ++this.generation;
    try {
      // Let the "generating" indicator paint before the synchronous work.
      // rAF does not fire in background tabs, so race it with a timer.
      await new Promise(resolve => {
        requestAnimationFrame(resolve);
        setTimeout(resolve, 50);
      });
      if (token !== this.generation) {
        return;
      }
      if (reanalyze || !this.analysis) {
        const config = this.config!;
        const resolution = Math.round(config.detail);
        const analysis = await analyzeSource(config.image, {
          colors: Math.min(Math.max(Math.round(config.colorNumber), 2), MAX_COLORS),
          resolution,
          // Specks smaller than a small piece of paper merge into their neighbours.
          minRegion: Math.max(6, Math.round((resolution / 60) ** 2)),
          removeBackground: config.removeBackground
        });
        if (token !== this.generation) {
          return;
        }
        this.analysis = analysis;
      }
      const config = this.config!;
      this.artwork = buildArtwork(this.analysis, {
        seed: config.seed,
        size: config.elementSize,
        minSize: config.minElementSize,
        gap: config.gap,
        flowers: config.flowers,
        turns: config.coilTurns,
        eccentricity: config.coilEccentricity,
        tipPull: config.tipPull,
        heightJitter: config.heightJitter,
        thickness: config.thickness,
        imperfection: config.imperfection,
        contourLines: config.contourLines,
        contourSpacing: config.contourSpacing,
        lineFill: config.lineFill,
        ornaments: config.ornaments,
        baseCard: config.baseCard,
        edgeSmoothing: config.edgeSmoothing,
        shadedContours: config.shadedContours,
        coilFillers: config.coilFillers,
        swirls: config.swirls,
        swirlStrips: config.swirlStrips,
        swirlSize: config.swirlSize,
        swirlTightness: config.swirlTightness,
        flowSmoothing: config.flowSmoothing,
        // Always built; a zero height hides it without a rebuild.
        silhouette: true
      });
      useRenderInfo.setState({ palette: this.artwork.palette });
      this.updateMaterials();
      this.buildMeshes();
    }
    catch (e) {
      console.error('Failed to generate papers', e);
    }
    finally {
      if (token === this.generation) {
        useRenderInfo.setState({ generating: false });
      }
    }
  }

  /** `relative` scales the strip height, e.g. for the taller silhouette strip. */
  private layoutGeometry(layout: StripLayout & { normal: Float32Array; indices: Uint32Array }, relative?: () => number) {
    const geometry = new THREE.BufferGeometry();
    const height = this.config!.stripHeight * (relative ? relative() : 1);
    geometry.setAttribute('position', new THREE.BufferAttribute(applyHeight(layout, height), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(layout.normal, 3));
    geometry.setIndex(new THREE.BufferAttribute(layout.indices, 1));
    geometry.userData.layout = layout;
    geometry.userData.relative = relative;
    return geometry;
  }

  /** Rebuilds the instanced batches and contour meshes from the artwork. */
  private buildMeshes() {
    for (const { mesh } of this.batches) {
      this.paperGroup.remove(mesh);
      mesh.dispose();
    }
    for (const mesh of [...this.contourMeshes, ...this.cardMeshes]) {
      this.paperGroup.remove(mesh);
      mesh.geometry.dispose();
    }
    this.prototypes.forEach(geometry => geometry.dispose());
    this.batches = [];
    this.contourMeshes = [];
    this.cardMeshes = [];
    const artwork = this.artwork;
    if (!artwork) {
      return;
    }

    this.prototypes = artwork.prototypes.map(mesh => this.layoutGeometry(mesh));
    const buckets = new Map<number, Element[]>();
    for (const element of artwork.elements) {
      const key = element.prototype * PAPER_SLOTS + element.color;
      let list = buckets.get(key);
      if (!list) {
        buckets.set(key, list = []);
      }
      list.push(element);
    }
    for (const [key, elements] of buckets) {
      const geometry = this.prototypes[Math.floor(key / PAPER_SLOTS)];
      const mesh = new THREE.InstancedMesh(geometry, this.paperMaterials[key % PAPER_SLOTS], elements.length);
      this.batches.push({ mesh, elements });
      this.paperGroup.add(mesh);
    }

    let triangleCount = 0;
    for (const geometry of this.prototypes) {
      triangleCount += geometry.index!.count / 3;
    }
    artwork.contours.forEach((layout, color) => {
      if (layout) {
        const mesh = new THREE.Mesh(this.layoutGeometry(layout), this.paperMaterials[color]);
        mesh.userData.level = artwork.levels[color % MAX_COLORS];
        this.contourMeshes.push(mesh);
        this.paperGroup.add(mesh);
        triangleCount += layout.indices.length / 3;
      }
    });
    artwork.cards.forEach((card, color) => {
      if (card) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(card.position, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(card.normal, 3));
        geometry.setIndex(new THREE.BufferAttribute(card.indices, 1));
        const mesh = new THREE.Mesh(geometry, this.cardMaterials[color]);
        this.cardMeshes.push(mesh);
        this.paperGroup.add(mesh);
        triangleCount += card.indices.length / 3;
      }
    });
    this.updateMatrices();
    if (artwork.silhouette) {
      const geometry = this.layoutGeometry(artwork.silhouette, () => this.config!.silhouette);
      const mesh = new THREE.Mesh(geometry, this.paperMaterials[ORNAMENT_COLOR]);
      this.contourMeshes.push(mesh);
      this.paperGroup.add(mesh);
      triangleCount += artwork.silhouette.indices.length / 3;
    }
    this.paperGroup.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    useRenderInfo.setState({ paperCount: artwork.elements.length, triangleCount });
    this.updateVisibility();
  }

  private updateMatrices() {
    const variation = this.config!.heightVariation;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 0, 1);
    for (const { mesh, elements } of this.batches) {
      elements.forEach((e, i) => {
        position.set(e.x, e.y, 0);
        rotation.setFromAxisAngle(axis, e.rotation);
        scale.set(e.scale, e.scale, Math.max(1 + variation * e.height, 0.2));
        mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    // Contour strips follow their region's height level.
    for (const mesh of this.contourMeshes) {
      const level: number | undefined = mesh.userData.level;
      mesh.scale.z = level === undefined ? 1 : Math.max(1 + variation * level * 0.7, 0.2);
    }
  }

  private updateStripHeight() {
    const height = this.config!.stripHeight;
    const geometries = [...this.prototypes, ...this.contourMeshes.map(mesh => mesh.geometry)];
    for (const geometry of geometries) {
      const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
      const relative: (() => number) | undefined = geometry.userData.relative;
      applyHeight(geometry.userData.layout, height * (relative ? relative() : 1), attr.array as Float32Array);
      attr.needsUpdate = true;
      geometry.computeBoundingSphere();
    }
    for (const { mesh } of this.batches) mesh.computeBoundingSphere();
  }

  private updateVisibility() {
    this.paperGroup.visible = this.config!.paperVisible;
    for (const mesh of this.contourMeshes) {
      if (mesh.geometry.userData.relative) {
        mesh.visible = this.config!.silhouette > 0;
      }
    }
  }

  private getTexture(url: string) {
    let texture = this.textures.get(url);
    if (!texture) {
      texture = this.textureLoader.load(url);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      this.textures.set(url, texture);
    }
    return texture;
  }

  private updateMaterials() {
    const config = this.config!;
    const map = config.paperTexture ? this.getTexture(config.paperTexture) : null;
    const setup = (material: THREE.MeshStandardMaterial, color: RGB, uvScale: number) => {
      setColor(material.color, color);
      material.roughness = config.paperRoughness;
      material.map = map;
      material.normalMap = config.bumpScale > 0 ? this.normalMap : null;
      material.normalScale.set(config.bumpScale, config.bumpScale);
      material.userData = {
        mutracerUvProjection: 'triplanar',
        mutracerUvProjectionScale: [uvScale, uvScale],
        mutracerBevelSize: config.bevel,
        mutracerOpenPBR: {
          subsurfaceWeight: config.translucency,
          subsurfaceColor: srgbToLinear(color),
          subsurfaceRadius: 0.05
        }
      };
      // userData is not tracked by Three.js; bump the version so the
      // MuTracer conversion picks up the new renderer specific settings.
      material.needsUpdate = true;
    };
    const palette = this.artwork?.palette ?? [];
    const hsl = { h: 0, s: 0, l: 0 };
    this.paperMaterials.forEach((material, idx) => {
      if (idx === ORNAMENT_COLOR) {
        setup(material, config.ornamentColor, PAPER_UV_SCALE);
        return;
      }
      // Colored paper is usually more saturated than a photo of the subject.
      const base = idx % MAX_COLORS;
      const tint = TINTS[Math.floor(idx / MAX_COLORS)];
      const [r, g, b] = palette[base] ?? [200, 200, 200];
      const color = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      color.getHSL(hsl, THREE.SRGBColorSpace);
      color.setHSL(hsl.h, Math.min(1, hsl.s * config.colorBoost), hsl.l, THREE.SRGBColorSpace);
      const srgb = { r: 0, g: 0, b: 0 };
      color.getRGB(srgb, THREE.SRGBColorSpace);
      // Pale stock of the same hue, mixed towards white.
      const paper = [srgb.r, srgb.g, srgb.b].map(v => (v + (1 - v) * tint) * 255) as RGB;
      setup(material, paper, PAPER_UV_SCALE);
      if (idx < MAX_COLORS) {
        // The base card is a darker or lighter stock of the same hue.
        const tone = config.cardTone;
        const card = paper.map(c => (tone < 0 ? c * (1 + tone) : c + (255 - c) * tone)) as RGB;
        setup(this.cardMaterials[idx], card, PAPER_UV_SCALE);
        // A flat card does not glow through like a strip on edge.
        this.cardMaterials[idx].userData.mutracerOpenPBR.subsurfaceWeight = 0;
      }
    });
  }

  private updateGround() {
    const config = this.config!;
    const material = this.ground.material;
    setColor(material.color, config.planeColor);
    material.clearcoat = config.planeGloss;
    material.clearcoatRoughness = config.planeRoughness;
    material.map = config.paperTexture ? this.getTexture(config.paperTexture) : null;
    material.userData = {
      mutracerShadowCatcher: !config.showPlane,
      mutracerUvProjection: 'triplanar',
      mutracerUvProjectionScale: [GROUND_UV_SCALE, GROUND_UV_SCALE],
      // A denser coat than Three.js' default reflects more at normal incidence.
      mutracerOpenPBR: { coatIor: 1.5 + config.planeGloss * 0.4 }
    };
    material.needsUpdate = true;
    // The catcher covers the whole frame so shadows are never clipped.
    this.ground.scale.setScalar(config.showPlane ? 1 : 4);

    const tracing = this.isTracing() || this.exporting;
    this.ground.visible = tracing || config.showPlane;
    this.shadowGround.visible = !tracing && !config.showPlane;
    setColor(this.shadowGround.material.color, config.shadowColor);
    this.shadowGround.material.opacity = config.shadowIntensity;
    this.rasterKey.shadow.intensity = config.shadowIntensity;
    if (this.engine) Object.assign(this.engine.display, {
      shadowCatcherColor: srgbToLinear(config.shadowColor),
      shadowCatcherAlpha: config.shadowIntensity
    });
    this.container.style.backgroundColor = `rgb(${config.backgroundColor.join(',')})`;
  }

  /**
   * Places a square area light at `direction`, sized to `angle` degrees as seen
   * from the artwork, with radiance chosen so its irradiance is `irradiance`.
   */
  private placeLight(light: THREE.RectAreaLight, direction: THREE.Vector3, angle: number,
    irradiance: number, color: RGB) {
    const dir = direction.clone().normalize();
    light.position.copy(dir).multiplyScalar(LIGHT_DISTANCE);
    light.lookAt(0, 0, 0);
    const halfTan = Math.tan(THREE.MathUtils.degToRad(angle) / 2);
    light.width = light.height = 2 * LIGHT_DISTANCE * halfTan;
    // Irradiance at the centre of a facing square emitter of radiance L is
    // E = 4L·t·atan(t) with t = tanHalf / sqrt(1 + tanHalf²), which reduces to
    // L·A/d² for small lights but stays exact for the wide sky panel.
    const t = halfTan / Math.sqrt(1 + halfTan * halfTan);
    light.intensity = irradiance / (4 * t * Math.atan(t));
    setColor(light.color, color);
    light.visible = irradiance > 0;
  }

  private updateLight() {
    const config = this.config!;
    const [dx, dy] = config.lightDirection;
    // The key light sits above (dx, dy) of the artwork, whose Y axis maps to world -Z.
    const key = new THREE.Vector3(dx, 1, -dy);
    this.placeLight(this.keyLight, key, Math.max(config.lightSoftness, 0.2), config.lightIntensity, config.lightColor);

    // Fill comes low from the opposite side to lift the shadow side of the strips.
    const horizontal = new THREE.Vector3(-dx, 0, dy);
    if (horizontal.lengthSq() < 1e-4) {
      horizontal.set(1, 0, 1);
    }
    horizontal.normalize();
    this.placeLight(this.fillLight, horizontal.setY(0.8), FILL_ANGLE, config.fillIntensity, FILL_COLOR);

    // A broad overhead panel stands in for skylight; nudged off the pole so lookAt stays stable.
    this.placeLight(this.skyLight, new THREE.Vector3(0.001, 1, 0.001), SKY_ANGLE, config.skyIntensity, SKY_COLOR);

    const tracing = this.isTracing() || this.exporting;
    this.keyLight.visible &&= tracing;
    this.fillLight.visible &&= tracing;
    this.skyLight.visible &&= tracing;
    this.rasterLights.visible = !tracing;
    this.rasterKey.position.copy(this.keyLight.position);
    this.rasterKey.color.copy(this.keyLight.color);
    this.rasterKey.intensity = config.lightIntensity;
    this.rasterKey.shadow.radius = Math.max(1, config.lightSoftness / 8);
    setColor(this.rasterFill.color, FILL_COLOR);
    this.rasterFill.groundColor.setRGB(0.18, 0.16, 0.14);
    this.rasterFill.intensity = config.fillIntensity;
    this.rasterSky.position.copy(this.skyLight.position);
    setColor(this.rasterSky.color, SKY_COLOR);
    this.rasterSky.intensity = config.skyIntensity;
  }

  private updateDisplay() {
    const config = this.config!;
    const toneMapping = {
      agx: THREE.AgXToneMapping,
      aces: THREE.ACESFilmicToneMapping,
      cineon: THREE.CineonToneMapping,
      reinhard: THREE.ReinhardToneMapping,
      linear: THREE.LinearToneMapping
    };
    this.raster.toneMapping = toneMapping[config.toneMapping];
    this.raster.toneMappingExposure = config.exposure;
    this.lookPass.uniforms.contrast.value = config.contrast;
    this.lookPass.uniforms.saturation.value = config.saturation;
    this.lookPass.uniforms.vignette.value = config.vignette;
    this.bloomPass.strength = config.bloom;
    this.bloomPass.enabled = config.bloom > 0;
    if (this.engine) Object.assign(this.engine.display, {
      toneMapping: config.toneMapping,
      toneMappingExposure: config.exposure,
      contrast: config.contrast,
      saturation: config.saturation,
      vignette: config.vignette,
      bloomIntensity: config.bloom
    });
  }

  private updateRenderSettings() {
    const config = this.config!;
    if (this.loop) Object.assign(this.loop.final, {
      maxSamples: config.maxSamples,
      bounces: config.bounces
    });
    useRenderInfo.setState({ maxSamples: config.maxSamples });
    this.updateDenoiser();
  }

  /**
   * OIDN on WebGPU (OIDN is unavailable on WebGL 2, which falls back to JNLM).
   * Live mode filters the final image progressively while it converges and
   * every preview sample with the small network while interacting.
   */
  private denoiserOptions(target: 'final' | 'preview' | 'export'): DenoiserOptions | null {
    const { denoise, liveDenoise } = this.config!;
    if (!denoise || (target === 'preview' && !liveDenoise)) {
      return null;
    }
    const schedule = target === 'preview' ? 'every-sample'
      : target === 'final' && liveDenoise ? 'progressive'
        : 'converged';
    return this.engine?.backend === 'webgpu'
      ? { type: 'oidn', model: target === 'preview' ? 'small' : 'standard', schedule }
      : { type: 'jnlm', schedule };
  }

  private updateDenoiser() {
    // The backend is only known after initialisation.
    if (!this.engine?.info || !this.loop || this.disposed) {
      return;
    }
    const { final, preview } = this.loop;
    const apply = (render: Render, options: DenoiserOptions | null) => {
      render.setDenoiser(options).catch(error => {
        console.warn('OIDN unavailable, falling back to JNLM', error);
        render.setDenoiser(options && { type: 'jnlm', schedule: options.schedule });
      });
    };
    apply(final, this.denoiserOptions('final'));
    if (preview) {
      apply(preview, this.denoiserOptions('preview'));
    }
    // Hold scene commits while preview inference runs so the denoised
    // preview keeps up with continuous camera movement.
    this.loop.coalesceSceneUpdates = !!preview && this.config!.denoise && this.config!.liveDenoise;
  }

  // Output -------------------------------------------------------------------

  /** Composites a rendered (transparent) image over the background color. */
  private async composite(blob: Blob) {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = `rgb(${this.config!.backgroundColor.join(',')})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Failed to encode PNG')), 'image/png');
    });
  }

  /** The current view at full resolution, with the viewport's sample count. */
  async snapshot() {
    if (this.isTracing()) {
      return this.renderImage({ ...this.fullSize, samples: this.config!.maxSamples });
    }
    this.composer.render();
    const blob = await new Promise<Blob>((resolve, reject) => {
      this.canvas.toBlob(value => value ? resolve(value) : reject(new Error('Failed to encode PNG')), 'image/png');
    });
    return this.composite(blob);
  }

  /** Renders a fixed size image offline with the current camera. */
  async renderImage({ width, height, samples, signal }: ExportOptions) {
    if (this.exporting) throw new Error('A render is already in progress');
    if (signal?.aborted) throw new DOMException('Render cancelled', 'AbortError');
    this.exporting = true;
    this.controls.enabled = false;
    useRenderInfo.setState({ offline: { samples: 0, target: samples, stage: 'preparing' } });
    let render: Render | undefined;
    try {
      await this.ensureTracer();
      if (this.disposed || signal?.aborted) throw new DOMException('Render cancelled', 'AbortError');
      const engine = this.engine!;
      this.loop!.stop();
      this.updateLight();
      this.updateGround();
      const config = this.config!;
      const output = render = new Render(engine, {
        width,
        height,
        bounces: config.bounces,
        maxSamples: samples
      });
      const denoiser = this.denoiserOptions('export');
      if (denoiser) {
        await output.setDenoiser(denoiser).catch(() => output.setDenoiser({ type: 'jnlm' }));
      }
      this.sync!.update();
      engine.update();
      await render.converge({
        samples,
        samplesPerBatch: 4,
        signal,
        onProgress: ({ stage, samples: done, targetSamples }) => {
          useRenderInfo.setState({ offline: { samples: done, target: targetSamples, stage } });
        }
      });
      return await this.composite(await engine.display.toBlob(render));
    }
    finally {
      render?.dispose();
      this.exporting = false;
      this.controls.enabled = true;
      if (!this.disposed) void this.updateMode();
      useRenderInfo.setState({ offline: undefined });
    }
  }

  /** Full resolution size of the viewport, whatever it traces at. */
  get viewportSize() {
    return { ...this.fullSize };
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    clearTimeout(this.generateTimer);
    this.unsubscribers.forEach(fn => fn());
    this.resizeObserver.disconnect();
    this.raster.setAnimationLoop(null);
    this.loop?.dispose();
    this.sync?.dispose();
    this.controls.dispose();
    this.engine?.dispose();
    this.composer.passes.forEach(pass => pass.dispose());
    this.composer.dispose();
    this.raster.dispose();
    this.rasterKey.shadow.dispose();
    this.paperGroup.traverse(object => {
      if (object instanceof THREE.Mesh && !(object instanceof THREE.InstancedMesh)) object.geometry.dispose();
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    this.prototypes.forEach(geometry => geometry.dispose());
    [...this.paperMaterials, ...this.cardMaterials].forEach(material => material.dispose());
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.shadowGround.material.dispose();
    this.normalMap.dispose();
    this.textures.forEach(texture => texture.dispose());
    this.traceCanvas?.remove();
    this.canvas.remove();
  }
}
