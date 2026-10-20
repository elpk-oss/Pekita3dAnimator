import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Viewport } from './core/viewport.js';
import { AnimationSystem, CHANNELS, createTracks } from './core/animation.js';
import { AudioSystem } from './core/audio.js';
import { AutoSaveStore } from './core/autosave.js';
import { importFiles, importSummary } from './core/importer.js';
import { buildProjectBlob, exportGLB, exportPNG, exportVideo, loadProjectFile, openExportDialog, saveProject } from './core/exporter.js';
import { Topbar } from './ui/topbar.js';
import { Toolrail } from './ui/toolrail.js';
import { Inspector } from './ui/inspector.js';
import { Timeline } from './ui/timeline.js';
import { confirmDialog, openAboutModal, openHelpModal, showModal, toast } from './ui/ui.js';
import { icon } from './icons.js';
import { baseName, clamp, deepClone, fileExt, formatTimecode, snapTime, uid } from './utils.js';

const PALETTE = ['#f5c542', '#5aa2ff', '#5ad68c', '#b18cff', '#ff9f5a', '#54d6d6', '#ff7bb0', '#9bb7ff'];
const TYPE_ICON = { mesh: 'cube', model: 'layers', group: 'folder', light: 'light', camera: 'camera', audio: 'audio' };

export class App {
  constructor(root) {
    this.root = root;
    this.objects = new Map();
    this.entries = [];
    this.entryCounter = 0;
    this.selectedId = null;
    this.selectedKey = null;
    this.currentTime = 0;
    this.duration = 8;
    this.fps = 30;
    this.playing = false;
    this.loop = true;
    this.autoKey = false;
    this.timelinePPS = 120;
    this.tool = 'translate';
    this.activeCameraId = null;
    this.exporting = false;
    this.inSetup = false;
    this._timelineDirty = false;
    this.history = [];
    this.historyIndex = -1;
    this.restoringHistory = false;
    this.background = null;
    this.autosaveStore = new AutoSaveStore();
    this.autosaveReady = false;
    this.autosaveDirty = false;
    this.autosaveSaving = false;
    this.autosavePending = false;
    this.autosaveTimer = null;
    this.lastAutosaveAt = 0;

    this.audio = new AudioSystem(this);
    this.animation = new AnimationSystem(this);
    this.viewport = new Viewport(this, document.getElementById('viewport'));

    this.topbar = new Topbar(this, document.getElementById('topbar'));
    this.toolrail = new Toolrail(this, document.getElementById('toolrail'));
    this.inspector = new Inspector(this, document.getElementById('inspector'));
    this.timeline = new Timeline(this, document.getElementById('timeline'));

    this.bindFileInputs();
    this.bindShortcuts();
    this.setupDefaultScene();
    this.refreshAll();
    this.viewport.start();
    this.refreshCameraHud();
    this.topbar?.setAutosaveStatus('idle', 'Auto');
  }

  get selectedEntry() {
    return this.objects.get(this.selectedId) || null;
  }

  get activeCameraEntry() {
    return this.objects.get(this.activeCameraId) || null;
  }

  get projectName() {
    return 'pekita-animate';
  }

  /* ============================================================
     Escena / objetos
     ============================================================ */

  setupDefaultScene() {
    this.inSetup = true;
    this.addPrimitive('box', {
      name: 'Cubo',
      position: [0, 0.82, 0],
      size: 1.64,
      color: 0xf5c542,
      select: false,
    });
    this.addLight('directional', { name: 'Luz principal', position: [4.5, 7, 5], select: false });
    this.addCamera({ name: 'Cámara 1', position: [6.2, 4.3, 9.2], select: false });
    this.currentTime = 0;
    this.playing = false;
    this.select(this.entries[0]?.id || null);
    this.inSetup = false;
    this.clearHistory();
  }

  uniqueName(name) {
    const base = String(name || 'Objeto').trim() || 'Objeto';
    let candidate = base;
    let i = 2;
    const used = new Set(this.entries.map((entry) => entry.name.toLowerCase()));
    while (used.has(candidate.toLowerCase())) {
      candidate = `${base} ${i}`;
      i += 1;
    }
    return candidate;
  }

  addEntry(object, options = {}) {
    if (!object) return null;
    if (object.userData.entryId) {
      const existing = this.objects.get(object.userData.entryId);
      if (existing?.object === object) return existing;
      // Un GLB exportado por PEKITA conserva el entryId. Si se importa en otra
      // escena ese id ya pertenece a otro objeto, así que se descarta.
      delete object.userData.entryId;
    }
    const name = this.uniqueName(options.name || object.name || 'Objeto');
    const type = options.type || (object.isLight ? 'light' : object.isCamera ? 'camera' : object.isMesh ? 'mesh' : 'group');
    const entry = {
      id: uid('obj'),
      name,
      type,
      object,
      parentId: options.parentId || null,
      tracks: options.tracks ? deepClone(options.tracks) : createTracks(),
      color: options.color || this.colorForType(type),
      visible: object.visible !== false,
      locked: !!options.locked,
      warnings: options.warnings || [],
      modifierState: { wireframe: false, flatShading: false },
      baseGeometry: null,
    };
    object.name = name;
    object.userData.entryId = entry.id;
    if (!object.parent && options.addToScene !== false) this.viewport.scene.add(object);
    this.objects.set(entry.id, entry);
    this.entries.push(entry);
    this.viewport?.updateStats();
    return entry;
  }

  colorForType(type) {
    if (type === 'camera') return '#5aa2ff';
    if (type === 'light') return '#f5c542';
    if (type === 'model') return '#5ad68c';
    if (type === 'group') return '#9aa7bb';
    return PALETTE[this.entries.length % PALETTE.length];
  }

  registerImportedRoot(object, name, warnings = []) {
    const rootType = object.isMesh ? 'mesh' : 'model';
    const rootEntry = this.addEntry(object, {
      name,
      type: rootType,
      warnings,
      color: '#5ad68c',
    });
    this.registerDescendants(object, rootEntry.id);
    this.viewport.updateStats();
    return rootEntry;
  }

  registerDescendants(node, parentId) {
    for (const child of node.children) {
      if (child.userData.helperOnly) continue;
      const isMesh = child.isMesh;
      const isGroup = child.isGroup || (child.type === 'Object3D' && child.children.length);
      const isLight = child.isLight;
      const isCamera = child.isCamera;
      if (isMesh || isGroup || isLight || isCamera) {
        const type = isLight ? 'light' : isCamera ? 'camera' : isMesh ? 'mesh' : 'group';
        const entry = this.addEntry(child, { name: child.name, type, parentId, addToScene: false, color: this.colorForType(type) });
        this.registerDescendants(child, entry.id);
      } else {
        this.registerDescendants(child, parentId);
      }
    }
  }

  addPrimitive(kind, options = {}) {
    const defs = {
      box: { name: 'Cubo', color: 0xf5c542, geo: () => new THREE.BoxGeometry(options.size || 1, options.size || 1, options.size || 1), y: (options.size || 1) / 2 },
      sphere: { name: 'Esfera', color: 0x5aa2ff, geo: () => new THREE.SphereGeometry(0.68, 40, 28), y: 0.68 },
      plane: { name: 'Plano', color: 0x78889f, geo: () => new THREE.PlaneGeometry(2.4, 2.4), y: 0.012, rotation: [-Math.PI / 2, 0, 0] },
      cylinder: { name: 'Cilindro', color: 0x5ad68c, geo: () => new THREE.CylinderGeometry(0.6, 0.6, 1.4, 40), y: 0.7 },
      cone: { name: 'Cono', color: 0xff9f5a, geo: () => new THREE.ConeGeometry(0.72, 1.5, 40), y: 0.75 },
      torus: { name: 'Toro', color: 0xb18cff, geo: () => new THREE.TorusGeometry(0.7, 0.22, 24, 72), y: 0.95, rotation: [-Math.PI / 2, 0, 0] },
      empty: { name: 'Vacío', color: 0x9aa7bb, geo: null, y: 0 },
    };
    const def = defs[kind] || defs.box;
    let object;
    if (!def.geo) {
      object = new THREE.Group();
    } else {
      const material = new THREE.MeshStandardMaterial({
        color: options.color ?? def.color,
        roughness: options.roughness ?? 0.4,
        metalness: options.metalness ?? 0.16,
      });
      object = new THREE.Mesh(def.geo(), material);
      object.castShadow = true;
      object.receiveShadow = true;
      if (def.rotation) object.rotation.set(...def.rotation);
    }

    const position = options.position || [0, def.y, 0];
    object.position.set(position[0], position[1], position[2]);
    const entry = this.addEntry(object, {
      name: options.name || def.name,
      type: def.geo ? 'mesh' : 'group',
      color: options.color ? `#${options.color.toString(16).padStart(6, '0')}` : undefined,
    });

    if (options.select !== false) {
      this.select(entry.id);
      this.clearHistory();
      this.refreshAll();
      toast(`${entry.name} añadido.`, 'success', 1600);
    }
    return entry;
  }

  addLight(kind = 'directional', options = {}) {
    const defaults = {
      directional: { name: 'Luz direccional', color: 0xffffff, intensity: 2.4, position: [4, 7, 5] },
      point: { name: 'Luz puntual', color: 0xffe0b0, intensity: 28, position: [2.5, 3.2, 2.5] },
      spot: { name: 'Foco', color: 0xffffff, intensity: 45, position: [3, 6, 3] },
      ambient: { name: 'Luz ambiental', color: 0xffffff, intensity: 0.7, position: [0, 3, 0] },
      hemisphere: { name: 'Luz hemisférica', color: 0xaac4ff, intensity: 1.1, position: [0, 4, 0] },
    };
    const def = defaults[kind] || defaults.directional;
    let light;
    if (kind === 'point') light = new THREE.PointLight(def.color, def.intensity, 0, 2);
    else if (kind === 'spot') {
      light = new THREE.SpotLight(def.color, def.intensity, 0, Math.PI / 6, 0.35, 2);
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      light.target.position.set(0, 1, 0);
      this.viewport.scene.add(light.target);
      light.target.userData.helperOnly = true;
    } else if (kind === 'ambient') light = new THREE.AmbientLight(def.color, def.intensity);
    else if (kind === 'hemisphere') light = new THREE.HemisphereLight(def.color, 0x1a202c, def.intensity);
    else {
      light = new THREE.DirectionalLight(def.color, def.intensity);
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.02;
      light.shadow.camera.near = 0.2;
      light.shadow.camera.far = 80;
      light.shadow.camera.left = -18;
      light.shadow.camera.right = 18;
      light.shadow.camera.top = 18;
      light.shadow.camera.bottom = -18;
    }
    const pos = options.position || def.position;
    light.position.set(...pos);
    light.name = options.name || def.name;
    light.userData.entryHelper = false;
    this.viewport.scene.add(light);

    const entry = this.addEntry(light, {
      name: options.name || def.name,
      type: 'light',
      color: '#f5c542',
    });

    if (options.select !== false) {
      this.select(entry.id);
      this.clearHistory();
      this.refreshAll();
      toast(`${entry.name} añadida.`, 'success', 1600);
    }
    return entry;
  }

  addCamera(options = {}) {
    const aspect = this.viewport.container.clientWidth / Math.max(1, this.viewport.container.clientHeight);
    const camera = new THREE.PerspectiveCamera(46, aspect, 0.1, 1000);
    const position = options.position || [6, 4, 9];
    camera.position.set(...position);
    camera.lookAt(0, 1, 0);
    camera.name = options.name || `Cámara ${this.entries.filter((e) => e.type === 'camera').length + 1}`;
    this.viewport.scene.add(camera);
    const entry = this.addEntry(camera, { name: camera.name, type: 'camera', color: '#5aa2ff' });

    if (options.select !== false) {
      this.select(entry.id);
      this.clearHistory();
      this.refreshAll();
      toast(`${entry.name} añadida.`, 'success', 1600);
    }
    return entry;
  }

  select(id, options = {}) {
    if (id && !this.objects.has(id)) id = null;
    this.selectedId = id || null;
    this.selectedKey = null;
    const entry = this.selectedEntry;
    this.viewport?.updateSelection(entry);
    this.inspector?.render();
    this.timeline?.render();
    if (options.focus) this.focusSelected();
  }

  selectKey(entryId, time, options = {}) {
    const entry = this.objects.get(entryId);
    if (!entry) return;
    this.selectedId = entryId;
    this.selectedKey = { id: entryId, time };
    this.viewport?.updateSelection(entry);
    this.inspector?.render();
    this.timeline?.render();
    if (options.seek !== false) this.seek(time);
  }

  renameSelected(name) {
    const entry = this.selectedEntry;
    if (!entry) return;
    const base = String(name || '').trim() || entry.name;
    let candidate = base;
    let i = 2;
    while (this.entries.some((item) => item !== entry && item.name.toLowerCase() === candidate.toLowerCase())) {
      candidate = `${base} ${i}`;
      i += 1;
    }
    entry.name = candidate;
    entry.object.name = candidate;
    this.timeline?.render();
    this.inspector?.render();
    this.viewport?.updateCameraHud();
    this.commitChange();
  }

  toggleVisible(entryOrId) {
    const entry = typeof entryOrId === 'string' ? this.objects.get(entryOrId) : entryOrId;
    if (!entry) return;
    entry.object.visible = !entry.object.visible;
    entry.visible = entry.object.visible;
    this.viewport?.updateSelection(this.selectedEntry);
    this.timeline?.render();
    this.inspector?.render();
    this.commitChange();
  }

  deleteSelected() {
    const entry = this.selectedEntry;
    if (!entry) {
      toast('No hay ningún objeto seleccionado.', 'warn', 1800);
      return;
    }
    const ids = this.subtreeIds(entry.id);
    for (const id of ids) {
      const item = this.objects.get(id);
      if (!item) continue;
      if (item.object?.isSpotLight && item.object.target?.parent) item.object.target.parent.remove(item.object.target);
      if (item.object?.parent) item.object.parent.remove(item.object);
      if (this.activeCameraId === id) this.exitCameraView();
      this.objects.delete(id);
    }
    this.entries = this.entries.filter((item) => !ids.includes(item.id));
    this.selectedId = null;
    this.selectedKey = null;
    this.viewport.clearSelectionHelpers();
    this.viewport.transform.detach();
    this.clearHistory();
    this.refreshAll();
    toast(`${entry.name} eliminado.`, 'success', 1800);
  }

  subtreeIds(id) {
    const ids = [id];
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of this.entries) {
        if (entry.parentId && ids.includes(entry.parentId) && !ids.includes(entry.id)) {
          ids.push(entry.id);
          changed = true;
        }
      }
    }
    return ids;
  }

  subtreeEntries(entry) {
    const ids = this.subtreeIds(entry.id);
    return this.entries.filter((item) => ids.includes(item.id));
  }

  cloneEntry(entry, offset = null) {
    const clone = entry.object.clone(true);
    clone.traverse((node) => {
      node.userData = { ...node.userData };
      delete node.userData.entryId;
    });
    if (offset) clone.position.add(offset);
    else clone.position.x += 1.2;
    this.viewport.scene.add(clone);
    const rootEntry = this.registerImportedRoot(clone, `${entry.name} copia`, entry.warnings);
    rootEntry.type = entry.type;
    rootEntry.color = entry.color;
    rootEntry.tracks = deepClone(entry.tracks);
    const originalChildren = this.subtreeEntries(entry).filter((item) => item !== entry);
    const cloneChildren = this.subtreeEntries(rootEntry).filter((item) => item !== rootEntry);
    originalChildren.forEach((source, index) => {
      if (cloneChildren[index]) cloneChildren[index].tracks = deepClone(source.tracks);
    });
    return rootEntry;
  }

  duplicateSelected() {
    const entry = this.selectedEntry;
    if (!entry) {
      toast('Selecciona un objeto para duplicarlo.', 'warn', 1800);
      return;
    }
    const clone = this.cloneEntry(entry);
    this.select(clone.id);
    this.clearHistory();
    this.refreshAll();
    toast(`${entry.name} duplicado.`, 'success', 1800);
  }

  createRigControl() {
    const entry = this.selectedEntry;
    if (!entry?.object) {
      toast('Selecciona un objeto para crear su control.', 'warn', 2200);
      return;
    }
    const world = new THREE.Vector3();
    entry.object.getWorldPosition(world);
    const control = this.addPrimitive('empty', {
      name: this.uniqueName(`${entry.name} Control`),
      position: [world.x, world.y, world.z],
      select: false,
    });
    control.color = '#f5c542';
    control.object.userData.rigControl = true;
    if (!this.reparentEntry(entry.id, control.id, { preserveWorld: true, commit: false })) {
      control.object.parent?.remove(control.object);
      this.objects.delete(control.id);
      this.entries = this.entries.filter((item) => item.id !== control.id);
      this.refreshAll();
      toast('No se pudo crear el control.', 'error', 2400);
      return;
    }
    this.select(control.id);
    this.clearHistory();
    this.refreshAll();
    toast('Control creado. Anima el control para mover todo el rig.', 'success', 3200);
  }

  reparentSelectedTo(parentId) {
    const entry = this.selectedEntry;
    const parent = this.objects.get(parentId);
    if (!entry || !parent || entry === parent) {
      toast('Selecciona un objeto y un control válido.', 'warn', 2200);
      return false;
    }
    const ok = this.reparentEntry(entry.id, parent.id, { preserveWorld: true, commit: false });
    if (!ok) {
      toast('No se puede crear un ciclo en la jerarquía.', 'error', 2600);
      return false;
    }
    this.clearHistory();
    this.refreshAll();
    toast(`${entry.name} emparentado a ${parent.name}.`, 'success', 2400);
    return true;
  }

  reparentEntry(childId, parentId, options = {}) {
    const child = this.objects.get(childId);
    const parent = this.objects.get(parentId);
    if (!child?.object || !parent?.object || child === parent) return false;
    let cursor = parent;
    while (cursor) {
      if (cursor.id === child.id) return false;
      cursor = cursor.parentId ? this.objects.get(cursor.parentId) : null;
    }
    this.viewport.scene.updateMatrixWorld(true);
    parent.object.updateWorldMatrix(true, false);
    child.object.updateWorldMatrix(true, false);
    if (options.preserveWorld !== false) parent.object.attach(child.object);
    else {
      child.object.parent?.remove(child.object);
      parent.object.add(child.object);
    }
    child.parentId = parent.id;
    if (options.commit) {
      this.clearHistory();
      this.refreshAll();
    }
    return true;
  }

  unparentSelected() {
    const entry = this.selectedEntry;
    if (!entry?.parentId) {
      toast('El objeto ya está en la raíz de la escena.', 'warn', 1800);
      return;
    }
    this.viewport.scene.updateMatrixWorld(true);
    this.viewport.scene.attach(entry.object);
    entry.parentId = null;
    this.clearHistory();
    this.refreshAll();
    toast(`${entry.name} está ahora en la raíz.`, 'success', 2000);
  }

  selectParent() {
    const entry = this.selectedEntry;
    if (!entry?.parentId) return;
    this.select(entry.parentId);
  }

  compositeClipRange(entry) {
    if (!entry) return null;
    let start = Infinity;
    let end = -Infinity;
    for (const item of this.subtreeEntries(entry)) {
      const range = this.animation.clipRange(item);
      if (!range) continue;
      start = Math.min(start, range.start);
      end = Math.max(end, range.end);
    }
    return start <= end ? { start, end } : null;
  }

  shiftSubtreeKeys(rootId, originalTracksMap, delta, commit = false) {
    const root = this.objects.get(rootId);
    if (!root) return;
    const entries = this.subtreeEntries(root).filter((entry) => entry.tracks);
    let minShift = Infinity;
    let maxShift = -Infinity;
    for (const entry of entries) {
      let min = Infinity;
      let max = -Infinity;
      for (const channel of CHANNELS) {
        for (const key of entry.tracks?.[channel]?.keys || []) {
          min = Math.min(min, key.time);
          max = Math.max(max, key.time);
        }
      }
      if (!Number.isFinite(min)) continue;
      minShift = Math.min(minShift, -min);
      maxShift = Math.max(maxShift, this.duration - max);
    }
    if (!Number.isFinite(minShift) || !Number.isFinite(maxShift)) return;
    const clamped = clamp(delta, minShift, maxShift);
    for (const entry of entries) {
      const original = originalTracksMap instanceof Map ? originalTracksMap.get(entry.id) : originalTracksMap?.[entry.id];
      if (!original) continue;
      this.animation.applyShiftedTracks(entry, original, clamped, this.duration);
    }
    if (commit) {
      this.animation.evaluate(this.currentTime);
      this.timeline?.render();
      this.inspector?.render();
      this.commitChange();
    }
  }

  focusSelected() {
    const entry = this.selectedEntry;
    if (!entry) {
      this.viewport.focusAll();
      return;
    }
    this.viewport.focusEntry(entry);
  }

  focusAll() {
    this.viewport.focusAll();
  }

  resetView() {
    this.viewport.resetView();
  }

  setTool(tool) {
    this.tool = tool;
    this.viewport.setTool(tool);
    this.toolrail?.update();
  }

  useSelectedCamera() {
    const entry = this.selectedEntry;
    if (!entry || entry.type !== 'camera') {
      toast('Selecciona una cámara en la jerarquía o en el timeline.', 'warn', 2200);
      return;
    }
    this.activeCameraId = entry.id;
    this.viewport.setActiveCamera(entry.object);
    this.refreshCameraHud();
    this.inspector?.render();
    toast(`Vista desde ${entry.name}.`, 'info', 2000);
  }

  exitCameraView() {
    if (!this.activeCameraId) return;
    this.activeCameraId = null;
    this.viewport.setActiveCamera(null);
    this.refreshCameraHud();
    this.inspector?.render();
  }

  refreshCameraHud() {
    this.viewport?.updateCameraHud();
  }

  /* ============================================================
     Animación / tiempo
     ============================================================ */

  setTransformFromInspector(channel, axis, value, commit = false) {
    const entry = this.selectedEntry;
    if (!entry) return;
    const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
    const finalValue = channel === 'rotation' ? THREE.MathUtils.degToRad(numeric) : numeric;
    const component = ['x', 'y', 'z'][Number(axis)] || 'x';
    entry.object[channel][component] = finalValue;

    const time = this.currentTime;
    const keyed = this.animation.keyAt(entry, channel, time);
    if (this.autoKey || keyed) {
      const current = this.animation.currentValue(entry, channel);
      this.animation.addKey(entry, channel, time, current);
      this._timelineDirty = true;
    }
    if (commit) {
      if (this._timelineDirty) {
        this.timeline?.render();
        this._timelineDirty = false;
      }
      this.commitChange();
    }
  }

  onGizmoChange() {
    const entry = this.selectedEntry;
    if (!entry || this.exporting) return;
    this.inspector?.syncTransform();
    if (this.autoKey) {
      this.animation.addObjectKey(entry, this.currentTime, CHANNELS, { sample: false });
      this._timelineDirty = true;
    } else {
      let changed = false;
      for (const channel of CHANNELS) {
        if (this.animation.keyAt(entry, channel, this.currentTime)) {
          this.animation.addKey(entry, channel, this.currentTime, this.animation.currentValue(entry, channel));
          changed = true;
        }
      }
      if (changed) this._timelineDirty = true;
    }
  }

  onGizmoDragStart() {
    this._gizmoDragTime = this.currentTime;
  }

  onGizmoDragEnd() {
    if (this._timelineDirty) {
      this.timeline?.render();
      this._timelineDirty = false;
    }
    this.commitChange();
  }

  addKeyframe(entryId = this.selectedId, time = this.currentTime, channel = null, options = {}) {
    const entry = this.objects.get(entryId);
    if (!entry) return;
    this.pause();
    const at = snapTime(clamp(time, 0, this.duration), this.fps);
    const channels = channel ? [channel] : CHANNELS;
    const added = this.animation.addObjectKey(entry, at, channels, { sample: !!options.sample });
    if (!added) return;
    this.selectedId = entry.id;
    this.selectedKey = { id: entry.id, time: at };
    this.animation.evaluate(at);
    this.currentTime = at;
    this.timeline?.render();
    this.timeline?.setPlayhead(at);
    this.inspector?.render();
    this.commitChange();
  }

  addKeyframeAtTime(entryId, time) {
    this.selectedId = entryId;
    this.addKeyframe(entryId, time, null, { sample: true });
  }

  deleteKeyframe(entryId = this.selectedKey?.id, time = this.selectedKey?.time) {
    const entry = this.objects.get(entryId);
    if (!entry || time == null) return;
    const removed = this.animation.removeKeyAt(entry, time);
    if (!removed) return;
    if (this.selectedKey && this.selectedKey.id === entryId && Math.abs(this.selectedKey.time - time) < 0.0006) {
      this.selectedKey = null;
    }
    this.animation.evaluate(this.currentTime);
    this.timeline?.render();
    this.inspector?.render();
    this.commitChange();
  }

  moveKeyframe(entryId, fromTime, toTime) {
    const entry = this.objects.get(entryId);
    if (!entry) return;
    this.pause();
    const target = snapTime(clamp(toTime, 0, this.duration), this.fps);
    if (Math.abs(target - fromTime) < 0.0001) return;
    this.animation.moveKeyAt(entry, fromTime, target);
    if (this.selectedKey?.id === entryId) this.selectedKey = { id: entryId, time: target };
    this.currentTime = target;
    this.animation.evaluate(target);
    this.timeline?.render();
    this.timeline?.setPlayhead(target);
    this.inspector?.render();
  }

  shiftEntryKeys(entryId, originalTracks, delta, commit = false) {
    const entry = this.objects.get(entryId);
    if (!entry) return;
    const clamped = this.animation.clampShiftDelta(entry, delta, this.duration);
    this.animation.applyShiftedTracks(entry, originalTracks, clamped, this.duration);
    if (commit) {
      this.animation.evaluate(this.currentTime);
      this.timeline?.render();
      this.inspector?.render();
      this.commitChange();
    }
  }

  setEasingAt(entryId, time, points, channel = 'all', commit = false) {
    const entry = this.objects.get(entryId);
    if (!entry) return;
    this.animation.setEasingAt(entry, time, points, channel);
    this.animation.evaluate(this.currentTime);
    if (commit) {
      this.timeline?.render();
      this.inspector?.render();
      this.commitChange();
    }
  }

  seek(time, options = {}) {
    const snapped = snapTime(clamp(Number(time) || 0, 0, this.duration), this.fps);
    this.currentTime = snapped;
    if (this.playing && !options.fromPlayback) {
      this.audio.play(snapped);
    }
    this.animation.evaluate(snapped);
    this.timeline?.setPlayhead(snapped);
    this.inspector?.onTimeChanged(snapped);
    this.viewport?.updateSelectionGeometry();
  }

  play() {
    if (this.playing) {
      this.pause();
      return;
    }
    if (this.currentTime >= this.duration - 0.0001) this.seek(0);
    this.playing = true;
    this.audio.play(this.currentTime);
    this.timeline?.setPlaying(true);
    this.topbar?.setPlaying(true);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.audio.stop();
    this.timeline?.setPlaying(false);
    this.topbar?.setPlaying(false);
  }

  stop() {
    this.pause();
    this.seek(0);
  }

  togglePlay() {
    if (this.playing) this.pause();
    else this.play();
  }

  tick(dt) {
    if (!this.playing || this.exporting) return;
    this.currentTime += dt;
    if (this.currentTime >= this.duration) {
      if (this.loop) {
        this.currentTime = 0;
        this.audio.play(0);
      } else {
        this.currentTime = this.duration;
        this.pause();
      }
    }
    this.animation.evaluate(this.currentTime);
    this.timeline?.setPlayhead(this.currentTime);
    this.inspector?.onTimeChanged(this.currentTime);
    this.viewport?.updateSelectionGeometry();
  }

  stepFrame(direction) {
    this.pause();
    this.seek(this.currentTime + direction / this.fps);
  }

  setDuration(value) {
    const duration = clamp(Number(value) || 8, 0.5, 600);
    this.duration = duration;
    if (this.currentTime > duration) this.seek(duration);
    this.timeline?.render();
  }

  setFPS(value) {
    const fps = clamp(Math.round(Number(value) || 30), 1, 120);
    this.fps = fps;
    this.seek(this.currentTime);
    this.timeline?.render();
  }

  setLoop(value) {
    this.loop = !!value;
    this.timeline?.updateTransport();
  }

  setAutoKey(value) {
    this.autoKey = !!value;
    this.topbar?.updateAutoKey();
    this.timeline?.updateAutoKey();
    this.inspector?.render();
  }

  setTimelinePPS(value) {
    this.timelinePPS = clamp(Number(value) || 120, 20, 560);
    this.timeline?.render();
  }

  openDurationDialog() {
    showModal({
      title: 'Duración del proyecto',
      body: `<p>Define la duración total de la animación en segundos.</p>
        <div class="field-row"><label>Duración (s)</label><input id="duration-input" type="number" min="0.5" max="600" step="0.5" value="${this.duration}" /></div>`,
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Aplicar',
          class: 'primary',
          onClick: () => {
            const value = Number(document.getElementById('duration-input')?.value);
            if (Number.isFinite(value)) this.setDuration(value);
          },
        },
      ],
    });
  }

  /* ============================================================
     Audio
     ============================================================ */

  async loadAudioFile(file) {
    if (!file) return;
    try {
      await this.audio.loadFile(file);
      this.timeline?.render();
      toast(`Audio "${this.audio.name}" importado (${this.audio.duration.toFixed(2)}s).`, 'success', 2600);
      this.commitChange();
    } catch (error) {
      console.error(error);
      toast(error.message || 'No se pudo decodificar el audio.', 'error');
    }
  }

  setAudioStart(time) {
    this.audio.setStart(clamp(Number(time) || 0, 0, this.duration));
    this.timeline?.render();
    this.commitChange();
  }

  setAudioVolume(value) {
    this.audio.setVolume(value);
  }

  removeAudio() {
    this.audio.clear();
    this.timeline?.render();
    this.inspector?.render();
    toast('Audio eliminado.', 'info', 1800);
    this.commitChange();
  }

  /* ============================================================
     Imagen de fondo
     ============================================================ */

  async loadBackgroundFile(file) {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      await this.loadBackgroundArrayBuffer(buffer, {
        name: baseName(file.name),
        fileName: file.name,
        mime: file.type || 'image/png',
      });
    } catch (error) {
      console.error('[PEKITA] Fondo no cargado', error);
      toast('No se pudo cargar la imagen de fondo.', 'error', 4000);
    }
  }

  async loadBackgroundArrayBuffer(buffer, meta = {}) {
    const blob = new Blob([buffer], { type: meta.mime || 'image/png' });
    const url = URL.createObjectURL(blob);
    let texture;
    try {
      texture = await new THREE.TextureLoader().loadAsync(url);
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    this.clearBackground({ notify: false, schedule: false });
    this.background = {
      name: meta.name || 'Fondo',
      fileName: meta.fileName || 'background.png',
      mime: meta.mime || blob.type || 'image/png',
      fileBuffer: buffer,
      texture,
      url,
    };
    this.viewport?.setBackgroundImage(texture);
    this.inspector?.render();
    this.scheduleAutosave(1200);
    if (!meta.silent) toast('Imagen de fondo añadida.', 'success', 2000);
  }

  clearBackground(options = {}) {
    const { notify = true, schedule = true } = options;
    if (this.background) {
      if (this.background.url) URL.revokeObjectURL(this.background.url);
      this.background.texture?.dispose?.();
      this.background = null;
    }
    this.viewport?.setBackgroundImage(null);
    if (notify) {
      this.inspector?.render();
      if (schedule) this.scheduleAutosave(1000);
      toast('Fondo eliminado.', 'info', 1600);
    }
  }

  triggerBackgroundImport() {
    document.getElementById('file-background')?.click();
  }

  /* ============================================================
     Autoguardado
     ============================================================ */

  setAutosaveStatus(state, label) {
    this.topbar?.setAutosaveStatus(state, label);
  }

  async restoreAutosave() {
    if (!this.autosaveStore.available) {
      this.setAutosaveStatus('error', 'Sin auto');
      return false;
    }
    try {
      let timer = 0;
      const record = await Promise.race([
        this.autosaveStore.load(),
        new Promise((resolve) => {
          timer = window.setTimeout(() => resolve(null), 6000);
        }),
      ]);
      window.clearTimeout(timer);
      if (!record?.blob) return false;
      this.setAutosaveStatus('saving', 'Cargando');
      const file = new File([record.blob], 'autoguardado.peki', { type: 'application/zip' });
      await loadProjectFile(this, file);
      this.lastAutosaveAt = record.savedAt || Date.now();
      this.setAutosaveStatus('saved', 'Restaurado');
      setTimeout(() => this.setAutosaveStatus('saved', 'Auto'), 3500);
      toast('Proyecto restaurado automáticamente.', 'success', 3000);
      return true;
    } catch (error) {
      console.error('[PEKITA] No se pudo restaurar el autoguardado', error);
      this.setAutosaveStatus('error', 'Error');
      return false;
    }
  }

  initAutosave() {
    if (!this.autosaveStore.available) {
      this.setAutosaveStatus('error', 'Sin auto');
      return;
    }
    this.autosaveReady = true;
    this.setAutosaveStatus('saved', 'Auto');
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.autosaveNow(true);
    });
    window.addEventListener('pagehide', () => this.autosaveNow(true));
    window.clearInterval(this.autosaveInterval);
    this.autosaveInterval = window.setInterval(() => {
      if (this.autosaveDirty) this.autosaveNow();
    }, 15000);
  }

  scheduleAutosave(delay = 1800) {
    if (!this.autosaveReady || this.exporting || this.inSetup || this.restoringHistory) return;
    this.autosaveDirty = true;
    this.setAutosaveStatus('idle', 'Auto');
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => this.autosaveNow(), delay);
  }

  async waitForAutosave(timeout = 20000) {
    if (!this.autosaveSaving) return;
    const start = performance.now();
    while (this.autosaveSaving && performance.now() - start < timeout) {
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    }
  }

  async autosaveNow(force = false) {
    if (!this.autosaveReady || this.exporting || this.inSetup || this.restoringHistory) return;
    if (this.viewport?.capture) return;
    if (!force && document.querySelector('.export-modal')) return;
    if (this.autosaveSaving) {
      this.autosavePending = true;
      return;
    }
    if (!this.autosaveDirty) return;
    this.autosaveSaving = true;
    this.autosaveDirty = false;
    this.autosavePending = false;
    window.clearTimeout(this.autosaveTimer);
    this.setAutosaveStatus('saving', 'Guardando');
    const wasSuspended = this.viewport?.suspended;
    this.viewport?.setSuspended(true);
    try {
      const blob = await buildProjectBlob(this, () => {});
      await this.autosaveStore.save(blob, {
        savedAt: Date.now(),
        duration: this.duration,
        objects: this.entries.length,
      });
      this.lastAutosaveAt = Date.now();
      this.setAutosaveStatus('saved', 'Guardado');
      window.setTimeout(() => {
        if (!this.autosaveDirty && !this.autosaveSaving) this.setAutosaveStatus('saved', 'Auto');
      }, 2400);
    } catch (error) {
      console.error('[PEKITA] Error en autoguardado', error);
      this.autosaveDirty = true;
      this.setAutosaveStatus('error', 'Error');
    } finally {
      this.viewport?.setSuspended(wasSuspended || false);
      this.autosaveSaving = false;
      if (this.autosavePending || this.autosaveDirty) this.scheduleAutosave(900);
    }
  }

  /* ============================================================
     Archivos / proyecto
     ============================================================ */

  bindFileInputs() {
    const importInput = document.getElementById('file-import');
    const projectInput = document.getElementById('file-project');
    const audioInput = document.getElementById('file-audio');
    const backgroundInput = document.getElementById('file-background');

    importInput?.addEventListener('change', async () => {
      const files = [...(importInput.files || [])];
      importInput.value = '';
      await this.importFileList(files);
    });
    projectInput?.addEventListener('change', async () => {
      const file = projectInput.files?.[0];
      projectInput.value = '';
      if (!file) return;
      try {
        await loadProjectFile(this, file);
      } catch (error) {
        console.error(error);
        toast(error.message || 'No se pudo abrir el proyecto.', 'error', 4000);
      }
    });
    audioInput?.addEventListener('change', async () => {
      const file = audioInput.files?.[0];
      audioInput.value = '';
      await this.loadAudioFile(file);
    });
    backgroundInput?.addEventListener('change', async () => {
      const file = backgroundInput.files?.[0];
      backgroundInput.value = '';
      await this.loadBackgroundFile(file);
    });
  }

  triggerImport() {
    document.getElementById('file-import')?.click();
  }

  triggerOpenProject() {
    document.getElementById('file-project')?.click();
  }

  triggerAudioImport() {
    document.getElementById('file-audio')?.click();
  }

  async importFileList(files) {
    if (!files?.length) return;
    toast(`Importando ${files.length} archivo${files.length > 1 ? 's' : ''}…`, 'info', 1600);
    try {
      const { results, errors } = await importFiles(this, files);
      if (results.length) {
        const last = results[results.length - 1].entry;
        this.select(last.id);
        this.viewport.focusEntry(last);
        this.clearHistory();
        this.refreshAll();
        toast(importSummary(results.map((r) => ({ name: r.name, warnings: r.warnings }))), 'success', 3200);
      }
      for (const error of errors) toast(error, 'error', 5000);
      if (!results.length && !errors.length) toast('No se importó ningún modelo.', 'warn');
    } catch (error) {
      console.error(error);
      toast(error.message || 'Error al importar el modelo.', 'error', 4500);
    }
  }

  newProject() {
    const run = async () => {
      this.clearScene();
      this.setupDefaultScene();
      this.refreshAll();
      toast('Nuevo proyecto creado.', 'success', 1800);
    };
    if (!this.entries.length) {
      run();
      return;
    }
    confirmDialog('Nuevo proyecto', 'Se eliminarán los objetos y la animación actual. ¿Continuar?', 'Crear proyecto', { danger: true }).then((ok) => {
      if (ok) run();
    });
  }

  clearScene() {
    this.pause();
    for (const entry of this.entries) {
      if (!entry.parentId && entry.object?.parent) entry.object.parent.remove(entry.object);
      if (entry.object?.isSpotLight && entry.object.target?.parent) entry.object.target.parent.remove(entry.object.target);
    }
    this.objects.clear();
    this.entries = [];
    this.selectedId = null;
    this.selectedKey = null;
    this.activeCameraId = null;
    this.currentTime = 0;
    this.playing = false;
    this.audio.clear();
    this.clearBackground({ notify: false, schedule: false });
    this.viewport.setActiveCamera(null);
    this.viewport.clearSelectionHelpers();
    this.viewport.transform.detach();
    this.viewport.updateStats();
    this.clearHistory();
    this.inspector?.render();
    this.timeline?.render();
    this.refreshCameraHud();
  }

  async saveProject() {
    await saveProject(this);
  }

  openExportDialog() {
    if (document.querySelector('.export-modal')) return;
    openExportDialog(this);
  }

  openAddDialog() {
    const body = document.createElement('div');
    body.innerHTML = `
      <p style="margin-top:0">Añade geometría, luces o cámaras a la escena.</p>
      <div class="export-grid">
        <button class="export-card yellow" data-add="box"><div class="ec-ico">${icon('cube', 18)}</div><div><b>Cubo</b><span>Primitiva base</span></div></button>
        <button class="export-card" data-add="sphere"><div class="ec-ico">${icon('sphere', 18)}</div><div><b>Esfera</b><span>UV sphere</span></div></button>
        <button class="export-card green" data-add="cylinder"><div class="ec-ico">${icon('cylinder', 18)}</div><div><b>Cilindro</b><span>40 lados</span></div></button>
        <button class="export-card purple" data-add="cone"><div class="ec-ico">${icon('cone', 18)}</div><div><b>Cono</b><span>Primitiva</span></div></button>
        <button class="export-card" data-add="torus"><div class="ec-ico">${icon('torus', 18)}</div><div><b>Toro</b><span>Anillo 3D</span></div></button>
        <button class="export-card green" data-add="plane"><div class="ec-ico">${icon('plane', 18)}</div><div><b>Plano</b><span>Suelo / fondo</span></div></button>
        <button class="export-card yellow" data-add="light"><div class="ec-ico">${icon('light', 18)}</div><div><b>Luz</b><span>Direccional</span></div></button>
        <button class="export-card" data-add="camera"><div class="ec-ico">${icon('camera', 18)}</div><div><b>Cámara</b><span>Perspectiva</span></div></button>
        <button class="export-card purple" data-add="empty"><div class="ec-ico">${icon('target', 18)}</div><div><b>Vacío</b><span>Pivote / grupo</span></div></button>
        <button class="export-card green" data-add="background"><div class="ec-ico">${icon('image', 18)}</div><div><b>Fondo</b><span>Imagen de escena</span></div></button>
        <button class="export-card green" data-add="import"><div class="ec-ico">${icon('upload', 18)}</div><div><b>Importar</b><span>GLB, OBJ, BBModel…</span></div></button>
      </div>`;
    const modal = showModal({ title: 'Añadir a la escena', body, wide: true, actions: [{ label: 'Cerrar' }] });
    body.addEventListener('click', (event) => {
      const target = event.target.closest('[data-add]');
      if (!target) return;
      const kind = target.dataset.add;
      modal.close();
      if (['box', 'sphere', 'plane', 'cylinder', 'cone', 'torus', 'empty'].includes(kind)) this.addPrimitive(kind);
      else if (kind === 'light') this.addLight('directional');
      else if (kind === 'camera') this.addCamera();
      else if (kind === 'background') this.triggerBackgroundImport();
      else if (kind === 'import') this.triggerImport();
    });
  }

  openHelp() {
    openHelpModal();
  }

  openAbout() {
    openAboutModal();
  }

  /* ============================================================
     Modificadores
     ============================================================ */

  materialList(entry) {
    const materials = new Set();
    entry?.object?.traverse((node) => {
      if (!node.isMesh) return;
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of list) if (material) materials.add(material);
    });
    return [...materials];
  }

  setMaterialProperty(entry, key, value) {
    if (!entry) return;
    for (const material of this.materialList(entry)) {
      if (key === 'color' || key === 'emissive') material[key]?.set(value);
      else material[key] = value;
      if (key === 'opacity') material.transparent = value < 0.999;
      material.needsUpdate = true;
    }
  }

  setLightProperty(entry, key, value) {
    if (!entry?.object?.isLight) return;
    if (key === 'color') entry.object.color.set(value);
    else entry.object[key] = value;
    entry.object.shadow?.map?.dispose?.();
    if (entry.object.shadow?.map) entry.object.shadow.map = null;
    this.viewport.updateSelection(entry);
  }

  setCameraProperty(entry, key, value) {
    if (!entry?.object?.isCamera) return;
    entry.object[key] = value;
    entry.object.updateProjectionMatrix();
    this.viewport.updateSelection(entry);
  }

  setShadowProperty(entry, key, value) {
    if (!entry) return;
    let changed = false;
    entry.object.traverse((node) => {
      if (node.isMesh) {
        node[key] = !!value;
        changed = true;
      }
    });
    if (entry.object.isLight) {
      entry.object[key] = !!value;
      changed = true;
    }
    if (changed) {
      this.viewport.updateSelection(entry);
      this.inspector?.render();
      this.commitChange();
    }
  }

  toggleWireframe(entry = this.selectedEntry) {
    if (!entry) return;
    const materials = this.materialList(entry);
    const next = !materials.some((material) => material.wireframe);
    for (const material of materials) {
      material.wireframe = next;
      material.needsUpdate = true;
    }
    entry.modifierState.wireframe = next;
    this.inspector?.render();
    this.commitChange();
  }

  toggleFlatShading(entry = this.selectedEntry) {
    if (!entry) return;
    const materials = this.materialList(entry);
    const next = !materials.some((material) => material.flatShading);
    for (const material of materials) {
      material.flatShading = next;
      material.needsUpdate = true;
    }
    entry.modifierState.flatShading = next;
    this.inspector?.render();
    this.commitChange();
  }

  applySmooth(entry = this.selectedEntry) {
    if (!entry) return;
    entry.object.traverse((node) => {
      if (!node.isMesh || !node.geometry) return;
      if (!entry.baseGeometry) entry.baseGeometry = node.geometry.clone();
      try {
        const merged = mergeVertices(node.geometry.clone());
        merged.computeVertexNormals();
        node.geometry = merged;
      } catch (error) {
        console.warn(error);
      }
    });
    toast('Suavizado aplicado a la geometría.', 'success', 1800);
    this.inspector?.render();
  }

  applyArray(count = 3, offset = 1.2, axis = 'x') {
    const entry = this.selectedEntry;
    if (!entry) return;
    const n = clamp(Math.round(count), 2, 24);
    const vector = new THREE.Vector3(axis === 'x' ? offset : 0, axis === 'y' ? offset : 0, axis === 'z' ? offset : 0);
    for (let i = 1; i < n; i += 1) {
      const clone = this.cloneEntry(entry, vector.clone().multiplyScalar(i));
      clone.tracks = createTracks();
      for (const child of this.subtreeEntries(clone)) child.tracks = createTracks();
    }
    this.clearHistory();
    this.refreshAll();
    toast(`Array de ${n} objetos aplicado.`, 'success', 2200);
  }

  applyMirror(axis = 'x') {
    const entry = this.selectedEntry;
    if (!entry) return;
    const clone = this.cloneEntry(entry, new THREE.Vector3());
    clone.object.scale[['x', 'y', 'z'].includes(axis) ? axis : 'x'] *= -1;
    clone.object.traverse((node) => {
      if (!node.isMesh) return;
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of list) if (material) material.side = THREE.DoubleSide;
    });
    clone.object.position.x = entry.object.position.x;
    clone.object.position.y = entry.object.position.y;
    clone.object.position.z = entry.object.position.z;
    this.select(clone.id);
    this.clearHistory();
    this.refreshAll();
    toast(`Espejo en ${axis.toUpperCase()} aplicado.`, 'success', 2000);
  }

  /* ============================================================
     Historial
     ============================================================ */

  serializeState() {
    return {
      objects: this.entries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        visible: entry.visible,
        color: entry.color,
        locked: entry.locked,
        position: entry.object.position.toArray(),
        rotation: [entry.object.rotation.x, entry.object.rotation.y, entry.object.rotation.z],
        scale: entry.object.scale.toArray(),
        tracks: deepClone(entry.tracks),
      })),
      selectedId: this.selectedId,
      currentTime: this.currentTime,
    };
  }

  pushHistory() {
    if (this.inSetup || this.restoringHistory || this.exporting) return;
    const snapshot = this.serializeState();
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snapshot);
    if (this.history.length > 60) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.topbar?.updateHistory();
  }

  commitChange() {
    this.pushHistory();
    this.scheduleAutosave(1800);
  }

  clearHistory() {
    this.history = [];
    this.historyIndex = -1;
    if (!this.inSetup && this.entries.length) this.pushHistory();
    else this.topbar?.updateHistory();
  }

  applySnapshot(snapshot) {
    if (!snapshot) return;
    this.restoringHistory = true;
    for (const data of snapshot.objects) {
      const entry = this.objects.get(data.id);
      if (!entry) continue;
      entry.name = data.name;
      entry.object.name = data.name;
      entry.visible = data.visible;
      entry.object.visible = data.visible;
      entry.color = data.color;
      entry.locked = data.locked;
      entry.object.position.fromArray(data.position);
      entry.object.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2]);
      entry.object.scale.fromArray(data.scale);
      entry.tracks = deepClone(data.tracks);
    }
    this.selectedId = this.objects.has(snapshot.selectedId) ? snapshot.selectedId : null;
    this.currentTime = clamp(snapshot.currentTime, 0, this.duration);
    this.animation.evaluate(this.currentTime);
    this.viewport.updateSelection(this.selectedEntry);
    this.timeline?.render();
    this.inspector?.render();
    this.viewport.updateStats();
    this.restoringHistory = false;
    this.topbar?.updateHistory();
  }

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    this.applySnapshot(this.history[this.historyIndex]);
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex += 1;
    this.applySnapshot(this.history[this.historyIndex]);
  }

  /* ============================================================
     Teclado / refresco
     ============================================================ */

  bindShortcuts() {
    window.addEventListener('keydown', (event) => {
      const typing = event.target?.matches?.('input, textarea, select, [contenteditable="true"]');
      if (typing) return;
      if (event.key === 'Escape') {
        if (document.querySelector('.modal-backdrop')) return;
        if (this.activeCameraId) this.exitCameraView();
        else this.select(null);
        return;
      }
      if (document.querySelector('.modal-backdrop')) return;

      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl) {
        if (event.code === 'KeyZ') {
          event.preventDefault();
          event.shiftKey ? this.redo() : this.undo();
        } else if (event.code === 'KeyY') {
          event.preventDefault();
          this.redo();
        } else if (event.code === 'KeyN') {
          event.preventDefault();
          this.newProject();
        } else if (event.code === 'KeyS') {
          event.preventDefault();
          this.saveProject();
        } else if (event.code === 'KeyO') {
          event.preventDefault();
          this.triggerOpenProject();
        } else if (event.code === 'KeyI') {
          event.preventDefault();
          this.triggerImport();
        } else if (event.code === 'KeyE') {
          event.preventDefault();
          this.openExportDialog();
        } else if (event.code === 'KeyD') {
          event.preventDefault();
          this.duplicateSelected();
        }
        return;
      }

      switch (event.code) {
        case 'KeyQ':
          this.setTool('select');
          break;
        case 'KeyW':
          this.setTool('translate');
          break;
        case 'KeyE':
          this.setTool('rotate');
          break;
        case 'KeyR':
          this.setTool('scale');
          break;
        case 'Space':
          event.preventDefault();
          this.togglePlay();
          break;
        case 'KeyK':
          event.preventDefault();
          this.addKeyframe();
          break;
        case 'KeyF':
          this.focusSelected();
          break;
        case 'Home':
          event.preventDefault();
          this.focusAll();
          break;
        case 'Delete':
        case 'Backspace':
          event.preventDefault();
          if (this.selectedKey) this.deleteKeyframe();
          else this.deleteSelected();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          this.stepFrame(event.shiftKey ? -this.fps : -1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          this.stepFrame(event.shiftKey ? this.fps : 1);
          break;
        default:
          break;
      }
    });
  }

  refreshAll() {
    this.topbar?.refresh();
    this.toolrail?.update();
    this.inspector?.render();
    this.timeline?.render();
    this.viewport?.updateStats();
    this.viewport?.updateSelection(this.selectedEntry);
    this.scheduleAutosave(2600);
  }

  refreshUI() {
    this.refreshAll();
  }

  /* ============================================================
     Utilidades de exportación
     ============================================================ */

  prepareForExport() {
    this.pause();
    this.exporting = true;
    this.viewport.setSuspended(true);
  }

  finishExport() {
    this.exporting = false;
    this.viewport.setSuspended(false);
    this.viewport.endCapture();
    this.refreshAll();
  }

  getExportTimecode(time) {
    return formatTimecode(time, this.fps);
  }

  getEntryIcon(entry) {
    return TYPE_ICON[entry?.type] || 'cube';
  }
}
