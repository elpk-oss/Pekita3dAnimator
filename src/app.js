import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Viewport } from './core/viewport.js';
import { AnimationSystem, CHANNELS, createTracks } from './core/animation.js';
import { AudioSystem } from './core/audio.js';
import { AutoSaveStore } from './core/autosave.js';
import { importFiles, importSummary } from './core/importer.js';
import { buildProjectBlob, exportGLB, exportPNG, exportStill, exportVideo, loadProjectFile, openExportDialog, saveProject } from './core/exporter.js';
import { PRIMITIVES, buildPrimitiveGeometry, defaultParams, normalizeParams, primitiveDef, primitiveId } from './core/primitives.js';
import { MATERIAL_PRESETS } from './core/materials.js';
import { backgroundPreset, presetImageBuffer } from './core/backgrounds.js';
import { normalMapFromDataUrl } from './core/textures.js';
import { Topbar } from './ui/topbar.js';
import { Toolrail } from './ui/toolrail.js';
import { MobileBar } from './ui/mobilebar.js';
import { Inspector } from './ui/inspector.js';
import { Timeline } from './ui/timeline.js';
import { openHome } from './ui/home.js';
import { openTextureEditor } from './ui/texture.js';
import { confirmDialog, openAboutModal, openHelpModal, showModal, toast } from './ui/ui.js';
import { icon } from './icons.js';
import { baseName, clamp, deepClone, escapeHtml, fileExt, formatTimecode, h, snapTime, uid } from './utils.js';

const MATERIAL_PRESET_IDS = MATERIAL_PRESETS.map((preset) => preset.id);

/** Clona un objeto para el historial: geometría compartida, materiales propios. */
function cloneForHistory(object) {
  const clone = object.clone(true);
  clone.traverse((node) => {
    if (!node.isMesh) return;
    if (Array.isArray(node.material)) node.material = node.material.map((material) => (material ? material.clone() : material));
    else if (node.material) node.material = node.material.clone();
  });
  return clone;
}

const PALETTE = ['#f5c542', '#5aa2ff', '#5ad68c', '#b18cff', '#ff9f5a', '#54d6d6', '#ff7bb0', '#9bb7ff'];
const TYPE_ICON = { mesh: 'cube', model: 'layers', group: 'folder', light: 'light', camera: 'camera', audio: 'audio' };

export class App {
  constructor(root, options = {}) {
    this.root = root;
    this.mobile = !!options.mobile;
    this.objects = new Map();
    this.entries = [];
    this.entryCounter = 0;
    this.selectedId = null;
    this.selectedKey = null;
    this.selectedKeys = [];
    this.keyClipboard = null;
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
    this.historyLimit = 40;
    this.restoringHistory = false;
    this.background = null;
    this.backgrounds = new Map();
    this.textures = new Map();
    this.renderSize = { width: 1920, height: 1080 };
    this.homeOpen = false;
    this.homeScreen = null;
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

    document.body.classList.toggle('is-mobile', this.mobile);
    if (this.mobile) this.mobileBar = new MobileBar(this, this.root);

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
      primitive: options.primitive || null,
      textureId: null,
      textureRepeat: 1,
      normalMapId: null,
      normalScale: 1,
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
    const id = primitiveId(kind);
    const def = PRIMITIVES[id] || PRIMITIVES.box;
    const params = normalizeParams(id, {
      ...defaultParams(id),
      ...(options.params || {}),
      ...(options.size != null ? { size: options.size } : {}),
    });
    const geometry = buildPrimitiveGeometry(id, params);

    let object;
    if (!geometry) {
      object = new THREE.Group();
    } else {
      const material = new THREE.MeshStandardMaterial({
        color: options.color ?? def.color,
        roughness: options.roughness ?? 0.4,
        metalness: options.metalness ?? 0.16,
      });
      object = new THREE.Mesh(geometry, material);
      object.castShadow = true;
      object.receiveShadow = true;
      if (def.rotation) object.rotation.set(...def.rotation);
    }

    const position = options.position || [0, def.ground(params), 0];
    object.position.set(position[0], position[1], position[2]);
    if (options.rotation) object.rotation.set(options.rotation[0], options.rotation[1], options.rotation[2]);
    const entry = this.addEntry(object, {
      name: options.name || def.name,
      type: geometry ? 'mesh' : 'group',
      color: options.color ? `#${options.color.toString(16).padStart(6, '0')}` : undefined,
    });
    entry.primitive = geometry ? { kind: id, params } : null;

    if (options.select !== false) {
      this.select(entry.id);
      this.commitChange();
      this.refreshAll();
      toast(`${entry.name} añadido.`, 'success', 1600);
    }
    return entry;
  }

  /** Vuelve a construir la geometría de una pieza con nuevos parámetros. */
  updatePrimitive(entry = this.selectedEntry, params = {}, options = {}) {
    if (!entry?.primitive) return false;
    const id = entry.primitive.kind;
    const def = primitiveDef(id);
    if (!def?.build) return false;
    const next = normalizeParams(id, { ...entry.primitive.params, ...params });
    const geometry = buildPrimitiveGeometry(id, next);
    if (!geometry) return false;
    entry.object.traverse((node) => {
      if (node.isMesh) node.geometry = geometry;
    });
    entry.primitive.params = next;
    if (options.ground) {
      // Mantiene la pieza apoyada en el suelo al cambiar el tamaño.
      entry.object.position.y = def.ground(next);
    }
    if (options.syncTransform !== false) this.inspector?.syncTransform();
    this.viewport?.updateSelectionGeometry();
    if (options.render !== false) this.inspector?.render();
    if (options.commit !== false) this.commitChange();
    return true;
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
      this.commitChange();
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
      this.commitChange();
      this.refreshAll();
      toast(`${entry.name} añadida.`, 'success', 1600);
    }
    return entry;
  }

  select(id, options = {}) {
    if (id && !this.objects.has(id)) id = null;
    this.selectedId = id || null;
    this.selectedKey = null;
    this.selectedKeys = [];
    const entry = this.selectedEntry;
    this.viewport?.updateSelection(entry);
    this.inspector?.render();
    this.timeline?.render();
    if (options.focus) this.focusSelected();
  }

  selectKey(entryId, time, options = {}) {
    const entry = this.objects.get(entryId);
    if (!entry) return;
    if (options.additive) {
      this.toggleKeySelected(entryId, time);
      return;
    }
    this.selectedId = entryId;
    this.selectedKeys = [{ entryId, time }];
    this.selectedKey = { id: entryId, time };
    this.viewport?.updateSelection(entry);
    this.inspector?.render();
    this.timeline?.render();
    if (options.seek !== false) this.seek(time);
  }

  /* ============================================================
     Selección múltiple de keyframes
     ============================================================ */

  isKeySelected(entryId, time) {
    return this.selectedKeys.some(
      (item) => item.entryId === entryId && Math.abs(item.time - time) < 0.0006,
    );
  }

  /** Deja la selección de keyframes en la lista indicada (sin duplicados). */
  setKeySelection(list, options = {}) {
    const seen = new Set();
    const clean = [];
    for (const item of list || []) {
      if (!item || !this.objects.has(item.entryId)) continue;
      const time = Number(item.time);
      if (!Number.isFinite(time)) continue;
      const key = `${item.entryId}@${time.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      clean.push({ entryId: item.entryId, time });
    }
    clean.sort((a, b) => {
      if (a.entryId !== b.entryId) {
        const ai = this.entries.findIndex((entry) => entry.id === a.entryId);
        const bi = this.entries.findIndex((entry) => entry.id === b.entryId);
        return ai - bi;
      }
      return a.time - b.time;
    });
    this.selectedKeys = clean;
    if (clean.length) {
      const primary = options.primary || clean[0];
      this.selectedKey = { id: primary.entryId, time: primary.time };
      this.selectedId = primary.entryId;
      const entry = this.objects.get(primary.entryId);
      if (entry) this.viewport?.updateSelection(entry);
    } else {
      this.selectedKey = null;
    }
    this.timeline?.render();
    this.inspector?.render();
    if (options.seek && this.selectedKey) this.seek(this.selectedKey.time);
  }

  toggleKeySelected(entryId, time) {
    if (this.isKeySelected(entryId, time)) {
      this.setKeySelection(
        this.selectedKeys.filter(
          (item) => !(item.entryId === entryId && Math.abs(item.time - time) < 0.0006),
        ),
      );
    } else {
      this.setKeySelection([...this.selectedKeys, { entryId, time }], {
        primary: { entryId, time },
      });
    }
  }

  /** Selecciona todos los keyframes del objeto activo (o de todos si no hay). */
  selectAllKeys() {
    const entries = this.selectedEntry
      ? [this.selectedEntry]
      : this.entries.filter((entry) => this.animation.hasAnyKeys(entry));
    const list = [];
    for (const entry of entries) {
      for (const time of this.animation.allTimes(entry)) list.push({ entryId: entry.id, time });
    }
    if (!list.length) {
      toast('No hay keyframes para seleccionar.', 'warn', 1900);
      return;
    }
    this.setKeySelection(list);
    toast(`${list.length} keyframes seleccionados.`, 'info', 1500);
  }

  /** Elimina todos los keyframes seleccionados de una vez. */
  deleteSelectedKeys() {
    if (!this.selectedKeys.length) return;
    let removed = 0;
    for (const { entryId, time } of this.selectedKeys) {
      const entry = this.objects.get(entryId);
      if (!entry) continue;
      removed += this.animation.removeKeyAt(entry, time) ? 1 : 0;
    }
    if (!removed) {
      this.setKeySelection([]);
      return;
    }
    this.animation.evaluate(this.currentTime);
    this.setKeySelection([]);
    this.timeline?.render();
    this.inspector?.render();
    this.commitChange();
    toast(`${removed} ${removed === 1 ? 'keyframe eliminado' : 'keyframes eliminados'}.`, 'info', 1500);
  }

  /** Copia los keyframes seleccionados (valores + easing) al portapapeles interno. */
  copyKeys() {
    const items = new Map();
    let anchor = Infinity;
    let count = 0;
    for (const { entryId, time } of this.selectedKeys) {
      const entry = this.objects.get(entryId);
      if (!entry) continue;
      const channels = [];
      for (const channel of CHANNELS) {
        const key = (entry.tracks?.[channel]?.keys || []).find(
          (item) => Math.abs(item.time - time) < 0.0006,
        );
        if (!key) continue;
        channels.push({
          channel,
          time: key.time,
          value: [...key.value],
          easing: key.easing ? [...key.easing] : null,
        });
      }
      if (!channels.length) continue;
      anchor = Math.min(anchor, time);
      count += 1;
      const bucket = items.get(entryId) || { entryId, name: entry.name, keys: [] };
      bucket.keys.push(...channels);
      items.set(entryId, bucket);
    }
    if (!count) {
      toast('Selecciona uno o varios keyframes para copiar.', 'warn', 2200);
      return false;
    }
    this.keyClipboard = { anchor: Number.isFinite(anchor) ? anchor : 0, count, items: [...items.values()] };
    toast(`${count} ${count === 1 ? 'keyframe copiado' : 'keyframes copiados'}.`, 'success', 1600);
    return true;
  }

  /** Pega los keyframes copiados a partir del cabezal de reproducción. */
  pasteKeys(time = this.currentTime) {
    const clip = this.keyClipboard;
    if (!clip || !clip.items?.length) {
      toast('No hay keyframes copiados (Ctrl+C sobre la línea de tiempo).', 'warn', 2600);
      return;
    }
    this.pause();
    const base = snapTime(clamp(Number(time) || 0, 0, this.duration), this.fps);
    const pasted = [];
    let count = 0;
    for (const item of clip.items) {
      const entry = this.objects.get(item.entryId);
      if (!entry) continue;
      for (const key of item.keys) {
        const at = snapTime(
          clamp(base + (key.time - clip.anchor), 0, this.duration),
          this.fps,
        );
        const added = this.animation.addKey(entry, key.channel, at, [...key.value], key.easing || undefined);
        if (!added) continue;
        count += 1;
        pasted.push({ entryId: entry.id, time: at });
      }
    }
    if (!count) {
      toast('No se pudo pegar: el objeto original ya no existe.', 'warn', 2600);
      return;
    }
    this.animation.evaluate(base);
    this.currentTime = base;
    this.timeline?.setPlayhead(base);
    this.setKeySelection(pasted);
    this.timeline?.render();
    this.inspector?.render();
    this.commitChange();
    toast(`${count} ${count === 1 ? 'keyframe pegado' : 'keyframes pegados'}.`, 'success', 1700);
  }

  /** Prepara el arrastre de varios keyframes a la vez (snapshot de los tracks). */
  startKeyDrag() {
    const ids = new Set(this.selectedKeys.map((item) => item.entryId));
    const tracks = new Map();
    for (const id of ids) {
      const entry = this.objects.get(id);
      if (entry) tracks.set(id, deepClone(entry.tracks));
    }
    this._keyDrag = { tracks, keys: this.selectedKeys.map((item) => ({ ...item })) };
  }

  /** Mueve los keyframes seleccionados `delta` segundos desde el inicio del arrastre. */
  applyKeyDrag(delta) {
    const state = this._keyDrag;
    if (!state) return;
    for (const [id, tracks] of state.tracks) {
      const entry = this.objects.get(id);
      if (entry) entry.tracks = deepClone(tracks);
    }
    const moved = [];
    for (const key of state.keys) {
      const entry = this.objects.get(key.entryId);
      if (!entry) continue;
      const target = snapTime(clamp(key.time + delta, 0, this.duration), this.fps);
      this.animation.moveKeyAt(entry, key.time, target);
      moved.push({ entryId: key.entryId, time: target });
    }
    this.selectedKeys = moved;
    this.selectedKey = moved.length ? { id: moved[0].entryId, time: moved[0].time } : null;
    this.animation.evaluate(this.currentTime);
    this.timeline?.render();
  }

  endKeyDrag(commit = true) {
    if (!this._keyDrag) return;
    this._keyDrag = null;
    this.animation.evaluate(this.currentTime);
    this.timeline?.render();
    this.inspector?.render();
    if (commit) this.commitChange();
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
    this.selectedKeys = [];
    this.viewport.clearSelectionHelpers();
    this.viewport.transform.detach();
    this.commitChange();
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
    this.commitChange();
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
    this.commitChange();
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
    this.commitChange();
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
      this.commitChange();
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
    this.commitChange();
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
    this.selectedKeys = [{ entryId: entry.id, time: at }];
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
    this.selectedKeys = this.selectedKeys.filter(
      (item) => !(item.entryId === entryId && Math.abs(item.time - time) < 0.0006),
    );
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
    this.selectedKeys = this.selectedKeys.map((item) =>
      item.entryId === entryId && Math.abs(item.time - fromTime) < 0.0006
        ? { entryId, time: target }
        : item,
    );
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
    this.mobileBar?.update();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.audio.stop();
    this.timeline?.setPlaying(false);
    this.topbar?.setPlaying(false);
    this.mobileBar?.update();
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

  /** Diálogo rápido para el tamaño de render del proyecto. */
  openRenderSizeDialog() {
    const presets = [
      { label: 'Horizontal', width: 1920, height: 1080 },
      { label: 'Vertical', width: 1080, height: 1920 },
      { label: 'Cuadrado', width: 1080, height: 1080 },
      { label: 'Retrato', width: 1080, height: 1350 },
      { label: 'HD', width: 1280, height: 720 },
      { label: '4K', width: 3840, height: 2160 },
    ];
    let width = this.renderSize.width;
    let height = this.renderSize.height;
    const body = document.createElement('div');
    body.innerHTML = `
      <p style="margin-top:0">Este tamaño se usa al exportar imagen y video.</p>
      <div class="home-sizes compact" id="render-presets">
        ${presets.map((p) => `<button class="home-size" data-w="${p.width}" data-h="${p.height}"><b>${p.label}</b><span>${p.width}×${p.height}</span></button>`).join('')}
      </div>
      <div class="size-row">
        <input type="number" id="render-width" min="64" max="7680" step="1" value="${width}" />
        <button class="btn sm" id="render-swap" title="Girar">${icon('repeat', 12)}</button>
        <input type="number" id="render-height" min="64" max="7680" step="1" value="${height}" />
      </div>
      <p class="mod-desc" id="render-hint"></p>
    `;
    const widthInput = body.querySelector('#render-width');
    const heightInput = body.querySelector('#render-height');
    const hint = body.querySelector('#render-hint');
    const sync = () => {
      widthInput.value = String(width);
      heightInput.value = String(height);
      hint.textContent = `${width}×${height} px · ${((width * height) / 1e6).toFixed(2)} MP`;
      body.querySelectorAll('#render-presets .home-size').forEach((button) => {
        button.classList.toggle('selected', Number(button.dataset.w) === width && Number(button.dataset.h) === height);
      });
    };
    sync();
    widthInput.addEventListener('change', () => {
      width = clamp(Math.round(Number(widthInput.value) || width), 64, 7680);
      sync();
    });
    heightInput.addEventListener('change', () => {
      height = clamp(Math.round(Number(heightInput.value) || height), 64, 7680);
      sync();
    });
    body.querySelector('#render-swap').addEventListener('click', () => {
      const w = width;
      width = height;
      height = w;
      sync();
    });
    body.querySelectorAll('#render-presets .home-size').forEach((button) => {
      button.addEventListener('click', () => {
        width = Number(button.dataset.w);
        height = Number(button.dataset.h);
        sync();
      });
    });
    showModal({
      title: 'Tamaño de render',
      body,
      wide: true,
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Aplicar',
          class: 'primary',
          onClick: () => {
            this.setRenderSize(width, height);
            this.inspector?.render();
            toast(`Render en ${this.renderSizeLabel}.`, 'success', 2000);
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
    this.background = this.registerBackground({
      id: meta.id || uid('bg'),
      presetId: meta.presetId || null,
      name: meta.name || 'Fondo',
      fileName: meta.fileName || 'background.png',
      mime: meta.mime || blob.type || 'image/png',
      fileBuffer: buffer,
      texture,
      url,
    });
    this.viewport?.setBackgroundImage(texture);
    this.inspector?.render();
    this.scheduleAutosave(1200);
    if (!meta.silent) toast('Imagen de fondo añadida.', 'success', 2000);
    return this.background;
  }

  /** Guarda el fondo en memoria para poder recuperarlo al deshacer. */
  registerBackground(record) {
    this.backgrounds.set(record.id, record);
    while (this.backgrounds.size > 5) {
      const oldest = this.backgrounds.keys().next().value;
      if (oldest === this.background?.id || oldest === record.id) break;
      const stale = this.backgrounds.get(oldest);
      if (stale?.url) URL.revokeObjectURL(stale.url);
      stale?.texture?.dispose?.();
      this.backgrounds.delete(oldest);
    }
    return record;
  }

  /** Fondos listos para usar (croma, cielo, estudio…). */
  async setBackgroundPreset(id, options = {}) {
    if (!id) {
      this.clearBackground(options.silent ? { notify: false, schedule: true } : undefined);
      return null;
    }
    try {
      const generated = await presetImageBuffer(id);
      const record = await this.loadBackgroundArrayBuffer(generated.buffer, {
        id: generated.id,
        presetId: generated.presetId,
        name: generated.name,
        fileName: generated.fileName,
        mime: generated.mime,
        silent: true,
      });
      if (!options.silent) toast(`Fondo "${generated.name}" aplicado.`, 'success', 2000);
      return record;
    } catch (error) {
      console.error('[PEKITA] Fondo no generado', error);
      toast('No se pudo generar el fondo.', 'error', 3000);
      return null;
    }
  }

  clearBackground(options = {}) {
    const { notify = true, schedule = true } = options;
    if (this.background) {
      // El registro conserva la textura para poder volver con Ctrl+Z.
      if (!this.backgrounds.has(this.background.id)) {
        if (this.background.url) URL.revokeObjectURL(this.background.url);
        this.background.texture?.dispose?.();
      } else if (this.background.url) {
        // La URL se reutiliza mientras el registro viva.
      }
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
    if (!this.autosaveReady || this.exporting || this.inSetup || this.restoringHistory || this.homeOpen) return;
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
    if (!this.autosaveReady || this.exporting || this.inSetup || this.restoringHistory || this.homeOpen) return;
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
    const textureInput = document.getElementById('file-texture');
    const normalInput = document.getElementById('file-normal');

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
    textureInput?.addEventListener('change', async () => {
      const file = textureInput.files?.[0];
      textureInput.value = '';
      await this.loadTextureFile(file);
    });
    normalInput?.addEventListener('change', async () => {
      const file = normalInput.files?.[0];
      normalInput.value = '';
      await this.loadNormalMapFile(file);
    });
  }

  triggerImport() {
    document.getElementById('file-import')?.click();
  }

  /** Importa una imagen como textura del objeto seleccionado. */
  triggerTextureImport() {
    if (!this.selectedEntry) {
      toast('Selecciona primero una pieza.', 'warn', 2200);
      return;
    }
    document.getElementById('file-texture')?.click();
  }

  /** Importa una imagen como mapa de normales del objeto seleccionado. */
  triggerNormalImport() {
    if (!this.selectedEntry) {
      toast('Selecciona primero una pieza.', 'warn', 2200);
      return;
    }
    document.getElementById('file-normal')?.click();
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
        this.commitChange();
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

  /* ============================================================
     Proyecto / pantalla principal
     ============================================================ */

  /** Tamaño de render (imagen y video). */
  setRenderSize(width, height) {
    const w = clamp(Math.round(Number(width) || 1920), 64, 7680);
    const h = clamp(Math.round(Number(height) || 1080), 64, 7680);
    this.renderSize = { width: w, height: h };
    return this.renderSize;
  }

  get renderSizeLabel() {
    return `${this.renderSize.width}×${this.renderSize.height}`;
  }

  /** Crea un proyecto nuevo sin preguntar (lo usa la pantalla principal). */
  startNewProject(options = {}) {
    const { width, height, fps, duration, empty = false, background = null } = options;
    if (width && height) this.setRenderSize(width, height);
    if (Number.isFinite(Number(fps))) this.fps = clamp(Math.round(Number(fps)), 1, 120);
    if (Number.isFinite(Number(duration))) this.duration = clamp(Number(duration), 0.5, 600);
    this.clearScene();
    if (empty) {
      this.currentTime = 0;
      this.clearHistory();
      this.select(null);
    } else {
      this.setupDefaultScene();
    }
    this.refreshAll();
    if (background) this.setBackgroundPreset(background);
    return true;
  }

  async hasAutosave() {
    if (!this.autosaveStore.available) return false;
    try {
      const record = await this.autosaveStore.load();
      return record?.blob ? { savedAt: record.savedAt || 0, objects: record.meta?.objects || 0 } : false;
    } catch {
      return false;
    }
  }

  /** Abre (o reabre) la pantalla principal de inicio. */
  openHomeScreen(options = {}) {
    if (this.homeScreen?.node?.isConnected) return this.homeScreen;
    const instance = openHome(this, {
      hasAutosave: options.hasAutosave !== false && !!options.autosave,
      autosaveLabel: options.autosaveLabel || '',
    });
    this.homeScreen = instance;
    return instance;
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
    this.selectedKeys = [];
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

  /** Aplica un conjunto de propiedades a todos los materiales de la pieza. */
  applyMaterialPreset(entry = this.selectedEntry, presetId) {
    const preset = MATERIAL_PRESETS.find((item) => item.id === presetId);
    if (!entry || !preset) return;
    const materials = this.materialList(entry);
    if (!materials.length) {
      toast('Este objeto no tiene materiales editables.', 'warn', 2200);
      return;
    }
    // Partimos de una base neutra para que un preset no arrastre los valores
    // del anterior (opacidad, brillo emisivo…).
    const base = { opacity: 1, transparent: false, emissive: '#000000', emissiveIntensity: 1 };
    for (const material of materials) {
      for (const [key, value] of Object.entries(base)) {
        if (key === 'emissive') material.emissive?.set(value);
        else material[key] = value;
      }
      for (const [key, value] of Object.entries(preset.props)) {
        if (key === 'color' || key === 'emissive') material[key]?.set(value);
        else material[key] = value;
      }
      material.transparent = (preset.props.opacity ?? 1) < 0.999;
      material.needsUpdate = true;
    }
    this.inspector?.render();
    this.commitChange();
    toast(`Material "${preset.name}" aplicado.`, 'success', 1800);
  }

  /* ============================================================
     Texturas por objeto
     ============================================================ */

  registerTexture(dataUrl, name = 'Textura') {
    const id = uid('tex');
    const record = { id, name, dataUrl };
    this.textures.set(id, record);
    return record;
  }

  /** Aplica una textura (data URL) al objeto seleccionado. */
  async applyTexture(dataUrl, name = 'Textura', options = {}) {
    const entry = options.entry || this.selectedEntry;
    if (!entry) {
      toast('Selecciona una pieza para aplicar la textura.', 'warn', 2400);
      return null;
    }
    const meshes = [];
    entry.object.traverse((node) => {
      if (node.isMesh) meshes.push(node);
    });
    if (!meshes.length) {
      toast('Este objeto no tiene caras donde pintar.', 'warn', 2400);
      return null;
    }
    let texture;
    try {
      texture = await new THREE.TextureLoader().loadAsync(dataUrl);
    } catch (error) {
      console.error('[PEKITA] Textura no cargada', error);
      toast('No se pudo leer la textura.', 'error', 3000);
      return null;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    texture.needsUpdate = true;

    const record = options.record || this.registerTexture(dataUrl, name);
    const repeat = clamp(Number(options.repeat ?? entry.textureRepeat ?? 1) || 1, 0.05, 24);
    texture.repeat.set(repeat, repeat);
    for (const mesh of meshes) {
      const apply = (material) => {
        if (!material) return material;
        const copy = material.clone();
        copy.map = texture;
        copy.color?.set('#ffffff');
        copy.needsUpdate = true;
        return copy;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(apply) : apply(mesh.material);
    }
    entry.textureId = record.id;
    entry.textureRepeat = repeat;
    this.viewport?.updateStats();
    this.inspector?.render();
    this.commitChange();
    if (!options.silent) toast(`Textura "${name}" aplicada.`, 'success', 2200);
    return record;
  }

  async loadTextureFile(file, options = {}) {
    if (!file) return null;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen.'));
      reader.readAsDataURL(file);
    });
    return this.applyTexture(dataUrl, baseName(file.name) || 'Textura', options);
  }

  /* ---------- Mapa de normales (relieve sin añadir geometría) ---------- */

  /** Aplica un mapa de normales (data URL) al objeto: importado o generado. */
  async applyNormalMap(dataUrl, name = 'Mapa de normales', options = {}) {
    const entry = options.entry || this.selectedEntry;
    if (!entry) {
      toast('Selecciona una pieza para aplicarle el mapa de normales.', 'warn', 2400);
      return null;
    }
    const meshes = [];
    entry.object?.traverse((node) => {
      if (node.isMesh) meshes.push(node);
    });
    if (!meshes.length) {
      toast('Este objeto no tiene caras donde aplicar el relieve.', 'warn', 2400);
      return null;
    }
    let texture;
    try {
      texture = await new THREE.TextureLoader().loadAsync(dataUrl);
    } catch (error) {
      console.error('[PEKITA] Mapa de normales no cargado', error);
      toast('No se pudo leer el mapa de normales.', 'error', 3000);
      return null;
    }
    // Un mapa de normales guarda direcciones, no color: nunca en sRGB.
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    const repeat = clamp(Number(entry.textureRepeat ?? 1) || 1, 0.05, 24);
    texture.repeat.set(repeat, repeat);
    texture.needsUpdate = true;

    const record = options.record || this.registerTexture(dataUrl, name);
    const scale = clamp(Number(options.scale ?? entry.normalScale ?? 1) || 0, 0, 4);
    for (const mesh of meshes) {
      const apply = (material) => {
        if (!material) return material;
        const copy = material.clone();
        copy.normalMap = texture;
        copy.normalScale = new THREE.Vector2(scale, scale);
        copy.needsUpdate = true;
        return copy;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(apply) : apply(mesh.material);
    }
    entry.normalMapId = record.id;
    entry.normalScale = scale;
    this.inspector?.render();
    this.commitChange();
    if (!options.silent) toast(`Mapa de normales aplicado (intensidad ${scale.toFixed(2)}).`, 'success', 2200);
    return record;
  }

  async loadNormalMapFile(file, options = {}) {
    if (!file) return null;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen.'));
      reader.readAsDataURL(file);
    });
    return this.applyNormalMap(dataUrl, baseName(file.name) || 'Mapa de normales', options);
  }

  /** Crea un mapa de normales a partir de la textura actual (luminancia → relieve). */
  async generateNormalFromTexture(entry = this.selectedEntry) {
    if (!entry) {
      toast('Selecciona una pieza primero.', 'warn', 2200);
      return null;
    }
    const record = entry.textureId ? this.textures.get(entry.textureId) : null;
    if (!record) {
      toast('Primero aplica o crea una textura: el relieve sale de su dibujo.', 'warn', 3000);
      return null;
    }
    const baseNameText = record.name || 'Textura';
    toast('Calculando relieve…', 'info', 1400);
    try {
      const dataUrl = await normalMapFromDataUrl(record.dataUrl, { strength: 2.4, max: 512 });
      return await this.applyNormalMap(dataUrl, `Relieve de ${baseNameText}`, {
        entry,
        scale: entry.normalScale ?? 1.6,
      });
    } catch (error) {
      console.error('[PEKITA] No se pudo generar el mapa de normales', error);
      toast('No se pudo generar el relieve.', 'error', 3000);
      return null;
    }
  }

  /** Intensidad del relieve (0 = plano, 4 = muy marcado). */
  setNormalScale(entry = this.selectedEntry, value) {
    if (!entry?.normalMapId) return;
    const scale = clamp(Number(value) || 0, 0, 4);
    entry.normalScale = scale;
    entry.object?.traverse((node) => {
      if (!node.isMesh) return;
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of list) {
        if (!material?.normalMap) continue;
        material.normalScale?.set(scale, scale);
        material.needsUpdate = true;
      }
    });
  }

  clearNormalMap(entry = this.selectedEntry) {
    if (!entry) return;
    entry.object?.traverse((node) => {
      if (!node.isMesh) return;
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of list) {
        if (!material) continue;
        material.normalMap = null;
        material.normalScale?.set(1, 1);
        material.needsUpdate = true;
      }
    });
    entry.normalMapId = null;
    this.inspector?.render();
    this.commitChange();
    toast('Mapa de normales quitado.', 'info', 1800);
  }

  /** Repeticiones de la textura (mosaico). */
  setTextureRepeat(entry = this.selectedEntry, value) {
    if (!entry?.textureId) return;
    const repeat = clamp(Number(value) || 1, 0.05, 24);
    entry.textureRepeat = repeat;
    for (const mesh of [entry.object, ...(entry.object?.children || [])]) {
      mesh?.traverse?.((node) => {
        if (!node.isMesh) return;
        const list = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of list) {
          if (material?.map) material.map.repeat.set(repeat, repeat);
          if (material?.normalMap) material.normalMap.repeat.set(repeat, repeat);
        }
      });
    }
    this.commitChange();
  }

  clearTexture(entry = this.selectedEntry) {
    if (!entry) return;
    entry.object?.traverse((node) => {
      if (!node.isMesh) return;
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of list) {
        if (!material) continue;
        material.map = null;
        material.needsUpdate = true;
      }
    });
    entry.textureId = null;
    this.inspector?.render();
    this.commitChange();
    toast('Textura quitada.', 'info', 1800);
  }

  /** Abre el editor de texturas y aplica el resultado al objeto actual. */
  async openTextureEditor() {
    const entry = this.selectedEntry;
    if (!entry) {
      toast('Selecciona una pieza para crear su textura.', 'warn', 2400);
      return;
    }
    const source = entry.textureId ? this.textures.get(entry.textureId)?.dataUrl : null;
    const dataUrl = await openTextureEditor({ sourceDataUrl: source || '' });
    if (!dataUrl) return;
    await this.applyTexture(dataUrl, 'Textura creada');
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
    this.commitChange();
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
    this.commitChange();
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
    this.commitChange();
    this.refreshAll();
    toast(`Espejo en ${axis.toUpperCase()} aplicado.`, 'success', 2000);
  }

  /* ============================================================
     Historial
     ============================================================ */

  serializeState() {
    // Las instantáneas guardan una copia del árbol 3D (geometría compartida,
    // materiales propios) más los metadatos de cada entrada, así que deshacer
    // funciona con objetos nuevos, borrados, materiales, piezas y jerarquía.
    const roots = this.entries.filter((entry) => !entry.parentId || !this.objects.has(entry.parentId));
    return {
      version: 2,
      time: Date.now(),
      roots: roots.map((entry) => ({ id: entry.id, object: cloneForHistory(entry.object) })),
      objects: this.entries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        type: entry.type,
        color: entry.color,
        visible: entry.visible,
        locked: entry.locked,
        parentId: entry.parentId || null,
        tracks: deepClone(entry.tracks),
        warnings: entry.warnings || [],
        primitive: entry.primitive ? deepClone(entry.primitive) : null,
        textureId: entry.textureId || null,
        textureRepeat: entry.textureRepeat ?? 1,
        normalMapId: entry.normalMapId || null,
        normalScale: entry.normalScale ?? 1,
        modifierState: deepClone(entry.modifierState || {}),
      })),
      selectedId: this.selectedId,
      currentTime: this.currentTime,
      duration: this.duration,
      fps: this.fps,
      loop: this.loop,
      autoKey: this.autoKey,
      activeCameraId: this.activeCameraId,
      backgroundId: this.background?.id || null,
      renderSize: { ...this.renderSize },
    };
  }

  pushHistory() {
    if (this.inSetup || this.restoringHistory || this.exporting) return;
    const snapshot = this.serializeState();
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snapshot);
    while (this.history.length > this.historyLimit) this.history.shift();
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
    const previousTime = snapshot.currentTime;
    this.restoringHistory = true;
    this.pause();
    try {
      // 1) Sacar de la escena el estado actual.
      for (const entry of [...this.entries]) {
        if (entry.object?.isSpotLight && entry.object.target?.parent) entry.object.target.parent.remove(entry.object.target);
        if (entry.object?.parent) entry.object.parent.remove(entry.object);
      }
      this.viewport.transform?.detach();
      this.objects.clear();

      // 2) Reconstruir el árbol desde las instantáneas.
      const scene = this.viewport.scene;
      const nodeById = new Map();
      for (const root of snapshot.roots || []) {
        const object = cloneForHistory(root.object);
        scene.add(object);
        object.traverse((node) => {
          const id = node.userData?.entryId;
          if (id) nodeById.set(id, node);
        });
      }

      // 3) Rehacer las entradas.
      const entries = [];
      for (const data of snapshot.objects || []) {
        const object = nodeById.get(data.id);
        if (!object) continue;
        const entry = {
          id: data.id,
          name: data.name,
          type: data.type,
          object,
          parentId: data.parentId || null,
          tracks: deepClone(data.tracks) || createTracks(),
          color: data.color,
          visible: data.visible !== false,
          locked: !!data.locked,
          warnings: data.warnings || [],
          modifierState: deepClone(data.modifierState || { wireframe: false, flatShading: false }),
          baseGeometry: null,
          primitive: data.primitive ? deepClone(data.primitive) : null,
          textureId: data.textureId || null,
          textureRepeat: data.textureRepeat ?? 1,
          normalMapId: data.normalMapId || null,
          normalScale: data.normalScale ?? 1,
        };
        object.visible = entry.visible;
        if (object.isSpotLight && object.target) scene.add(object.target);
        this.objects.set(entry.id, entry);
        entries.push(entry);
      }
      this.entries = entries;

      // 4) Estado global.
      this.selectedId = this.objects.has(snapshot.selectedId) ? snapshot.selectedId : null;
      this.selectedKey = null;
      this.selectedKeys = [];
      if (Number.isFinite(snapshot.duration)) this.duration = snapshot.duration;
      if (Number.isFinite(snapshot.fps)) this.fps = snapshot.fps;
      this.loop = snapshot.loop !== false;
      this.autoKey = !!snapshot.autoKey;
      if (snapshot.renderSize) this.renderSize = { ...snapshot.renderSize };
      this.activeCameraId = this.objects.has(snapshot.activeCameraId) ? snapshot.activeCameraId : null;
      this.viewport.setActiveCamera(this.activeCameraEntry?.object || null);
      this.currentTime = clamp(Number(previousTime) || 0, 0, this.duration);
      this.animation.evaluate(this.currentTime);
      this.restoreBackgroundById(snapshot.backgroundId);
      this.refreshCameraHud();
    } catch (error) {
      console.error('[PEKITA] No se pudo restaurar el historial', error);
    } finally {
      this.restoringHistory = false;
    }
    this.viewport.updateStats();
    this.viewport.updateSelection(this.selectedEntry);
    this.timeline?.render();
    this.timeline?.setPlayhead(this.currentTime);
    this.inspector?.render();
    this.topbar?.refresh();
    this.mobileBar?.update();
    this.topbar?.updateHistory();
  }

  undo() {
    if (this.historyIndex <= 0) {
      toast('No hay más cambios que deshacer.', 'info', 1400);
      return;
    }
    this.historyIndex -= 1;
    this.applySnapshot(this.history[this.historyIndex]);
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) {
      toast('No hay más cambios que rehacer.', 'info', 1400);
      return;
    }
    this.historyIndex += 1;
    this.applySnapshot(this.history[this.historyIndex]);
  }

  /** Vuelve a poner el fondo que estaba activo en una instantánea. */
  restoreBackgroundById(id) {
    const current = this.background;
    if (!id) {
      if (current) this.clearBackground({ notify: false, schedule: false });
      return;
    }
    if (current?.id === id) return;
    const record = this.backgrounds.get(id);
    if (!record) return;
    this.clearBackground({ notify: false, schedule: false });
    this.background = record;
    this.viewport?.setBackgroundImage(record.texture);
    this.inspector?.render();
  }

  /* ============================================================
     Teclado / refresco
     ============================================================ */

  bindShortcuts() {
    window.addEventListener('keydown', (event) => {
      const typing = event.target?.matches?.('input, textarea, select, [contenteditable="true"]');
      if (typing) return;
      // Con la pantalla principal delante, los atajos del editor no deben actuar.
      if (this.homeOpen) return;
      if (event.key === 'Escape') {
        if (document.querySelector('.modal-backdrop')) return;
        if (this.activeCameraId) this.exitCameraView();
        else if (this.selectedKeys.length > 1) this.setKeySelection(this.selectedKey ? [this.selectedKey] : []);
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
        } else if (event.code === 'KeyC') {
          // Solo intercepta si hay keyframes seleccionados y no hay texto copiable.
          if (!this.selectedKeys.length) return;
          if (String(window.getSelection?.()?.toString() || '').trim()) return;
          event.preventDefault();
          this.copyKeys();
        } else if (event.code === 'KeyV') {
          if (!this.keyClipboard) return;
          event.preventDefault();
          this.pasteKeys();
        } else if (event.code === 'KeyA') {
          if (!this.selectedEntry && !this.entries.length) return;
          event.preventDefault();
          this.selectAllKeys();
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
          if (this.selectedKeys.length > 1) this.deleteSelectedKeys();
          else if (this.selectedKey) this.deleteKeyframe();
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
    this.mobileBar?.update();
    this.scheduleAutosave(2600);
  }

  refreshUI() {
    this.refreshAll();
  }

  /* ============================================================
     Interfaz móvil (teléfonos / tablets)
     ============================================================ */

  /** Cambia entre la interfaz de escritorio y la de teléfono y recarga. */
  toggleMobileMode() {
    const nextMobile = !this.mobile;
    try {
      localStorage.setItem('pekita-mobile-view', nextMobile ? '1' : '0');
    } catch {
      /* almacenamiento no disponible */
    }
    const url = new URL(location.href);
    url.searchParams.set(nextMobile ? 'mobile' : 'desktop', '1');
    location.href = url.toString();
  }

  /** Abre o cierra la hoja inferior de propiedades. */
  toggleMobileSheet() {
    document.body.classList.toggle('sheet-open');
    this.mobileBar?.update();
  }

  closeMobileSheet() {
    document.body.classList.remove('sheet-open');
    this.mobileBar?.update();
  }

  /** Pliega o despliega la línea de tiempo para dejar más vista 3D. */
  toggleMobileTimeline() {
    document.body.classList.toggle('timeline-collapsed');
    this.timeline?.render();
    this.mobileBar?.update();
  }

  /** Menú completo en una hoja, ya que en móvil la barra de menús no cabe. */
  openMobileMenu() {
    const menus = this.topbar?.menuData?.() || [];
    const body = h('div', { class: 'mobile-menu' });
    let modal = null;

    for (const menu of menus) {
      const items = (menu.items || []).filter((item) => !item.sep);
      if (!items.length) continue;
      body.appendChild(h('div', { class: 'mm-title', text: menu.label }));
      const grid = h('div', { class: 'mm-grid' });
      for (const item of items) {
        grid.appendChild(
          h('button', {
            class: 'mm-item',
            type: 'button',
            html: `${icon(item.icon || 'cube', 18)}<span>${escapeHtml(item.label)}</span>`,
            onClick: () => {
              modal?.close();
              item.action?.();
            },
          }),
        );
      }
      body.appendChild(grid);
    }

    modal = showModal({
      title: 'Menú',
      body,
      className: 'mobile-menu-modal',
      actions: [{ label: 'Cerrar' }],
    });
    return modal;
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
