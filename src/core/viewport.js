import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { icon } from '../icons.js';
import { clamp } from '../utils.js';

export class Viewport {
  constructor(app, container) {
    this.app = app;
    this.container = container;
    this.hud = container.querySelector('#viewport-hud');
    this.suspended = false;
    this.capture = null;
    this.captureCamera = null;
    this.activeCamera = null;
    this.detached = null;
    this.pointerStart = null;
    this.backgroundTexture = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0f16);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.05, 4000);
    this.camera.position.set(5.2, 3.8, 7.2);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    // En móvil se limita la densidad de píxeles para mantener 60 fps y no
    // calentar el teléfono; en escritorio se aprovecha la pantalla completa.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.app.mobile ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    this.setupEnvironment();
    this.setupBackground();
    this.setupGround();
    this.setupControls();
    this.setupHud();
    this.setupEvents();

    this.lastTick = performance.now();
    this.fpsFrames = 0;
    this.fpsLast = performance.now();
    this.renderer.setAnimationLoop(() => this.loop());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  setupEnvironment() {
    const envScene = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environmentTexture = pmrem.fromScene(envScene, 0.04).texture;
    this.scene.environment = this.environmentTexture;
    this.scene.environmentIntensity = 0.62;
    envScene.dispose?.();
    pmrem.dispose();

    this.baseLights = new THREE.Group();
    this.baseLights.name = '__base_lights';
    const hemi = new THREE.HemisphereLight(0xaac4ff, 0x1a202c, 1.15);
    const ambient = new THREE.AmbientLight(0xffffff, 0.22);
    const fill = new THREE.DirectionalLight(0x9fc0ff, 0.9);
    fill.position.set(-6, 7, -5);
    this.baseLights.add(hemi, ambient, fill);
    this.scene.add(this.baseLights);
  }

  setupBackground() {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.backgroundPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.backgroundPlane.name = '__background_image';
    this.backgroundPlane.renderOrder = -10000;
    this.backgroundPlane.frustumCulled = false;
    this.backgroundPlane.visible = false;
    this.backgroundPlane.userData.helperOnly = true;
    this.scene.add(this.backgroundPlane);
  }

  setBackgroundImage(texture = null) {
    this.backgroundTexture = texture || null;
    const plane = this.backgroundPlane;
    if (!plane) return;
    if (!texture) {
      plane.visible = false;
      plane.material.map = null;
      plane.material.needsUpdate = true;
      this.scene.background = new THREE.Color(0x0b0f16);
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    plane.material.map = texture;
    plane.material.needsUpdate = true;
    plane.visible = true;
    this.scene.background = null;
  }

  updateBackgroundPlane(camera = this.getRenderCamera()) {
    const plane = this.backgroundPlane;
    if (!plane?.visible || !this.backgroundTexture) return;
    camera.updateMatrixWorld();
    if (!camera.isPerspectiveCamera) return;
    const distance = Math.max(1, camera.near * 4);
    const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance;
    const width = height * Math.max(0.01, camera.aspect);
    plane.position.set(0, 0, -distance).applyMatrix4(camera.matrixWorld);
    plane.quaternion.copy(camera.quaternion);
    plane.scale.set(width, height, 1);
    plane.updateMatrixWorld();

    const image = this.backgroundTexture.image;
    const imageWidth = image?.width || image?.videoWidth || 0;
    const imageHeight = image?.height || image?.videoHeight || 0;
    if (imageWidth > 0 && imageHeight > 0) {
      const imageAspect = imageWidth / imageHeight;
      const targetAspect = Math.max(0.01, camera.aspect);
      let repeatX = 1;
      let repeatY = 1;
      if (imageAspect > targetAspect) repeatX = targetAspect / imageAspect;
      else repeatY = imageAspect / targetAspect;
      this.backgroundTexture.repeat.set(repeatX, repeatY);
      this.backgroundTexture.offset.set((1 - repeatX) / 2, (1 - repeatY) / 2);
    }
  }

  getSceneBounds() {
    const box = new THREE.Box3();
    for (const entry of this.app.entries) {
      if (!entry.object || !entry.visible) continue;
      if (entry.type === 'light' || entry.type === 'camera') continue;
      const entryBox = new THREE.Box3().setFromObject(entry.object);
      if (!entryBox.isEmpty()) box.union(entryBox);
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    return { box, center, size, radius: Math.max(0.5, size.length() * 0.5) };
  }

  createPreviewRenderer(canvas, width, height) {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = this.renderer.toneMapping;
    renderer.toneMappingExposure = this.renderer.toneMappingExposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const render = (camera) => {
      const previous = {
        grid: this.grid.visible,
        axes: this.axes.visible,
        helpers: this.helpers.visible,
        gizmo: this.transformHelper.visible,
      };
      this.grid.visible = false;
      this.axes.visible = false;
      this.helpers.visible = false;
      this.transformHelper.visible = false;
      this.updateBackgroundPlane(camera);
      this.scene.updateMatrixWorld(true);
      renderer.render(this.scene, camera);
      this.grid.visible = previous.grid;
      this.axes.visible = previous.axes;
      this.helpers.visible = previous.helpers;
      this.transformHelper.visible = previous.gizmo;
    };

    return {
      renderer,
      render,
      dispose() {
        try {
          renderer.dispose();
          renderer.forceContextLoss?.();
        } catch {
          /* el contexto ya se perdió */
        }
      },
    };
  }

  setupGround() {
    this.ground = new THREE.Group();
    this.ground.name = '__ground';

    this.grid = new THREE.GridHelper(80, 80, 0x3a4c68, 0x1b2534);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.62;
    this.grid.position.y = 0.001;
    this.ground.add(this.grid);

    this.axes = new THREE.AxesHelper(1.6);
    this.axes.material.transparent = true;
    this.axes.material.opacity = 0.9;
    this.axes.position.y = 0.002;
    this.ground.add(this.axes);

    const shadowMaterial = new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.26 });
    this.shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), shadowMaterial);
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.position.y = 0;
    this.shadowPlane.receiveShadow = true;
    this.shadowPlane.name = '__shadow';
    this.ground.add(this.shadowPlane);

    this.scene.add(this.ground);
  }

  setupControls() {
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = false;
    this.orbit.zoomToCursor = true;
    this.orbit.screenSpacePanning = true;
    this.orbit.rotateSpeed = 0.82;
    this.orbit.panSpeed = 0.9;
    this.orbit.zoomSpeed = 1.05;
    this.orbit.target.set(0, 1, 0);
    this.orbit.minDistance = 0.25;
    this.orbit.maxDistance = 500;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.update();

    if (this.app.mobile) {
      // Gestos táctiles estilo app móvil: 1 dedo orbita, 2 dedos desplazan y
      // hacen zoom. Se desactiva zoomToCursor porque salta con el pinch.
      this.orbit.zoomToCursor = false;
      this.orbit.rotateSpeed = 0.6;
      this.orbit.panSpeed = 0.72;
      this.orbit.zoomSpeed = 0.85;
      this.orbit.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      this.renderer.domElement.style.touchAction = 'none';
    }

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSize(this.app.mobile ? 1.3 : 0.86);
    this.transform.setMode('translate');
    this.transformHelper = this.transform.getHelper();
    this.scene.add(this.transformHelper);

    this.transform.addEventListener('dragging-changed', (event) => {
      this.orbit.enabled = !event.value && !this.activeCamera;
      if (event.value) this.app.onGizmoDragStart?.();
      else this.app.onGizmoDragEnd?.();
    });
    this.transform.addEventListener('objectChange', () => this.app.onGizmoChange?.());

    this.helpers = new THREE.Group();
    this.helpers.name = '__helpers';
    this.scene.add(this.helpers);
  }

  setupHud() {
    if (!this.hud) return;
    this.hud.innerHTML = `
      <div class="vp-top">
        <div class="vp-title">${icon('cube', 15)} Vista 3D</div>
        <span class="vp-pill" id="vp-mode">Perspectiva</span>
        <div class="vp-right">
          <button class="vp-btn" id="vp-grid" title="Mostrar/ocultar cuadrícula">${icon('grid', 13)}</button>
          <button class="vp-btn" id="vp-focus" title="Enfocar seleccionado (F)">${icon('focus', 13)}</button>
          <button class="vp-btn" id="vp-cam" title="Usar cámara seleccionada">${icon('camera', 13)}</button>
        </div>
      </div>
      <div class="vp-stats">
        <span><b id="vp-objcount">0</b> objetos</span>
        <span><b id="vp-fps">60</b> fps</span>
        <span><b id="vp-tri">0</b> tris</span>
      </div>
      <div class="vp-hint">${
        this.app.mobile
          ? '1 dedo: orbitar · 2 dedos: mover y zoom · Toca para seleccionar'
          : 'Arrastra para orbitar · Rueda para zoom · Click para seleccionar'
      }</div>
      <div class="vp-activecam" id="vp-activecam" style="display:none"></div>
    `;

    this.hud.querySelector('#vp-grid')?.addEventListener('click', () => {
      this.grid.visible = !this.grid.visible;
      this.axes.visible = this.grid.visible;
      this.hud.querySelector('#vp-grid')?.classList.toggle('on', this.grid.visible);
    });
    this.hud.querySelector('#vp-grid')?.classList.add('on');
    this.hud.querySelector('#vp-focus')?.addEventListener('click', () => this.app.focusSelected());
    this.hud.querySelector('#vp-cam')?.addEventListener('click', () => this.app.useSelectedCamera());
    this.hud.addEventListener('click', (event) => {
      if (event.target.closest('#vp-exit-cam')) {
        this.app.exitCameraView();
      }
    });
  }

  setupEvents() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.pointerStart = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener('pointerup', (event) => {
      if (event.button !== 0 || !this.pointerStart) return;
      const dx = event.clientX - this.pointerStart.x;
      const dy = event.clientY - this.pointerStart.y;
      this.pointerStart = null;
      if (Math.hypot(dx, dy) > 4) return;
      if (this.transform.axis) return;
      const entry = this.pick(event.clientX, event.clientY);
      this.app.select(entry?.id || null);
    });
    canvas.addEventListener('dblclick', (event) => {
      const entry = this.pick(event.clientX, event.clientY);
      if (entry) {
        this.app.select(entry.id);
        this.focusEntry(entry);
      }
    });
  }

  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster = this.raycaster || new THREE.Raycaster();
    this.raycaster.setFromCamera(ndc, this.getRenderCamera());

    const meshes = this.app.entries
      .filter((entry) => entry.type === 'mesh' && entry.object?.visible && !entry.locked)
      .map((entry) => entry.object);
    if (!meshes.length) return null;

    const hits = this.raycaster.intersectObjects(meshes, true);
    for (const hit of hits) {
      let node = hit.object;
      while (node && !node.userData.entryId) node = node.parent;
      if (node) {
        const entry = this.app.objects.get(node.userData.entryId);
        if (entry) return entry;
      }
    }
    return null;
  }

  resize() {
    if (this.capture) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.activeCamera) {
      this.activeCamera.aspect = width / height;
      this.activeCamera.updateProjectionMatrix();
    }
    this.renderer.setSize(width, height, false);
  }

  getRenderCamera() {
    return this.captureCamera || this.activeCamera || this.camera;
  }

  setActiveCamera(camera) {
    this.activeCamera = camera || null;
    if (camera) {
      camera.aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
      camera.updateProjectionMatrix();
      this.orbit.enabled = false;
    } else {
      this.orbit.enabled = true;
    }
    this.updateCameraHud();
  }

  updateCameraHud() {
    if (!this.hud) return;
    const mode = this.hud.querySelector('#vp-mode');
    const overlay = this.hud.querySelector('#vp-activecam');
    if (this.activeCamera) {
      const entry = this.app.entries.find((item) => item.object === this.activeCamera);
      const name = entry?.name || this.activeCamera.name || 'Cámara';
      if (mode) {
        mode.textContent = `Cámara: ${name}`;
        mode.classList.add('cam');
      }
      if (overlay) {
        overlay.style.display = 'flex';
        overlay.innerHTML = `${icon('camera', 13)} <span>Vista desde <b>${name}</b></span><button id="vp-exit-cam">Salir</button>`;
      }
    } else {
      if (mode) {
        mode.textContent = 'Perspectiva';
        mode.classList.remove('cam');
      }
      if (overlay) overlay.style.display = 'none';
    }
  }

  setTool(tool) {
    if (tool === 'select') {
      this.transform.detach();
      this.transformHelper.visible = false;
      return;
    }
    this.transform.setMode(tool);
    const entry = this.app.selectedEntry;
    if (entry?.object && entry.visible) {
      this.transform.attach(entry.object);
      this.transformHelper.visible = true;
    }
  }

  updateSelection(entry) {
    this.clearSelectionHelpers();
    if (!entry?.object) {
      this.transform.detach();
      return;
    }

    const color = 0xf5c542;
    if (entry.type === 'light') {
      const light = entry.object;
      let helper = null;
      if (light.isDirectionalLight) helper = new THREE.DirectionalLightHelper(light, 0.9, color);
      else if (light.isPointLight) helper = new THREE.PointLightHelper(light, 0.35, color);
      else if (light.isSpotLight) helper = new THREE.SpotLightHelper(light, color);
      else if (light.isHemisphereLight) helper = new THREE.HemisphereLightHelper(light, 0.7, color);
      if (helper) {
        helper.material?.dispose?.();
        this.helpers.add(helper);
      } else {
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.13, 12, 8),
          new THREE.MeshBasicMaterial({ color, wireframe: true, depthTest: false }),
        );
        marker.position.copy(light.position);
        marker.renderOrder = 999;
        this.helpers.add(marker);
      }
    } else if (entry.type === 'camera') {
      const helper = new THREE.CameraHelper(entry.object);
      helper.material.depthTest = false;
      helper.material.transparent = true;
      helper.renderOrder = 999;
      this.helpers.add(helper);
    } else if (entry.type === 'mesh' || entry.object.isMesh) {
      const box = this.createOrientedBox(entry.object, color);
      if (box) {
        this.selectionBox = box;
        this.selectionTarget = entry.object;
        this.helpers.add(box);
      } else {
        const fallback = new THREE.BoxHelper(entry.object, color);
        fallback.material.depthTest = false;
        fallback.material.transparent = true;
        fallback.renderOrder = 999;
        this.selectionBox = fallback;
        this.helpers.add(fallback);
      }
    } else {
      const box3 = new THREE.Box3().setFromObject(entry.object);
      if (!box3.isEmpty()) {
        const helper = new THREE.Box3Helper(box3, color);
        helper.material.depthTest = false;
        helper.material.transparent = true;
        helper.renderOrder = 999;
        this.helpers.add(helper);
      } else {
        const marker = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.2),
          new THREE.MeshBasicMaterial({ color, wireframe: true, depthTest: false }),
        );
        marker.position.copy(entry.object.position);
        marker.renderOrder = 999;
        this.helpers.add(marker);
      }
    }

    if (this.app.tool !== 'select' && entry.visible) {
      this.transform.attach(entry.object);
      this.transformHelper.visible = true;
    } else {
      this.transform.detach();
      this.transformHelper.visible = false;
    }
  }

  createOrientedBox(object, color) {
    if (!object?.isMesh || !object.geometry) return null;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    const bounds = object.geometry.boundingBox;
    if (!bounds || bounds.isEmpty()) return null;
    const size = bounds.getSize(new THREE.Vector3()).multiplyScalar(1.035);
    const center = bounds.getCenter(new THREE.Vector3());
    const geometry = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(Math.max(size.x, 1e-4), Math.max(size.y, 1e-4), Math.max(size.z, 1e-4)),
    );
    geometry.translate(center.x, center.y, center.z);
    const material = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    const box = new THREE.LineSegments(geometry, material);
    box.matrixAutoUpdate = false;
    box.renderOrder = 999;
    object.updateWorldMatrix(true, false);
    box.matrix.copy(object.matrixWorld);
    return box;
  }

  updateSelectionGeometry() {
    if (!this.selectionBox) return;
    if (this.selectionTarget) {
      this.selectionTarget.updateWorldMatrix(true, false);
      this.selectionBox.matrix.copy(this.selectionTarget.matrixWorld);
      this.selectionBox.matrixWorldNeedsUpdate = true;
    } else {
      this.selectionBox.update?.();
    }
  }

  clearSelectionHelpers() {
    this.selectionBox = null;
    this.selectionTarget = null;
    for (const child of [...this.helpers.children]) {
      child.traverse?.((node) => {
        node.geometry?.dispose?.();
        if (Array.isArray(node.material)) node.material.forEach((mat) => mat.dispose?.());
        else node.material?.dispose?.();
      });
      this.helpers.remove(child);
    }
  }

  focusEntry(entry) {
    if (!entry?.object) return;
    const box = new THREE.Box3().setFromObject(entry.object);
    if (box.isEmpty()) {
      const position = new THREE.Vector3();
      entry.object.getWorldPosition(position);
      box.setFromCenterAndSize(position, new THREE.Vector3(1.4, 1.4, 1.4));
    }
    this.focusBox(box);
  }

  focusBox(box) {
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(0.35, size.length() * 0.5);
    const direction = this.camera.position.clone().sub(this.orbit.target);
    if (direction.lengthSq() < 1e-5) direction.set(1, 0.7, 1);
    direction.normalize();
    const distance = clamp(radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov * 0.5)), 1.1, 500) * 1.08;
    this.orbit.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.near = Math.max(0.01, distance / 500);
    this.camera.far = Math.max(1000, distance * 20);
    this.camera.updateProjectionMatrix();
    this.orbit.update();
  }

  focusAll() {
    const box = new THREE.Box3();
    let found = false;
    for (const entry of this.app.entries) {
      if (!entry.object || !entry.visible) continue;
      const entryBox = new THREE.Box3().setFromObject(entry.object);
      if (!entryBox.isEmpty()) {
        box.union(entryBox);
        found = true;
      }
    }
    if (found) this.focusBox(box);
    else this.resetView();
  }

  resetView() {
    this.app.exitCameraView?.();
    this.orbit.target.set(0, 1, 0);
    this.camera.position.set(5.2, 3.8, 7.2);
    this.camera.near = 0.05;
    this.camera.far = 4000;
    this.camera.updateProjectionMatrix();
    this.orbit.update();
  }

  updateStats() {
    if (!this.hud) return;
    const objectCount = this.hud.querySelector('#vp-objcount');
    if (objectCount) objectCount.textContent = String(this.app.entries.length);
    let tris = 0;
    this.scene.traverse((node) => {
      if (node.isMesh && node.geometry && node !== this.backgroundPlane) {
        const index = node.geometry.index;
        tris += index ? index.count / 3 : (node.geometry.attributes.position?.count || 0) / 3;
      }
    });
    const triLabel = this.hud.querySelector('#vp-tri');
    if (triLabel) triLabel.textContent = tris > 9999 ? `${(tris / 1000).toFixed(1)}k` : String(Math.round(tris));
  }

  start() {
    this.lastTick = performance.now();
  }

  loop() {
    if (this.suspended) return;
    const now = performance.now();
    const dt = Math.min(Math.max(0, (now - this.lastTick) / 1000), 0.1);
    this.lastTick = now;
    this.app.tick(dt);
    const camera = this.getRenderCamera();
    this.updateBackgroundPlane(camera);
    this.renderer.render(this.scene, camera);

    this.fpsFrames += 1;
    if (now - this.fpsLast > 650) {
      const fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsLast));
      this.fpsFrames = 0;
      this.fpsLast = now;
      const fpsLabel = this.hud?.querySelector('#vp-fps');
      if (fpsLabel) fpsLabel.textContent = String(fps);
    }
  }

  setSuspended(value) {
    this.suspended = value;
    if (!value) {
      this.lastTick = performance.now();
      this.fpsFrames = 0;
      this.fpsLast = performance.now();
    }
  }

  renderOnce() {
    const camera = this.getRenderCamera();
    this.updateBackgroundPlane(camera);
    this.renderer.render(this.scene, camera);
  }

  beginCapture(width, height, camera = null) {
    if (this.capture) return;
    this.capture = {
      width: this.container.clientWidth,
      height: this.container.clientHeight,
      pixelRatio: this.renderer.getPixelRatio(),
      editorAspect: this.camera.aspect,
      activeAspect: this.activeCamera?.aspect,
      cameraAspect: camera?.aspect,
      gridVisible: this.grid.visible,
      axesVisible: this.axes.visible,
      helpersVisible: this.helpers.visible,
      gizmoVisible: this.transformHelper.visible,
      hudDisplay: this.hud?.style.display,
    };
    this.captureCamera = camera || null;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.activeCamera) {
      this.activeCamera.aspect = width / height;
      this.activeCamera.updateProjectionMatrix();
    }
    if (camera) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    this.grid.visible = false;
    this.axes.visible = false;
    this.helpers.visible = false;
    this.transformHelper.visible = false;
    if (this.hud) this.hud.style.display = 'none';
  }

  endCapture() {
    if (!this.capture) return;
    const saved = this.capture;
    const camera = this.captureCamera;
    this.capture = null;
    this.captureCamera = null;
    this.renderer.setPixelRatio(saved.pixelRatio);
    this.renderer.setSize(saved.width, saved.height, false);
    this.camera.aspect = saved.editorAspect;
    this.camera.updateProjectionMatrix();
    if (this.activeCamera) {
      this.activeCamera.aspect = saved.activeAspect || saved.editorAspect;
      this.activeCamera.updateProjectionMatrix();
    }
    if (camera) {
      camera.aspect = saved.cameraAspect || saved.editorAspect;
      camera.updateProjectionMatrix();
    }
    this.grid.visible = saved.gridVisible;
    this.axes.visible = saved.axesVisible;
    this.helpers.visible = saved.helpersVisible;
    this.transformHelper.visible = saved.gizmoVisible;
    if (this.hud) this.hud.style.display = saved.hudDisplay || '';
    this.resize();
    this.app.viewport?.updateSelection(this.app.selectedEntry);
  }

  detachForModelExport() {
    if (this.detached) return;
    this.detached = [];
    for (const node of [this.baseLights, this.ground, this.helpers, this.transformHelper, this.backgroundPlane]) {
      if (node?.parent === this.scene) {
        this.scene.remove(node);
        this.detached.push(node);
      }
    }
  }

  reattachAfterModelExport() {
    if (!this.detached) return;
    for (const node of this.detached) {
      if (node && node.parent !== this.scene) this.scene.add(node);
    }
    this.detached = null;
    this.updateSelection(this.app.selectedEntry);
  }
}
