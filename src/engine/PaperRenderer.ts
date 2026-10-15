import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Engine, Render, RenderLoop, THREESync, type DenoiserOptions } from '@meimu/mutracer';
import { MAX_COLORS, type Config, type RGB } from '../config';
import { useConfig, useRenderInfo, type RenderPhase } from '../store';
import {
  BOX_SIZE, assignColors, createMask, generateStrips, groupHeights, mergeStrips, setExtrudeHeight,
  type Mask, type Strip
} from './generate';
import { extrudePolyline } from 'geometry-extrude';

/** Beyond the orbit controls' max distance so the camera never passes a light. */
const LIGHT_DISTANCE = 150;
/** Angular size of the fill and sky lights in degrees. */
const FILL_ANGLE = 50;
const SKY_ANGLE = 100;
const FILL_COLOR: RGB = [196, 214, 255];
const SKY_COLOR: RGB = [236, 241, 255];
const PAPER_UV_SCALE = 1.5;
const GROUND_UV_SCALE = 0.35;

type Keys = (keyof Config)[];
const MASK_KEYS: Keys = ['maskText', 'maskTextFont', 'maskTextSize', 'maskImage'];
const STRIP_KEYS: Keys = ['seed', 'number', 'trail', 'noiseScale', 'thickness'];
const GROUP_KEYS: Keys = ['colorNumber', 'clusterColors'];
const HEIGHT_KEYS: Keys = ['minHeight', 'maxHeight'];
const OUTLINE_GEOMETRY_KEYS: Keys = ['outlineThickness', 'outlineHeight'];
const MATERIAL_KEYS: Keys = ['paperRoughness', 'paperTexture', 'bumpScale', 'translucency', 'bevel', 'colors', 'outlineColor'];
const VISIBILITY_KEYS: Keys = ['paperVisible', 'outlineVisible'];
const GROUND_KEYS: Keys = ['showPlane', 'planeColor', 'shadowColor', 'shadowIntensity', 'backgroundColor'];
const LIGHT_KEYS: Keys = ['lightDirection', 'lightIntensity', 'lightSoftness', 'lightColor', 'fillIntensity', 'skyIntensity'];
const DISPLAY_KEYS: Keys = ['exposure', 'toneMapping', 'contrast', 'saturation', 'vignette', 'bloom'];
const RENDER_KEYS: Keys = ['maxSamples', 'bounces', 'denoise', 'liveDenoise'];

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
  private engine: Engine;
  private loop: RenderLoop;
  private sync: THREESync;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;

  /** Z-up group holding the artwork; rotated so Z maps to world Y. */
  private content = new THREE.Group();
  private paperMeshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  private outlineMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  // Analytic area lights only: no environment map or ambient term.
  private keyLight = new THREE.RectAreaLight(0xffffff, 1, 1, 1);
  private fillLight = new THREE.RectAreaLight(0xffffff, 1, 1, 1);
  private skyLight = new THREE.RectAreaLight(0xffffff, 1, 1, 1);

  private textureLoader = new THREE.TextureLoader();
  private textures = new Map<string, THREE.Texture>();
  private normalMap: THREE.Texture;

  private config: Config | null = null;
  private mask: Mask | null = null;
  private strips: Strip[] = [];
  private colorIndices: Uint8Array = new Uint8Array(0);
  private generation = 0;
  private generateTimer = 0;
  private unsubscribers: (() => void)[] = [];
  private resizeObserver: ResizeObserver;
  private disposed = false;

  constructor(private container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewport-canvas';
    container.appendChild(this.canvas);

    // Scene ----------------------------------------------------------------
    this.content.rotation.x = -Math.PI / 2;
    this.scene.add(this.content);
    this.scene.userData.mutracerHiddenBackground = true;

    for (let i = 0; i < MAX_COLORS; i++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), createPaperMaterial());
      mesh.visible = false;
      this.paperMeshes.push(mesh);
      this.content.add(mesh);
    }
    this.outlineMesh = new THREE.Mesh(new THREE.BufferGeometry(), createPaperMaterial());
    this.outlineMesh.visible = false;
    this.content.add(this.outlineMesh);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(BOX_SIZE * 2, BOX_SIZE * 2),
      new THREE.MeshStandardMaterial({ roughness: 0.9 })
    );
    this.content.add(this.ground);

    this.scene.add(this.keyLight, this.fillLight, this.skyLight);

    this.normalMap = this.textureLoader.load('./img/paper-normal.jpg');

    // Camera ---------------------------------------------------------------
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 120;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;

    // MuTracer -------------------------------------------------------------
    const backend = new URLSearchParams(location.search).has('webgl') ? 'webgl' : 'auto';
    this.engine = new Engine({ canvas: this.canvas, backend });
    this.sync = new THREESync(this.engine, {
      scene: this.scene,
      camera: this.camera,
      controls: this.controls
    });
    this.loop = new RenderLoop(this.engine, {
      sync: this.sync,
      final: { maxSamples: 512, bounces: 5 }
    });

    this.bindStatus();
    this.bindSpin();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.camera.fov = useConfig.getState().config.fov;
    this.resetCamera();

    // Config ---------------------------------------------------------------
    this.applyConfig(useConfig.getState().config);
    this.unsubscribers.push(useConfig.subscribe(state => this.applyConfig(state.config)));

    this.loop.start();
  }

  private bindStatus() {
    const info = useRenderInfo;
    this.unsubscribers.push(
      this.loop.on('status', ({ status }) => {
        info.setState({ phase: status as RenderPhase, samples: this.loop.samples });
      }),
      this.loop.on('sample', ({ samples }) => {
        info.setState({ samples });
      }),
      this.engine.on('error', error => {
        console.error(error);
        info.setState({ phase: 'error', error: error.message });
      })
    );
    this.engine.init().then(() => {
      const engineInfo = this.engine.info;
      info.setState({
        backend: engineInfo?.backend ?? this.engine.backend ?? '',
        adapter: engineInfo?.adapterName ?? ''
      });
      this.updateDenoiser();
    }).catch(error => {
      info.setState({ phase: 'error', error: String(error?.message ?? error) });
    });
  }

  /** Right mouse drag spins the artwork around its vertical axis. */
  private bindSpin() {
    let spinning = false;
    let prevX = 0;
    let angle = 0;
    const onDown = (e: PointerEvent) => {
      if (e.button === 2) {
        spinning = true;
        prevX = e.clientX;
        angle = useConfig.getState().config.spinAngle;
        this.canvas.setPointerCapture(e.pointerId);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (spinning) {
        angle += (e.clientX - prevX) / 200;
        prevX = e.clientX;
        // Wrap to [-PI, PI] so the UI slider stays in range.
        angle = Math.atan2(Math.sin(angle), Math.cos(angle));
        useConfig.getState().set({ spinAngle: angle });
      }
    };
    const onUp = () => { spinning = false; };
    const onContextMenu = (e: Event) => e.preventDefault();
    this.canvas.addEventListener('pointerdown', onDown);
    this.canvas.addEventListener('pointermove', onMove);
    this.canvas.addEventListener('pointerup', onUp);
    this.canvas.addEventListener('contextmenu', onContextMenu);
    this.unsubscribers.push(() => {
      this.canvas.removeEventListener('pointerdown', onDown);
      this.canvas.removeEventListener('pointermove', onMove);
      this.canvas.removeEventListener('pointerup', onUp);
      this.canvas.removeEventListener('contextmenu', onContextMenu);
    });
  }

  private resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) {
      return;
    }
    const ratio = Math.min(window.devicePixelRatio, 2);
    this.engine.display.setSize(Math.round(width * ratio), Math.round(height * ratio));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Top view that fits the whole board in the viewport. */
  resetCamera() {
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const fitSize = BOX_SIZE * 1.08;
    const distance = fitSize / (tanHalf * Math.min(this.camera.aspect, 1)) + 1;
    this.camera.position.set(0, distance, 0.01);
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

    if (changed(prev, next, MASK_KEYS)) {
      this.scheduleGenerate(true, prev !== null);
    }
    else if (changed(prev, next, STRIP_KEYS)) {
      this.scheduleGenerate(false, true);
    }
    else if (changed(prev, next, GROUP_KEYS)) {
      this.regroup();
    }
    else if (changed(prev, next, HEIGHT_KEYS)) {
      this.updateHeights();
    }
    if (prev && changed(prev, next, OUTLINE_GEOMETRY_KEYS) && !changed(prev, next, MASK_KEYS)) {
      this.updateOutline();
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
    if (!prev || prev.spinAngle !== next.spinAngle) {
      this.content.rotation.z = next.spinAngle;
    }
    if (!prev || prev.fov !== next.fov) {
      this.camera.fov = next.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private scheduleGenerate(maskChanged: boolean, debounce: boolean) {
    clearTimeout(this.generateTimer);
    useRenderInfo.setState({ generating: true });
    this.generateTimer = window.setTimeout(() => this.generate(maskChanged), debounce ? 250 : 0);
  }

  private async generate(maskChanged: boolean) {
    const token = ++this.generation;
    const config = this.config!;
    try {
      if (maskChanged) {
        const mask = await createMask({
          text: config.maskText,
          font: config.maskTextFont,
          textSize: config.maskTextSize,
          image: config.maskImage
        });
        if (token !== this.generation) {
          return;
        }
        this.mask = mask;
        this.updateOutline();
      }
      // Let the "generating" indicator paint before the synchronous work.
      // rAF does not fire in background tabs, so race it with a timer.
      await new Promise(resolve => {
        requestAnimationFrame(resolve);
        setTimeout(resolve, 50);
      });
      if (token !== this.generation) {
        return;
      }
      this.strips = generateStrips(this.config!, this.mask);
      this.regroup();
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

  private regroup() {
    const config = this.config!;
    const colorCount = Math.min(Math.max(Math.round(config.colorNumber), 1), MAX_COLORS);
    this.colorIndices = assignColors(this.strips, colorCount, config.clusterColors, config.seed);
    const heights = groupHeights(colorCount, config.minHeight, config.maxHeight);

    let triangleCount = 0;
    this.paperMeshes.forEach((mesh, idx) => {
      mesh.geometry.dispose();
      if (idx >= colorCount) {
        mesh.geometry = new THREE.BufferGeometry();
        return;
      }
      const strips = this.strips.filter((_, i) => this.colorIndices[i] === idx);
      const { position, normal, indices } = mergeStrips(strips, heights[idx]);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      mesh.geometry = geometry;
      triangleCount += indices.length / 3;
    });
    useRenderInfo.setState({ paperCount: this.strips.length, triangleCount });
    this.updateVisibility();
  }

  private updateHeights() {
    const config = this.config!;
    const heights = groupHeights(this.paperMeshes.length, config.minHeight, config.maxHeight);
    this.paperMeshes.forEach((mesh, idx) => {
      const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (attr) {
        setExtrudeHeight(attr.array as Float32Array, heights[idx]);
        attr.needsUpdate = true;
      }
    });
  }

  private updateOutline() {
    const config = this.config!;
    this.outlineMesh.geometry.dispose();
    this.outlineMesh.geometry = new THREE.BufferGeometry();
    if (this.mask && config.outlineThickness > 0 && config.outlineHeight > 0) {
      const { position, normal, indices } = extrudePolyline(this.mask.outline, {
        lineWidth: config.outlineThickness,
        depth: config.outlineHeight,
        smoothSide: true,
        excludeBottom: true
      });
      const geometry = this.outlineMesh.geometry;
      geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    }
    this.updateVisibility();
  }

  private updateVisibility() {
    const config = this.config!;
    const colorCount = Math.round(config.colorNumber);
    this.paperMeshes.forEach((mesh, idx) => {
      mesh.visible = config.paperVisible && idx < colorCount && !!mesh.geometry.index;
    });
    this.outlineMesh.visible = config.outlineVisible && !!this.mask && !!this.outlineMesh.geometry.index;
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
    this.paperMeshes.forEach((mesh, idx) => setup(mesh.material, config.colors[idx], PAPER_UV_SCALE));
    setup(this.outlineMesh.material, config.outlineColor, PAPER_UV_SCALE);
  }

  private updateGround() {
    const config = this.config!;
    const material = this.ground.material;
    setColor(material.color, config.planeColor);
    material.map = config.paperTexture ? this.getTexture(config.paperTexture) : null;
    material.userData = {
      mutracerShadowCatcher: !config.showPlane,
      mutracerUvProjection: 'triplanar',
      mutracerUvProjectionScale: [GROUND_UV_SCALE, GROUND_UV_SCALE]
    };
    material.needsUpdate = true;
    // The catcher covers the whole frame so shadows are never clipped.
    this.ground.scale.setScalar(config.showPlane ? 1 : 4);

    Object.assign(this.engine.display, {
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
  }

  private updateDisplay() {
    const config = this.config!;
    Object.assign(this.engine.display, {
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
    Object.assign(this.loop.final, {
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
    return this.engine.backend === 'webgpu'
      ? { type: 'oidn', model: target === 'preview' ? 'small' : 'standard', schedule }
      : { type: 'jnlm', schedule };
  }

  private updateDenoiser() {
    // The backend is only known after initialisation.
    if (!this.engine.info) {
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

  /** Snapshot of what is currently converged in the viewport. */
  async snapshot() {
    const { final, preview } = this.loop;
    const render = final.samples > 0 || !preview ? final : preview;
    return this.composite(await this.engine.display.toBlob(render));
  }

  /** Renders a fixed size image offline with the current camera. */
  async renderImage({ width, height, samples, signal }: ExportOptions) {
    const config = this.config!;
    const render = new Render(this.engine, {
      width,
      height,
      bounces: config.bounces,
      maxSamples: samples
    });
    const denoiser = this.denoiserOptions('export');
    // Converge rejects when scene or camera change, so pause interaction.
    this.loop.stop();
    this.controls.enabled = false;
    try {
      if (denoiser) {
        await render.setDenoiser(denoiser).catch(() => render.setDenoiser({ type: 'jnlm' }));
      }
      useRenderInfo.setState({ offline: { samples: 0, target: samples, stage: 'preparing' } });
      this.sync.update();
      this.engine.update();
      await render.converge({
        samples,
        samplesPerBatch: 4,
        signal,
        onProgress: ({ stage, samples: done, targetSamples }) => {
          useRenderInfo.setState({ offline: { samples: done, target: targetSamples, stage } });
        }
      });
      return await this.composite(await this.engine.display.toBlob(render));
    }
    finally {
      render.dispose();
      this.controls.enabled = true;
      if (!this.disposed) {
        this.loop.start();
      }
      useRenderInfo.setState({ offline: undefined });
    }
  }

  get viewportSize() {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.generateTimer);
    this.unsubscribers.forEach(fn => fn());
    this.resizeObserver.disconnect();
    this.loop.dispose();
    this.sync.dispose();
    this.controls.dispose();
    this.engine.dispose();
    this.canvas.remove();
  }
}
