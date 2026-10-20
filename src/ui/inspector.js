import { icon } from '../icons.js';
import { CHANNELS, CHANNEL_LABELS } from '../core/animation.js';
import { DEFAULT_EASING, EASING_PRESETS, easingLabel, presetForPoints } from '../core/easing.js';
import { clamp, escapeHtml, formatTimecode } from '../utils.js';

const TABS = [
  { id: 'props', label: 'Props', icon: 'sliders' },
  { id: 'mods', label: 'Mods', icon: 'settings' },
  { id: 'keys', label: 'Keys', icon: 'key' },
  { id: 'curves', label: 'Curvas', icon: 'curve' },
  { id: 'rig', label: 'Rig', icon: 'target' },
  { id: 'scene', label: 'Escena', icon: 'layers' },
];

const TYPE_NAMES = {
  mesh: 'Malla',
  model: 'Modelo',
  group: 'Grupo',
  light: 'Luz',
  camera: 'Cámara',
};

const CURVE = { W: 260, H: 180, L: 32, R: 230, T: 16, B: 152 };

export class Inspector {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.tab = 'props';
    this.collapsed = new Set();
    this.curveDrag = null;
    this.root.innerHTML = `
      <div class="insp-head">
        <div class="insp-titlebar">
          <h2>Inspector</h2>
          <span class="badge" id="insp-badge">ESCENA</span>
        </div>
        <div class="selected-card" id="selected-card"></div>
        <div class="tabs" id="insp-tabs">
          ${TABS.map(
            (tab) =>
              `<button class="tab" data-tab="${tab.id}" title="${tab.label}">${icon(tab.icon, 14)}<span>${tab.label}</span></button>`,
          ).join('')}
        </div>
      </div>
      <div class="insp-body" id="insp-body"></div>
    `;
    this.badge = this.root.querySelector('#insp-badge');
    this.card = this.root.querySelector('#selected-card');
    this.body = this.root.querySelector('#insp-body');
    this.tabs = this.root.querySelector('#insp-tabs');

    this.tabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tab]');
      if (!button) return;
      this.tab = button.dataset.tab;
      this.render();
    });

    this.card.addEventListener('click', (event) => {
      const eye = event.target.closest('[data-sel-eye]');
      if (eye) this.app.toggleVisible(this.app.selectedEntry);
    });

    this.card.addEventListener('change', (event) => {
      if (event.target.matches('#object-name')) this.app.renameSelected(event.target.value);
    });
    this.card.addEventListener('keydown', (event) => {
      if (event.target.matches('#object-name') && event.key === 'Enter') event.target.blur();
    });

    window.addEventListener('pointermove', (event) => this.onCurvePointerMove(event));
    window.addEventListener('pointerup', () => this.onCurvePointerUp());

    this.render();
  }

  get entry() {
    return this.app.selectedEntry;
  }

  render() {
    if (!this.body) return;
    const scrollTop = this.body.scrollTop;
    this.renderCard();
    this.renderTabs();
    let html = '';
    if (this.tab === 'scene') html = this.renderScene();
    else if (!this.entry) html = this.renderEmpty();
    else if (this.tab === 'props') html = this.renderProperties();
    else if (this.tab === 'mods') html = this.renderModifiers();
    else if (this.tab === 'keys') html = this.renderKeys();
    else if (this.tab === 'curves') html = this.renderCurves();
    else if (this.tab === 'rig') html = this.renderRig();
    this.body.innerHTML = html;
    this.bindBody();
    this.body.scrollTop = scrollTop;
  }

  renderCard() {
    const entry = this.entry;
    if (entry) {
      const type = TYPE_NAMES[entry.type] || entry.type;
      this.badge.textContent = type.toUpperCase();
      this.card.innerHTML = `
        <div class="selected-icon">${icon(this.app.getEntryIcon(entry), 15)}</div>
        <div class="selected-info">
          <input id="object-name" value="${escapeHtml(entry.name)}" title="Renombrar objeto" spellcheck="false" />
          <span>${type}${entry.parentId ? ' · jerarquía' : ''}</span>
        </div>
        <div class="selected-actions">
          <button class="mini-btn" data-sel-eye title="Mostrar/ocultar">${icon(entry.visible ? 'eye' : 'eyeOff', 13)}</button>
        </div>`;
    } else {
      this.badge.textContent = 'ESCENA';
      this.card.innerHTML = `
        <div class="selected-icon">${icon('layers', 15)}</div>
        <div class="selected-info">
          <input value="Sin selección" disabled />
          <span>Selecciona un objeto en la vista o en la jerarquía</span>
        </div>`;
    }
  }

  renderTabs() {
    this.tabs.querySelectorAll('[data-tab]').forEach((button) => {
      button.classList.toggle('active', button.dataset.tab === this.tab);
    });
  }

  renderEmpty() {
    return `<div class="empty-state">${icon('cursor', 32)}<b>Nada seleccionado</b><p>Haz clic en un objeto de la vista 3D o usa la pestaña Escena para elegir uno.</p></div>`;
  }

  section(title, content, sub = '') {
    return `<div class="section"><div class="section-head"><h3>${title}</h3>${sub ? `<span class="sub">${sub}</span>` : ''}</div>${content}</div>`;
  }

  meshFlag(entry, key) {
    if (!entry) return false;
    if (entry.object?.[key]) return true;
    let value = false;
    entry.object?.traverse((node) => {
      if (node.isMesh && node[key]) value = true;
    });
    return value;
  }

  keyButton(channel) {
    const has = this.app.animation.channelHasKeys(this.entry, channel);
    return `<button class="vec-key ${has ? 'has' : ''}" data-key-channel="${channel}" title="Añadir clave de ${CHANNEL_LABELS[channel].toLowerCase()} en el fotograma actual">${icon('key', 10)}</button>`;
  }

  vecRow(channel, label, values, step = 0.05) {
    const display = channel === 'rotation' ? values.map((v) => (v * 180) / Math.PI) : values;
    const axes = ['X', 'Y', 'Z'];
    return `<div class="vec-row">
      <span class="vec-label">${this.keyButton(channel)}${label}</span>
      ${display
        .map(
          (value, axis) => `
        <div class="inp-wrap ${axes[axis].toLowerCase()}">
          <span class="axis">${axes[axis]}</span>
          <input type="number" step="${step}" value="${Number(value.toFixed(3))}"
            data-channel="${channel}" data-axis="${axis}" />
        </div>`,
        )
        .join('')}
    </div>`;
  }

  renderProperties() {
    const entry = this.entry;
    const object = entry.object;
    const transform = this.section(
      'Transformación',
      `${this.vecRow('position', 'Posición', [object.position.x, object.position.y, object.position.z], 0.05)}
       ${this.vecRow('rotation', 'Rotación', [object.rotation.x, object.rotation.y, object.rotation.z], 1)}
       ${this.vecRow('scale', 'Escala', [object.scale.x, object.scale.y, object.scale.z], 0.05)}`,
      'local',
    );

    let typeSection = this.section(
      'Objeto',
      `<div class="switch-row"><span>Visible</span><button class="switch ${entry.visible ? 'on' : ''}" data-toggle="visible"></button></div>
       <div class="switch-row"><span>Proyectar sombra</span><button class="switch ${this.meshFlag(entry, 'castShadow') ? 'on' : ''}" data-toggle="castShadow"></button></div>
       <div class="switch-row"><span>Recibir sombra</span><button class="switch ${this.meshFlag(entry, 'receiveShadow') ? 'on' : ''}" data-toggle="receiveShadow"></button></div>
       <div class="field-row"><label>Tipo</label><input value="${TYPE_NAMES[entry.type] || entry.type}" disabled /></div>`,
    );

    let materialSection = '';
    if (entry.type === 'mesh' || entry.type === 'model' || entry.object.isMesh) {
      const materials = this.app.materialList(entry);
      const first = materials[0];
      if (first) {
        const color = first.color ? `#${first.color.getHexString()}` : '#ffffff';
        const emissive = first.emissive ? `#${first.emissive.getHexString()}` : '#000000';
        const metalness = first.metalness ?? 0;
        const roughness = first.roughness ?? 0.5;
        const opacity = first.opacity ?? 1;
        materialSection = this.section(
          'Material',
          `<div class="field-row"><label>Color</label><div class="color-row">
             <input type="color" value="${color}" data-mat="color" />
             <input class="hex" value="${color.toUpperCase()}" data-mat-hex="color" spellcheck="false" />
           </div></div>
           <div class="slider-row"><label>Metalness</label><input type="range" min="0" max="1" step="0.01" value="${metalness}" data-mat="metalness" /><span class="val">${metalness.toFixed(2)}</span></div>
           <div class="slider-row"><label>Roughness</label><input type="range" min="0" max="1" step="0.01" value="${roughness}" data-mat="roughness" /><span class="val">${roughness.toFixed(2)}</span></div>
           <div class="slider-row"><label>Opacidad</label><input type="range" min="0" max="1" step="0.01" value="${opacity}" data-mat="opacity" /><span class="val">${opacity.toFixed(2)}</span></div>
           <div class="field-row"><label>Emisivo</label><div class="color-row">
             <input type="color" value="${emissive}" data-mat="emissive" />
             <input class="hex" value="${emissive.toUpperCase()}" data-mat-hex="emissive" spellcheck="false" />
           </div></div>
           <div class="slider-row"><label>Intensidad</label><input type="range" min="0" max="4" step="0.05" value="${first.emissiveIntensity ?? 1}" data-mat="emissiveIntensity" /><span class="val">${(first.emissiveIntensity ?? 1).toFixed(2)}</span></div>
           <div class="switch-row"><span>Wireframe</span><button class="switch ${materials.some((m) => m.wireframe) ? 'on' : ''}" data-toggle="wireframe"></button></div>
           <div class="switch-row"><span>Flat shading</span><button class="switch ${materials.some((m) => m.flatShading) ? 'on' : ''}" data-toggle="flat"></button></div>`,
          `${materials.length} material${materials.length === 1 ? '' : 'es'}`,
        );
      }
    }

    let lightSection = '';
    if (entry.type === 'light') {
      const light = object;
      const color = light.color ? `#${light.color.getHexString()}` : '#ffffff';
      const extras = [];
      if (light.isPointLight || light.isSpotLight) {
        extras.push(
          `<div class="slider-row"><label>Distancia</label><input type="range" min="0" max="80" step="0.5" value="${light.distance || 0}" data-light="distance" /><span class="val">${(light.distance || 0).toFixed(1)}</span></div>`,
          `<div class="slider-row"><label>Decay</label><input type="range" min="0" max="4" step="0.1" value="${light.decay ?? 2}" data-light="decay" /><span class="val">${(light.decay ?? 2).toFixed(1)}</span></div>`,
        );
      }
      if (light.isSpotLight) {
        extras.push(
          `<div class="slider-row"><label>Ángulo</label><input type="range" min="5" max="80" step="1" value="${(light.angle * 180) / Math.PI}" data-light="angleDeg" /><span class="val">${Math.round((light.angle * 180) / Math.PI)}°</span></div>`,
          `<div class="slider-row"><label>Penumbra</label><input type="range" min="0" max="1" step="0.01" value="${light.penumbra}" data-light="penumbra" /><span class="val">${light.penumbra.toFixed(2)}</span></div>`,
        );
      }
      if (light.isDirectionalLight || light.isSpotLight) {
        extras.push(
          `<div class="switch-row"><span>Sombras</span><button class="switch ${light.castShadow ? 'on' : ''}" data-light-toggle="castShadow"></button></div>`,
        );
      }
      lightSection = this.section(
        'Luz',
        `<div class="field-row"><label>Color</label><div class="color-row"><input type="color" value="${color}" data-light="color" /><input class="hex" value="${color.toUpperCase()}" data-light-hex="color" spellcheck="false" /></div></div>
         <div class="slider-row"><label>Intensidad</label><input type="range" min="0" max="${light.isDirectionalLight ? 12 : 200}" step="0.1" value="${light.intensity}" data-light="intensity" /><span class="val">${Number(light.intensity).toFixed(1)}</span></div>
         ${extras.join('')}`,
        light.type.replace('Light', ''),
      );
    }

    let cameraSection = '';
    if (entry.type === 'camera') {
      const camera = object;
      const active = this.app.activeCameraId === entry.id;
      cameraSection = this.section(
        'Cámara',
        `<div class="slider-row"><label>FOV</label><input type="range" min="10" max="110" step="1" value="${camera.fov}" data-cam="fov" /><span class="val">${camera.fov}°</span></div>
         <div class="field-row"><label>Near</label><input type="number" step="0.01" value="${camera.near}" data-cam="near" /></div>
         <div class="field-row"><label>Far</label><input type="number" step="1" value="${camera.far}" data-cam="far" /></div>
         <div class="btn-row">
           <button class="btn ${active ? 'danger' : 'primary'}" data-action="${active ? 'exit-camera' : 'use-camera'}">${active ? 'Salir de esta cámara' : 'Ver por esta cámara'}</button>
         </div>`,
        active ? 'activa' : '',
      );
    }

    return `${transform}${materialSection}${lightSection}${cameraSection}${typeSection}`;
  }

  renderModifiers() {
    const entry = this.entry;
    if (!entry) return this.renderEmpty();
    const materials = this.app.materialList(entry);
    if (!materials.length) {
      return `<div class="empty-state">${icon('settings', 30)}<b>Sin modificadores disponibles</b><p>Los modificadores de geometría y material se aplican a mallas, grupos y modelos importados.</p></div>`;
    }
    const wireframe = materials.some((material) => material.wireframe);
    const flat = materials.some((material) => material.flatShading);
    return `
      ${this.section(
        'Aspecto',
        `<div class="switch-row"><span>Wireframe</span><button class="switch ${wireframe ? 'on' : ''}" data-toggle="wireframe"></button></div>
         <div class="switch-row"><span>Flat shading</span><button class="switch ${flat ? 'on' : ''}" data-toggle="flat"></button></div>
         <div class="switch-row"><span>Proyectar sombra</span><button class="switch ${this.meshFlag(entry, 'castShadow') ? 'on' : ''}" data-toggle="castShadow"></button></div>
         <div class="switch-row"><span>Recibir sombra</span><button class="switch ${this.meshFlag(entry, 'receiveShadow') ? 'on' : ''}" data-toggle="receiveShadow"></button></div>`,
      )}
      ${this.section(
        'Suavizado',
        `<p class="mod-desc">Suaviza la geometría fusionando vértices y recalculando normales. Ideal para modelos low-poly.</p>
         <button class="btn wide" data-action="smooth">${icon('sparkles', 12)} Suavizar geometría</button>`,
      )}
      ${this.section(
        'Array',
        `<p class="mod-desc">Duplica el objeto en una línea recta.</p>
         <div class="field-row"><label>Cantidad</label><input type="number" id="mod-array-count" min="2" max="24" value="3" /></div>
         <div class="field-row"><label>Separación</label><input type="number" id="mod-array-offset" min="0.05" step="0.1" value="1.2" /></div>
         <div class="field-row"><label>Eje</label><select id="mod-array-axis"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></div>
         <button class="btn wide" data-action="array">${icon('copy', 12)} Aplicar array</button>`,
      )}
      ${this.section(
        'Espejo',
        `<p class="mod-desc">Crea una copia reflejada del objeto.</p>
         <div class="field-row"><label>Eje</label><select id="mod-mirror-axis"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></div>
         <button class="btn wide" data-action="mirror">${icon('copy', 12)} Aplicar espejo</button>`,
      )}
      <p class="mod-desc" style="padding:0 2px">Los cambios de geometría no se pueden deshacer con Ctrl+Z.</p>
    `;
  }

  renderKeys() {
    const entry = this.entry;
    if (!entry) return this.renderEmpty();
    const times = this.app.animation.allTimes(entry);
    const rows = times
      .map((time) => {
        const channels = CHANNELS.filter((channel) => this.app.animation.keyAt(entry, channel, time));
        const easing = this.app.animation.getEasingAt(entry, time, channels[0] || 'position');
        const selected =
          this.app.selectedKey && this.app.selectedKey.id === entry.id && Math.abs(this.app.selectedKey.time - time) < 0.0006;
        return `<div class="kf-item ${selected ? 'active' : ''}" data-key-time="${time}">
          <span class="kf-time">${formatTimecode(time, this.app.fps)}</span>
          <span class="kf-channels">${channels
            .map((channel) => `<span class="kf-ch ${channel[0]}">${channel[0].toUpperCase()}</span>`)
            .join('')}</span>
          <span class="kf-ease">${escapeHtml(easingLabel(easing))}</span>
          <button class="kf-del" data-del-key="${time}" title="Eliminar keyframe">${icon('trash', 11)}</button>
        </div>`;
      })
      .join('');

    return `
      <div class="section">
        <div class="section-head"><h3>Keyframes</h3><span class="sub" data-current-time>${formatTimecode(this.app.currentTime, this.app.fps)}</span></div>
        <div class="switch-row"><span>Auto Key</span><button class="switch ${this.app.autoKey ? 'on' : ''}" data-toggle="autokey"></button></div>
        <div class="kf-toolbar">
          <button class="btn primary" data-action="add-key">${icon('key', 12)} Clave aquí</button>
          ${CHANNELS.map(
            (channel) =>
              `<button class="btn sm" data-action="add-key-channel" data-channel-name="${channel}" title="${CHANNEL_LABELS[channel]}">${icon('plus', 10)} ${channel[0].toUpperCase()}</button>`,
          ).join('')}
        </div>
        <div class="kf-list">${rows || `<div class="kf-empty">Este objeto aún no tiene keyframes.<br/>Pulsa <b>Clave aquí</b> o doble clic en la timeline.</div>`}</div>
        <p class="mod-desc" style="margin-top:8px">Doble clic en la pista del timeline para crear una clave en ese fotograma.</p>
      </div>`;
  }

  resolveCurveTime(entry) {
    if (
      this.app.selectedKey?.id === entry.id &&
      CHANNELS.some((channel) => this.app.animation.keyAt(entry, channel, this.app.selectedKey.time))
    ) {
      return this.app.selectedKey.time;
    }
    const times = this.app.animation.allTimes(entry);
    if (!times.length) return null;
    return times.reduce((best, time) => (Math.abs(time - this.app.currentTime) < Math.abs(best - this.app.currentTime) ? time : best), times[0]);
  }

  curvePath(points) {
    const x = (v) => CURVE.L + v * (CURVE.R - CURVE.L);
    const y = (v) => CURVE.B - v * (CURVE.B - CURVE.T);
    return {
      path: `M ${x(0)} ${y(0)} C ${x(points[0])} ${y(points[1])}, ${x(points[2])} ${y(points[3])}, ${x(1)} ${y(1)}`,
      c1: { x: x(points[0]), y: y(points[1]) },
      c2: { x: x(points[2]), y: y(points[3]) },
      start: { x: x(0), y: y(0) },
      end: { x: x(1), y: y(1) },
      x,
      y,
    };
  }

  renderCurves() {
    const entry = this.entry;
    if (!entry) return this.renderEmpty();
    const times = this.app.animation.allTimes(entry);
    if (!times.length) {
      return `<div class="empty-state">${icon('curve', 32)}<b>Sin curvas todavía</b><p>Añade un keyframe para editar su curva de interpolación Bézier.</p><button class="btn primary" data-action="add-key">${icon('key', 12)} Añadir keyframe</button></div>`;
    }
    const time = this.resolveCurveTime(entry);
    const channels = CHANNELS.filter((channel) => this.app.animation.keyAt(entry, channel, time));
    const channel = channels[0] || 'position';
    const points = this.app.animation.getEasingAt(entry, time, channel);
    const graph = this.curvePath(points);
    const preset = presetForPoints(points);
    const selectedPreset = preset === 'custom' ? '' : preset;

    const options = times
      .map((t) => `<option value="${t}" ${Math.abs(t - time) < 0.0006 ? 'selected' : ''}>${formatTimecode(t, this.app.fps)}</option>`)
      .join('');

    return `
      <div class="section">
        <div class="section-head"><h3>Curva de animación</h3><span class="sub">${escapeHtml(CHANNEL_LABELS[channel] || '')}</span></div>
        <div class="field-row"><label>Keyframe</label><select id="curve-time">${options}</select></div>
        <div class="curve-box">
          <svg class="curve-svg" viewBox="0 0 ${CURVE.W} ${CURVE.H}" id="curve-svg">
            <defs>
              <pattern id="curve-grid" width="49.5" height="34" patternUnits="userSpaceOnUse" x="${CURVE.L}" y="${CURVE.T}">
                <path d="M 49.5 0 L 0 0 0 34" fill="none" stroke="#1c2636" stroke-width="1"/>
              </pattern>
            </defs>
            <rect x="${CURVE.L}" y="${CURVE.T}" width="${CURVE.R - CURVE.L}" height="${CURVE.B - CURVE.T}" fill="url(#curve-grid)" stroke="#263246" rx="4" />
            <line x1="${CURVE.L}" y1="${CURVE.B}" x2="${graph.start.x}" y2="${graph.start.y}" stroke="#5aa2ff" stroke-width="1" stroke-dasharray="3 3" opacity=".65" />
            <line x1="${graph.end.x}" y1="${graph.end.y}" x2="${graph.c2.x}" y2="${graph.c2.y}" stroke="#f5c542" stroke-width="1" stroke-dasharray="3 3" opacity=".65" />
            <path id="curve-path" d="${graph.path}" fill="none" stroke="#f5c542" stroke-width="2.2" stroke-linecap="round" />
            <circle cx="${graph.start.x}" cy="${graph.start.y}" r="3" fill="#5aa2ff" />
            <circle cx="${graph.end.x}" cy="${graph.end.y}" r="3" fill="#f5c542" />
            <circle data-handle="1" cx="${graph.c1.x}" cy="${graph.c1.y}" r="6" fill="#5aa2ff" stroke="#0b0f16" stroke-width="2" style="cursor:grab" />
            <circle data-handle="2" cx="${graph.c2.x}" cy="${graph.c2.y}" r="6" fill="#f5c542" stroke="#0b0f16" stroke-width="2" style="cursor:grab" />
            <text x="${CURVE.L}" y="${CURVE.B + 15}" fill="#5f6b80" font-size="8">0</text>
            <text x="${CURVE.R - 4}" y="${CURVE.B + 15}" fill="#5f6b80" font-size="8">1</text>
          </svg>
          <div class="curve-readout"><span>cubic-bezier</span><b id="curve-values">${points.map((v) => Number(v).toFixed(2)).join(', ')}</b></div>
        </div>
        <div class="chip-row">
          ${Object.entries(EASING_PRESETS)
            .map(
              ([key, preset]) =>
                `<button class="chip ${selectedPreset === key ? 'on' : ''}" data-ease-preset="${key}">${preset.label}</button>`,
            )
            .join('')}
        </div>
        <p class="mod-desc" style="margin-top:8px">Arrastra los puntos azul y amarillo para diseñar la curva. La curva afecta al segmento desde este keyframe hasta el siguiente.</p>
      </div>`;
  }

  renderRig() {
    const entry = this.entry;
    if (!entry) {
      return `<div class="empty-state">${icon('target', 32)}<b>Rig y jerarquía</b><p>Selecciona un objeto para crear un control padre o emparentarlo a un control existente.</p><button class="btn primary" data-action="add-primitive" data-kind="empty">${icon('plus', 12)} Crear vacío</button></div>`;
    }
    const parent = entry.parentId ? this.app.objects.get(entry.parentId) : null;
    const childIds = this.app.subtreeIds(entry.id);
    const childEntries = this.app.entries.filter((item) => entry.id && item.parentId === entry.id);
    const candidates = this.app.entries.filter(
      (item) => item.id !== entry.id && !childIds.includes(item.id) && (item.type === 'group' || item.object?.isGroup),
    );
    const range = this.app.compositeClipRange(entry);
    return `
      ${this.section(
        'Rig',
        `<p class="mod-desc">Crea un vacío como control y emparenta objetos. Al animar el control, todos sus hijos se mueven juntos.</p>
         <div class="btn-row grid2">
           <button class="btn primary" data-action="rig-create">${icon('target', 12)} Crear control</button>
           <button class="btn" data-action="rig-unparent" ${entry.parentId ? '' : 'disabled'}>${icon('close', 12)} Soltar del padre</button>
         </div>
         <div class="btn-row">
           <button class="btn" data-action="add-primitive" data-kind="empty">${icon('plus', 12)} Vacío</button>
           <button class="btn" data-action="rig-select-parent" ${entry.parentId ? '' : 'disabled'}>${icon('link', 12)} Seleccionar padre</button>
         </div>
         <div class="field-row"><label>Padre</label><input value="${parent ? escapeHtml(parent.name) : 'Raíz de la escena'}" disabled /></div>`,
        `${childEntries.length} hijo${childEntries.length === 1 ? '' : 's'}`,
      )}
      ${this.section(
        'Emparentar a un control',
        `<div class="field-row"><label>Control</label><select id="rig-parent-select">
           <option value="">Elegir control…</option>
           ${candidates.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')}
         </select></div>
         <button class="btn wide" data-action="rig-parent" ${candidates.length ? '' : 'disabled'}>${icon('link', 12)} Emparentar seleccionado</button>
         <p class="mod-desc" style="margin-top:8px">El objeto conserva su posición en el mundo al emparentarse. Para armar una cadena, crea controles y emparenta cada parte a su control.</p>`,
      )}
      ${this.section(
        'Clip compuesto',
        `<div class="rig-clip-info">
           <span class="rig-clip-dot"></span>
           <div>
             <b>${range ? `${formatTimecode(range.start, this.app.fps)} — ${formatTimecode(range.end, this.app.fps)}` : 'Sin keys en el rig'}</b>
             <span>${range ? 'Arrastra el clip RIG en la timeline para desplazar la animación de todo el grupo.' : 'Añade keys al objeto o a sus hijos para crear un clip compuesto.'}</span>
           </div>
         </div>`,
        `${this.app.subtreeEntries(entry).length} objeto${this.app.subtreeEntries(entry).length === 1 ? '' : 's'}`,
      )}
    `;
  }

  renderScene() {
    const entries = this.app.entries;
    const rootEntries = entries.filter((entry) => !entry.parentId || !this.app.objects.has(entry.parentId));
    const renderNode = (entry, depth) => {
      const children = entries.filter((item) => item.parentId === entry.id);
      const collapsed = this.collapsed.has(entry.id);
      const selected = this.app.selectedId === entry.id;
      const eye = entry.visible ? 'eye' : 'eyeOff';
      let html = `<div class="tree-node ${selected ? 'selected' : ''}" data-tree-id="${entry.id}" style="padding-left:${5 + depth * 14}px">
        <span class="tree-caret" data-caret="${entry.id}">${children.length ? icon(collapsed ? 'chevronRight' : 'chevronDown', 11) : ''}</span>
        <span class="tree-ico">${icon(this.app.getEntryIcon(entry), 12)}</span>
        <span class="tree-name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span>
        <span class="mini-actions"><button class="mini-btn ${entry.visible ? '' : 'off'}" data-tree-eye="${entry.id}" title="Mostrar/ocultar">${icon(eye, 11)}</button></span>
      </div>`;
      if (children.length && !collapsed) {
        for (const child of children) html += renderNode(child, depth + 1);
      }
      return html;
    };
    const tree = rootEntries.map((entry) => renderNode(entry, 0)).join('');
    const audio = this.app.audio;
    const background = this.app.background;
    const backgroundSection = this.section(
      'Fondo de la animación',
      background
        ? `<div class="bg-preview">
             <img src="${background.url}" alt="" />
             <div class="bg-info"><b>${escapeHtml(background.name)}</b><span>Se adapta a la cámara y a la exportación</span></div>
             <button class="mini-btn" data-action="remove-background" title="Quitar fondo">${icon('trash', 12)}</button>
           </div>
           <button class="btn wide" data-action="import-background">${icon('image', 12)} Cambiar imagen</button>`
        : `<p class="mod-desc">Añade una imagen JPG, PNG o WebP como fondo de la escena. Se verá en la vista y en los videos exportados.</p>
           <button class="btn wide" data-action="import-background">${icon('image', 12)} Importar imagen de fondo</button>`,
    );
    const audioSection = audio.hasAudio
      ? this.section(
          'Audio',
          `<div class="field-row"><label>Inicio (s)</label><input type="number" min="0" step="0.1" value="${audio.start.toFixed(2)}" data-audio="start" /></div>
           <div class="slider-row"><label>Volumen</label><input type="range" min="0" max="1" step="0.01" value="${audio.volume}" data-audio="volume" /><span class="val">${Math.round(audio.volume * 100)}%</span></div>
           <div class="btn-row"><button class="btn danger wide" data-action="remove-audio">${icon('trash', 12)} Quitar audio</button></div>`,
          `${audio.duration.toFixed(2)} s`,
        )
      : '';

    return `
      ${this.section(
        'Jerarquía de la escena',
        `<div class="tree">${tree || `<div class="kf-empty">La escena está vacía.</div>`}</div>`,
        `${entries.length} objeto${entries.length === 1 ? '' : 's'}`,
      )}
      ${this.section(
        'Añadir',
        `<div class="btn-row grid2">
          <button class="btn sm" data-action="add-primitive" data-kind="box">${icon('cube', 11)} Cubo</button>
          <button class="btn sm" data-action="add-primitive" data-kind="sphere">${icon('sphere', 11)} Esfera</button>
          <button class="btn sm" data-action="add-primitive" data-kind="plane">${icon('plane', 11)} Plano</button>
          <button class="btn sm" data-action="add-primitive" data-kind="cylinder">${icon('cylinder', 11)} Cilindro</button>
          <button class="btn sm" data-action="add-primitive" data-kind="cone">${icon('cone', 11)} Cono</button>
          <button class="btn sm" data-action="add-primitive" data-kind="torus">${icon('torus', 11)} Toro</button>
          <button class="btn sm" data-action="add-light">${icon('light', 11)} Luz</button>
          <button class="btn sm" data-action="add-camera">${icon('camera', 11)} Cámara</button>
          <button class="btn sm" data-action="add-primitive" data-kind="empty">${icon('target', 11)} Vacío</button>
        </div>
        <div class="btn-row">
          <button class="btn blue" data-action="import">${icon('upload', 12)} Importar modelo</button>
          <button class="btn danger" data-action="delete-selected">${icon('trash', 12)} Eliminar</button>
        </div>`,
      )}
      ${backgroundSection}
      ${audioSection}`;
  }

  bindBody() {
    this.body.querySelectorAll('[data-channel]').forEach((input) => {
      input.addEventListener('input', () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        this.app.setTransformFromInspector(input.dataset.channel, Number(input.dataset.axis), value, false);
      });
      input.addEventListener('change', () => this.app.commitChange());
    });

    this.body.querySelectorAll('[data-key-channel]').forEach((button) => {
      button.addEventListener('click', () => this.app.addKeyframe(this.entry.id, this.app.currentTime, button.dataset.keyChannel));
    });

    this.body.querySelectorAll('[data-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const kind = button.dataset.toggle;
        if (kind === 'visible') this.app.toggleVisible(this.entry);
        else if (kind === 'wireframe') this.app.toggleWireframe(this.entry);
        else if (kind === 'flat') this.app.toggleFlatShading(this.entry);
        else if (kind === 'autokey') this.app.setAutoKey(!this.app.autoKey);
        else if (kind === 'castShadow' || kind === 'receiveShadow') {
          this.app.setShadowProperty(this.entry, kind, !this.entry.object[kind]);
        }
      });
    });

    this.body.querySelectorAll('[data-mat]').forEach((input) => {
      const apply = () => {
        const key = input.dataset.mat;
        let value = input.value;
        if (input.type === 'range' || key === 'emissiveIntensity') value = Number(value);
        this.app.setMaterialProperty(this.entry, key, value);
        if (input.type === 'range') {
          const label = input.parentElement?.querySelector('.val');
          if (label) label.textContent = Number(value).toFixed(2);
        }
        if (key === 'color' || key === 'emissive') {
          const hex = this.body.querySelector(`[data-mat-hex="${key}"]`);
          if (hex) hex.value = String(input.value).toUpperCase();
        }
      };
      input.addEventListener('input', apply);
      input.addEventListener('change', () => this.app.commitChange());
    });

    this.body.querySelectorAll('[data-mat-hex]').forEach((input) => {
      input.addEventListener('change', () => {
        if (/^#[0-9a-f]{6}$/i.test(input.value.trim())) {
          const key = input.dataset.matHex;
          this.app.setMaterialProperty(this.entry, key, input.value.trim());
          const picker = this.body.querySelector(`[data-mat="${key}"]`);
          if (picker) picker.value = input.value.trim();
          this.app.commitChange();
        }
      });
    });

    this.body.querySelectorAll('[data-light]').forEach((input) => {
      const apply = () => {
        const key = input.dataset.light;
        let value = input.type === 'range' ? Number(input.value) : Number(input.value);
        if (key === 'angleDeg') {
          this.app.setLightProperty(this.entry, 'angle', (value * Math.PI) / 180);
          const label = input.parentElement?.querySelector('.val');
          if (label) label.textContent = `${Math.round(value)}°`;
          return;
        }
        this.app.setLightProperty(this.entry, key, value);
        if (input.type === 'range') {
          const label = input.parentElement?.querySelector('.val');
          if (label) label.textContent = key === 'intensity' ? value.toFixed(1) : value.toFixed(2);
        }
        if (key === 'color') {
          const hex = this.body.querySelector('[data-light-hex="color"]');
          if (hex) hex.value = String(input.value).toUpperCase();
        }
      };
      input.addEventListener('input', apply);
      input.addEventListener('change', () => this.app.commitChange());
    });

    this.body.querySelectorAll('[data-light-hex]').forEach((input) => {
      input.addEventListener('change', () => {
        if (/^#[0-9a-f]{6}$/i.test(input.value.trim())) {
          this.app.setLightProperty(this.entry, 'color', input.value.trim());
          const picker = this.body.querySelector('[data-light="color"]');
          if (picker) picker.value = input.value.trim();
          this.app.commitChange();
        }
      });
    });

    this.body.querySelectorAll('[data-light-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.lightToggle;
        this.app.setLightProperty(this.entry, key, !this.entry.object[key]);
        this.render();
        this.app.commitChange();
      });
    });

    this.body.querySelectorAll('[data-cam]').forEach((input) => {
      const apply = () => {
        const key = input.dataset.cam;
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        this.app.setCameraProperty(this.entry, key, value);
        if (input.type === 'range') {
          const label = input.parentElement?.querySelector('.val');
          if (label) label.textContent = `${Math.round(value)}°`;
        }
      };
      input.addEventListener('input', apply);
      input.addEventListener('change', () => this.app.commitChange());
    });

    this.body.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'smooth') this.app.applySmooth(this.entry);
        else if (action === 'array') {
          const count = Number(this.body.querySelector('#mod-array-count')?.value) || 3;
          const offset = Number(this.body.querySelector('#mod-array-offset')?.value) || 1.2;
          const axis = this.body.querySelector('#mod-array-axis')?.value || 'x';
          this.app.applyArray(count, offset, axis);
        } else if (action === 'mirror') {
          const axis = this.body.querySelector('#mod-mirror-axis')?.value || 'x';
          this.app.applyMirror(axis);
        } else if (action === 'use-camera') this.app.useSelectedCamera();
        else if (action === 'exit-camera') this.app.exitCameraView();
        else if (action === 'rig-create') this.app.createRigControl();
        else if (action === 'rig-unparent') this.app.unparentSelected();
        else if (action === 'rig-select-parent') this.app.selectParent();
        else if (action === 'rig-parent') {
          const parentId = this.body.querySelector('#rig-parent-select')?.value;
          if (parentId) this.app.reparentSelectedTo(parentId);
        } else if (action === 'import-background') this.app.triggerBackgroundImport();
        else if (action === 'remove-background') this.app.clearBackground();
        else if (action === 'add-key') this.app.addKeyframe(this.entry?.id || this.app.selectedId);
        else if (action === 'add-key-channel') this.app.addKeyframe(this.entry.id, this.app.currentTime, button.dataset.channelName);
        else if (action === 'add-primitive') this.app.addPrimitive(button.dataset.kind);
        else if (action === 'add-light') this.app.addLight('directional');
        else if (action === 'add-camera') this.app.addCamera();
        else if (action === 'import') this.app.triggerImport();
        else if (action === 'delete-selected') this.app.deleteSelected();
        else if (action === 'remove-audio') {
          this.app.removeAudio();
          this.render();
        }
      });
    });

    this.body.querySelectorAll('[data-audio]').forEach((input) => {
      const apply = () => {
        const key = input.dataset.audio;
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        if (key === 'start') this.app.setAudioStart(value);
        else if (key === 'volume') {
          this.app.setAudioVolume(value);
          const label = input.parentElement?.querySelector('.val');
          if (label) label.textContent = `${Math.round(value * 100)}%`;
        }
      };
      input.addEventListener('input', apply);
      input.addEventListener('change', () => this.app.commitChange());
    });

    this.body.querySelectorAll('[data-key-time]').forEach((row) => {
      row.addEventListener('click', (event) => {
        if (event.target.closest('[data-del-key]')) return;
        this.app.selectKey(this.entry.id, Number(row.dataset.keyTime));
      });
    });
    this.body.querySelectorAll('[data-del-key]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.app.deleteKeyframe(this.entry.id, Number(button.dataset.delKey));
      });
    });

    this.body.querySelectorAll('[data-tree-id]').forEach((node) => {
      node.addEventListener('click', (event) => {
        if (event.target.closest('[data-tree-eye]') || event.target.closest('[data-caret]')) return;
        this.app.select(node.dataset.treeId);
      });
    });
    this.body.querySelectorAll('[data-caret]').forEach((caret) => {
      caret.addEventListener('click', (event) => {
        event.stopPropagation();
        const id = caret.dataset.caret;
        if (this.collapsed.has(id)) this.collapsed.delete(id);
        else this.collapsed.add(id);
        this.render();
      });
    });
    this.body.querySelectorAll('[data-tree-eye]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.app.toggleVisible(button.dataset.treeEye);
      });
    });

    this.body.querySelector('#curve-time')?.addEventListener('change', (event) => {
      const time = Number(event.target.value);
      this.app.selectKey(this.entry.id, time);
    });

    this.body.querySelectorAll('[data-ease-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        const preset = EASING_PRESETS[button.dataset.easePreset];
        if (!preset) return;
        const time = this.resolveCurveTime(this.entry);
        if (time == null) return;
        this.app.setEasingAt(this.entry.id, time, preset.points, 'all', true);
      });
    });

    this.body.querySelectorAll('[data-handle]').forEach((handle) => {
      handle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const time = this.resolveCurveTime(this.entry);
        if (time == null) return;
        const svg = this.body.querySelector('#curve-svg');
        if (!svg) return;
        // Usar el easing visible del primer canal con clave.
        const channels = CHANNELS.filter((channel) => this.app.animation.keyAt(this.entry, channel, time));
        const source = channels[0] || 'position';
        const actual = this.app.animation.getEasingAt(this.entry, time, source);
        this.curveDrag = {
          handle: Number(handle.dataset.handle),
          entryId: this.entry.id,
          time,
          points: [...actual],
          svg,
        };
        handle.setPointerCapture?.(event.pointerId);
      });
    });
  }

  onCurvePointerMove(event) {
    if (!this.curveDrag) return;
    const { svg, points, handle } = this.curveDrag;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / CURVE.W;
    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;
    const nx = clamp((x - CURVE.L) / (CURVE.R - CURVE.L), 0, 1);
    const ny = clamp((CURVE.B - y) / (CURVE.B - CURVE.T), -0.35, 1.35);
    const next = [...points];
    if (handle === 1) {
      next[0] = nx;
      next[1] = ny;
    } else {
      next[2] = nx;
      next[3] = ny;
    }
    this.curveDrag.points = next;
    this.app.setEasingAt(this.curveDrag.entryId, this.curveDrag.time, next, 'all', false);
    this.updateCurveVisual(next);
  }

  onCurvePointerUp() {
    if (!this.curveDrag) return;
    const drag = this.curveDrag;
    this.curveDrag = null;
    this.app.setEasingAt(drag.entryId, drag.time, drag.points, 'all', true);
  }

  updateCurveVisual(points) {
    const svg = this.body.querySelector('#curve-svg');
    if (!svg) return;
    const graph = this.curvePath(points);
    const path = svg.querySelector('#curve-path');
    if (path) path.setAttribute('d', graph.path);
    const h1 = svg.querySelector('[data-handle="1"]');
    const h2 = svg.querySelector('[data-handle="2"]');
    if (h1) {
      h1.setAttribute('cx', graph.c1.x);
      h1.setAttribute('cy', graph.c1.y);
    }
    if (h2) {
      h2.setAttribute('cx', graph.c2.x);
      h2.setAttribute('cy', graph.c2.y);
    }
    const values = this.body.querySelector('#curve-values');
    if (values) values.textContent = points.map((v) => Number(v).toFixed(2)).join(', ');
  }

  syncTransform() {
    const entry = this.entry;
    if (!entry) return;
    this.body.querySelectorAll('[data-channel]').forEach((input) => {
      if (document.activeElement === input) return;
      const channel = input.dataset.channel;
      const axis = ['x', 'y', 'z'][Number(input.dataset.axis)] || 'x';
      let value = entry.object[channel][axis];
      if (channel === 'rotation') value = (value * 180) / Math.PI;
      input.value = String(Number(value.toFixed(3)));
    });
  }

  onTimeChanged(time) {
    this.body.querySelectorAll('[data-current-time]').forEach((node) => {
      node.textContent = formatTimecode(time, this.app.fps);
    });
    if (this.tab === 'keys') {
      this.body.querySelectorAll('[data-key-time]').forEach((row) => {
        const selected =
          this.app.selectedKey &&
          this.app.selectedKey.id === this.app.selectedId &&
          Math.abs(Number(row.dataset.keyTime) - this.app.selectedKey.time) < 0.0006;
        row.classList.toggle('active', !!selected);
      });
    }
  }
}
