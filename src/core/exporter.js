import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import JSZip from 'jszip';
import { icon } from '../icons.js';
import { clamp, downloadBlob, escapeHtml, tick } from '../utils.js';
import { showModal, showProgress, toast } from '../ui/ui.js';

const WIDTH = 1920;
const HEIGHT = 1080;

/* ============================================================
   Diálogo de exportación
   ============================================================ */

export function openExportDialog(app) {
  const bounds = app.viewport.getSceneBounds();
  const cameraEntries = app.entries.filter((entry) => entry.type === 'camera' && entry.object?.isCamera);
  const presets = [
    { id: 'center', label: 'Centro', az: 45, el: 18, dist: 3.05 },
    { id: 'far', label: 'Centro lejos', az: 45, el: 18, dist: 4.4 },
    { id: 'near', label: 'Centro cerca', az: 45, el: 14, dist: 2.15 },
    { id: 'low', label: 'Centro abajo', az: 35, el: 2, dist: 2.85 },
    { id: 'front', label: 'Frontal', az: 0, el: 8, dist: 3.05 },
    { id: 'top', label: 'Superior', az: 45, el: 78, dist: 3.25 },
    { id: 'iso', label: 'Isométrica', az: 45, el: 35, dist: 3.15 },
  ];

  const state = {
    mode: 'custom',
    preset: 'center',
    target: bounds.center.clone(),
    distance: bounds.radius * 2.4,
    azimuth: THREE.MathUtils.degToRad(45),
    elevation: THREE.MathUtils.degToRad(18),
    fov: 45,
    camera: new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 4000),
    sceneEntryId: '',
    width: app.renderSize?.width || WIDTH,
    height: app.renderSize?.height || HEIGHT,
    fps: app.fps || 30,
  };
  const radius = Math.max(0.5, bounds.radius);

  const SIZE_PRESETS = [
    { label: 'Horizontal', width: 1920, height: 1080 },
    { label: 'Vertical', width: 1080, height: 1920 },
    { label: 'Cuadrado', width: 1080, height: 1080 },
    { label: 'Retrato', width: 1080, height: 1350 },
    { label: 'HD', width: 1280, height: 720 },
    { label: '4K', width: 3840, height: 2160 },
  ];

  const body = document.createElement('div');
  body.className = 'export-dialog';
  body.innerHTML = `
    <div class="export-layout">
      <div class="export-preview-col">
        <div class="export-preview-wrap" id="export-preview-wrap">
          <canvas id="export-preview-canvas" width="640" height="360"></canvas>
          <div class="export-preview-badge" id="export-preview-badge">VISTA PREVIA · 16:9</div>
          <div class="export-preview-hint" id="export-preview-hint">Arrastra para orbitar · Rueda para zoom</div>
        </div>
        <div class="export-preview-foot">
          <span>
            <button class="btn sm" id="export-play">${icon('play', 10)} Reproducir</button>
          </span>
          <span id="export-preview-info"><b>${state.width}×${state.height}</b> · ${app.duration.toFixed(2)} s · ${state.fps} fps</span>
        </div>
      </div>
      <div class="export-camera-col">
        <div class="export-camera-head">
          <h4>Cámara de exportación</h4>
          <span>El video y los PNG usarán esta vista, no la del editor.</span>
        </div>
        <div class="field-row"><label>Cámara</label>
          <select id="export-camera-select">
            <option value="__custom">Cámara personalizada</option>
            ${cameraEntries.map((entry) => `<option value="${entry.id}">${escapeHtml(entry.name)}</option>`).join('')}
          </select>
        </div>
        <div class="export-presets" id="export-presets">
          ${presets.map((preset) => `<button class="preset-btn" data-preset="${preset.id}">${preset.label}</button>`).join('')}
        </div>
        <div class="export-sliders" id="export-sliders">
          <div class="slider-row"><label>Distancia</label><input type="range" id="export-distance" min="${(radius * 0.3).toFixed(3)}" max="${(radius * 12).toFixed(3)}" step="${(radius * 0.02).toFixed(3)}" /><span class="val" id="export-distance-value">0</span></div>
          <div class="slider-row"><label>FOV</label><input type="range" id="export-fov" min="25" max="85" step="1" value="45" /><span class="val" id="export-fov-value">45°</span></div>
        </div>
        <div class="btn-row">
          <button class="btn" id="export-reset">${icon('focus', 12)} Reiniciar vista</button>
          <button class="btn" id="export-add-camera">${icon('camera', 12)} Añadir cámara</button>
        </div>
        <p class="mod-desc" id="export-camera-note">Cámara libre basada en los límites de la escena. Los presets cambian el encuadre.</p>

        <div class="export-camera-head" style="margin-top:14px">
          <h4>Tamaño de render</h4>
          <span>Vale para imagen y video. Se puede cambiar sin volver a empezar.</span>
        </div>
        <div class="export-sizes" id="export-sizes">
          ${SIZE_PRESETS.map(
            (preset) => `<button class="preset-btn" data-size-w="${preset.width}" data-size-h="${preset.height}">${preset.label}<small>${preset.width}×${preset.height}</small></button>`,
          ).join('')}
        </div>
        <div class="size-row">
          <input type="number" id="export-width" min="64" max="4096" step="1" value="${state.width}" aria-label="Ancho" />
          <button class="btn sm" id="export-swap" title="Girar orientación">${icon('repeat', 12)}</button>
          <input type="number" id="export-height" min="64" max="4096" step="1" value="${state.height}" aria-label="Alto" />
        </div>
        <div class="field-row"><label>FPS</label>
          <select id="export-fps">
            ${[24, 30, 60].map((fps) => `<option value="${fps}" ${fps === state.fps ? 'selected' : ''}>${fps} fps</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    <div class="export-formats">
      <div class="export-format-title">Formato de salida</div>
      <div class="export-grid">
        <button class="export-card yellow" data-export="video">
          <div class="ec-ico">${icon('video', 18)}</div>
          <div><b>Video</b><span>MP4/WebM · <span id="export-card-size">${state.width}×${state.height}</span> · con audio</span></div>
        </button>
        <button class="export-card" data-export="still">
          <div class="ec-ico">${icon('image', 18)}</div>
          <div><b>Imagen PNG</b><span>Fotograma actual · ${state.width}×${state.height}</span></div>
        </button>
        <button class="export-card" data-export="png">
          <div class="ec-ico">${icon('film', 18)}</div>
          <div><b>Secuencia PNG</b><span>ZIP con fotogramas a <span id="export-card-fps">${state.fps}</span> fps</span></div>
        </button>
        <button class="export-card green" data-export="glb">
          <div class="ec-ico">${icon('cube', 18)}</div>
          <div><b>Modelo GLB</b><span>Escena + animación lineal</span></div>
        </button>
        <button class="export-card purple" data-export="project">
          <div class="ec-ico">${icon('save', 18)}</div>
          <div><b>Proyecto .peki</b><span>Escena, fondo, audio, texturas y keys</span></div>
        </button>
      </div>
    </div>
    <p class="mod-desc" style="margin:13px 2px 0">Duración actual: <b>${app.duration.toFixed(2)} s</b> · ${app.fps} fps de timeline · ${app.audio.hasAudio ? 'audio incluido' : 'sin audio'}.</p>
  `;

  let preview = null;
  let raf = 0;
  let drag = null;
  let playingHere = false;
  const stopPreview = () => {
    if (playingHere) {
      playingHere = false;
      app.pause();
    }
    cancelAnimationFrame(raf);
    preview?.dispose();
  };
  const modal = showModal({
    title: 'Exportar',
    body,
    wide: true,
    className: 'export-modal',
    actions: [{ label: 'Cancelar' }],
    onClose: () => {
      app.setRenderSize(state.width, state.height);
      if (state.fps && state.fps !== app.fps) app.setFPS(state.fps);
      stopPreview();
      if (app.autosaveDirty) app.scheduleAutosave?.(900);
    },
  });
  if (!modal) return;

  const canvas = body.querySelector('#export-preview-canvas');
  const previewWrap = body.querySelector('#export-preview-wrap');
  const select = body.querySelector('#export-camera-select');
  const presetButtons = [...body.querySelectorAll('[data-preset]')];
  const distanceInput = body.querySelector('#export-distance');
  const distanceValue = body.querySelector('#export-distance-value');
  const fovInput = body.querySelector('#export-fov');
  const fovValue = body.querySelector('#export-fov-value');
  const hint = body.querySelector('#export-preview-hint');
  const note = body.querySelector('#export-camera-note');

  try {
    preview = app.viewport.createPreviewRenderer(canvas, 640, 360);
  } catch (error) {
    console.error('[PEKITA] Vista previa no disponible', error);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0b0f16';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#8693a8';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('La vista previa no está disponible en este navegador.', canvas.width / 2, canvas.height / 2);
    }
  }
  syncSizeUI();

  function sizeRatio() {
    return Math.max(0.05, state.width / Math.max(1, state.height));
  }

  function updateCamera() {
    if (state.mode !== 'custom') return;
    const camera = state.camera;
    camera.fov = state.fov;
    camera.aspect = sizeRatio();
    camera.near = 0.05;
    camera.far = 4000;
    const horizontal = Math.cos(state.elevation) * state.distance;
    camera.position.set(
      state.target.x + Math.sin(state.azimuth) * horizontal,
      state.target.y + Math.sin(state.elevation) * state.distance,
      state.target.z + Math.cos(state.azimuth) * horizontal,
    );
    camera.lookAt(state.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  /** La vista previa respeta la proporción elegida (16:9, 9:16, 1:1…). */
  function syncSizeUI() {
    const ratio = sizeRatio();
    const baseW = 640;
    const baseH = Math.max(160, Math.round(baseW / ratio));
    if (canvas.width !== baseW || canvas.height !== baseH) {
      canvas.width = baseW;
      canvas.height = baseH;
      try {
        preview?.renderer.setSize(baseW, baseH, false);
      } catch {
        /* el renderer de la vista previa no está disponible */
      }
    }
    if (previewWrap) previewWrap.style.aspectRatio = `${state.width} / ${state.height}`;
    const badge = body.querySelector('#export-preview-badge');
    const ratioLabel = `${(state.width / state.height).toFixed(2).replace('.', ',')}:1`;
    if (badge) badge.textContent = `VISTA PREVIA · ${state.width}×${state.height} (${ratioLabel})`;
    const info = body.querySelector('#export-preview-info');
    if (info) info.innerHTML = `<b>${state.width}×${state.height}</b> · ${app.duration.toFixed(2)} s · ${state.fps} fps`;
    const cardSize = body.querySelector('#export-card-size');
    if (cardSize) cardSize.textContent = `${state.width}×${state.height}`;
    const cardFps = body.querySelector('#export-card-fps');
    if (cardFps) cardFps.textContent = String(state.fps);
    const widthInput = body.querySelector('#export-width');
    const heightInput = body.querySelector('#export-height');
    if (widthInput && document.activeElement !== widthInput && Number(widthInput.value) !== state.width) {
      widthInput.value = String(state.width);
    }
    if (heightInput && document.activeElement !== heightInput && Number(heightInput.value) !== state.height) {
      heightInput.value = String(state.height);
    }
    body.querySelectorAll('[data-size-w]').forEach((button) => {
      button.classList.toggle('on', Number(button.dataset.sizeW) === state.width && Number(button.dataset.sizeH) === state.height);
    });
    if (state.mode === 'scene') {
      const source = app.objects.get(state.sceneEntryId)?.object;
      if (source?.isCamera) {
        source.aspect = ratio;
        source.updateProjectionMatrix();
      }
    }
  }

  function applyPreset(id) {
    const preset = presets.find((item) => item.id === id) || presets[0];
    const current = app.viewport.getSceneBounds();
    state.mode = 'custom';
    state.preset = preset.id;
    state.target.copy(current.center);
    state.distance = Math.max(0.5, current.radius) * preset.dist;
    state.azimuth = THREE.MathUtils.degToRad(preset.az);
    state.elevation = THREE.MathUtils.degToRad(preset.el);
    syncControls();
  }

  function setSceneCamera(id) {
    state.mode = 'scene';
    state.sceneEntryId = id;
    syncControls();
  }

  function syncControls() {
    if (select) select.value = state.mode === 'scene' ? state.sceneEntryId : '__custom';
    for (const button of presetButtons) {
      button.classList.toggle('on', state.mode === 'custom' && button.dataset.preset === state.preset);
    }
    const custom = state.mode === 'custom';
    if (distanceInput) {
      distanceInput.disabled = !custom;
      distanceInput.value = String(state.distance);
    }
    if (distanceValue) distanceValue.textContent = `${state.distance.toFixed(2)} u`;
    if (fovInput) {
      fovInput.disabled = !custom;
      fovInput.value = String(state.fov);
    }
    if (fovValue) fovValue.textContent = `${state.fov}°`;
    if (hint) hint.textContent = custom ? 'Arrastra para orbitar · Rueda para zoom' : 'Vista fija de la cámara de escena';
    if (note) {
      note.textContent = custom
        ? 'Cámara libre basada en los límites de la escena. Los presets cambian el encuadre.'
        : 'La cámara de escena conserva su posición, orientación y FOV. Los presets vuelven a cámara libre.';
    }
    if (previewWrap) previewWrap.classList.toggle('scene-camera', !custom);
  }

  function previewCamera() {
    if (state.mode === 'scene') {
      const source = app.objects.get(state.sceneEntryId)?.object;
      if (source?.isCamera) {
        source.updateWorldMatrix(true, false);
        const clone = source.clone();
        source.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
        clone.aspect = sizeRatio();
        clone.updateProjectionMatrix();
        clone.updateMatrixWorld();
        return clone;
      }
    }
    return state.camera;
  }

  function exportCamera() {
    if (state.mode === 'scene') {
      const source = app.objects.get(state.sceneEntryId)?.object;
      if (source?.isCamera) return source;
    }
    return state.camera;
  }

  applyPreset('center');
  syncControls();

  const playButton = body.querySelector('#export-play');
  const updatePlayButton = () => {
    if (!playButton) return;
    playButton.innerHTML = playingHere ? `${icon('pause', 10)} Pausar` : `${icon('play', 10)} Reproducir`;
    playButton.classList.toggle('primary', playingHere);
  };
  const startPreviewPlayback = () => {
    if (app.currentTime >= app.duration - 0.0001) app.seek(0);
    app.play();
    playingHere = true;
    updatePlayButton();
  };
  const stopPreviewPlayback = () => {
    playingHere = false;
    app.pause();
    updatePlayButton();
    syncSizeUI();
  };
  playButton?.addEventListener('click', () => {
    if (playingHere) stopPreviewPlayback();
    else startPreviewPlayback();
  });
  updatePlayButton();

  const frame = () => {
    updateCamera();
    preview?.render(previewCamera());
    if (playingHere && !app.playing) {
      playingHere = false;
      updatePlayButton();
      syncSizeUI();
    }
    if (playingHere) {
      const info = body.querySelector('#export-preview-info');
      if (info) info.innerHTML = `<b>${app.currentTime.toFixed(2)} s</b> / ${app.duration.toFixed(2)} s · ${state.fps} fps`;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  /* --------- Tamaño de render --------- */
  const widthInput = body.querySelector('#export-width');
  const heightInput = body.querySelector('#export-height');
  const clampSize = (value, fallback) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 16) return fallback;
    return clamp(n, 64, 4096);
  };
  widthInput?.addEventListener('change', () => {
    state.width = clampSize(widthInput.value, state.width);
    syncSizeUI();
  });
  heightInput?.addEventListener('change', () => {
    state.height = clampSize(heightInput.value, state.height);
    syncSizeUI();
  });
  body.querySelectorAll('[data-size-w]').forEach((button) => {
    button.addEventListener('click', () => {
      state.width = Number(button.dataset.sizeW);
      state.height = Number(button.dataset.sizeH);
      syncSizeUI();
    });
  });
  body.querySelector('#export-swap')?.addEventListener('click', () => {
    const w = state.width;
    state.width = state.height;
    state.height = w;
    syncSizeUI();
  });
  body.querySelector('#export-fps')?.addEventListener('change', (event) => {
    state.fps = Number(event.target.value) || 30;
    syncSizeUI();
  });

  select?.addEventListener('change', () => {
    if (select.value === '__custom') {
      state.mode = 'custom';
      syncControls();
    } else {
      setSceneCamera(select.value);
    }
  });

  for (const button of presetButtons) {
    button.addEventListener('click', () => applyPreset(button.dataset.preset));
  }

  distanceInput?.addEventListener('input', () => {
    state.distance = Number(distanceInput.value) || state.distance;
    state.mode = 'custom';
    state.preset = 'custom';
    syncControls();
  });
  fovInput?.addEventListener('input', () => {
    state.fov = Number(fovInput.value) || 45;
    state.mode = 'custom';
    state.preset = 'custom';
    syncControls();
  });

  body.querySelector('#export-reset')?.addEventListener('click', () => applyPreset('center'));

  body.querySelector('#export-add-camera')?.addEventListener('click', () => {
    const source = exportCamera();
    const worldPosition = new THREE.Vector3();
    const worldQuaternion = new THREE.Quaternion();
    source.getWorldPosition(worldPosition);
    source.getWorldQuaternion(worldQuaternion);
    const entry = app.addCamera({ position: worldPosition.toArray(), select: false });
    entry.object.quaternion.copy(worldQuaternion);
    entry.object.fov = source.isPerspectiveCamera ? source.fov : 45;
    entry.object.updateProjectionMatrix();
    app.refreshAll();
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.name;
    select?.append(option);
    setSceneCamera(entry.id);
    toast(`${entry.name} añadida a la escena.`, 'success', 2000);
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (state.mode !== 'custom' || event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    drag = { x: event.clientX, y: event.clientY };
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag = { x: event.clientX, y: event.clientY };
    state.azimuth -= dx * 0.008;
    state.elevation = clamp(state.elevation + dy * 0.006, -1.42, 1.42);
    state.preset = 'custom';
    syncControls();
  });
  const endDrag = () => {
    drag = null;
    canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (state.mode !== 'custom') return;
      event.preventDefault();
      const min = Math.max(0.2, radius * 0.3);
      const max = Math.max(4, radius * 12);
      state.distance = clamp(state.distance * Math.exp(event.deltaY * 0.0012), min, max);
      state.preset = 'custom';
      syncControls();
    },
    { passive: false },
  );

  body.addEventListener('click', (event) => {
    const card = event.target.closest('[data-export]');
    if (!card) return;
    const kind = card.dataset.export;
    const camera = exportCamera();
    const options = { camera, width: state.width, height: state.height, fps: state.fps };
    app.setRenderSize(state.width, state.height);
    if (state.fps !== app.fps) app.setFPS(state.fps);
    if (playingHere) {
      playingHere = false;
      app.pause();
    }
    modal.close();
    if (kind === 'video') exportVideo(app, options);
    else if (kind === 'still') exportStill(app, options);
    else if (kind === 'png') exportPNG(app, options);
    else if (kind === 'glb') exportGLB(app);
    else if (kind === 'project') saveProject(app);
  });
}


/* ============================================================
   Video en tiempo real
   ============================================================ */

function chooseVideoMime() {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  if (typeof MediaRecorder === 'undefined') return null;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || null;
}

export async function exportVideo(app, options = {}) {
  const camera = options.camera || null;
  const { width, height } = resolveOutputSize(app, options);
  const mime = chooseVideoMime();
  if (!mime) {
    toast('Tu navegador no soporta grabación de video. Prueba en Chrome o Edge.', 'error', 5000);
    return;
  }
  if (!app.duration || app.duration <= 0) {
    toast('La duración del proyecto es demasiado corta.', 'warn');
    return;
  }
  await app.waitForAutosave?.();

  const originalTime = app.currentTime;
  let cancelled = false;
  let interrupted = false;
  let recorder = null;
  let audioExport = null;
  let raf = 0;

  // Grabar en tiempo real exige que la pestaña siga visible: si se oculta,
  // requestAnimationFrame se detiene y el video saldría cortado.
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      interrupted = true;
      cancelled = true;
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const progress = showProgress('Exportando video', {
    label: 'Preparando escena…',
    onCancel: () => {
      cancelled = true;
    },
  });

  try {
    app.prepareForExport();
    app.viewport.beginCapture(width, height, camera);
    const canvas = app.viewport.renderer.domElement;
    const stream = canvas.captureStream(60);

    if (app.audio.hasAudio) {
      audioExport = app.audio.createExportSource();
      const track = audioExport?.destination.stream.getAudioTracks()[0];
      if (track) stream.addTrack(track);
    }

    recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: Math.round(clamp((width * height) / 150, 2_000_000, 48_000_000)),
      audioBitsPerSecond: 192_000,
    });
    const chunks = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) chunks.push(event.data);
    });
    const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
    recorder.start(250);

    if (audioExport) {
      const ctx = audioExport.ctx;
      await ctx.resume?.().catch?.(() => {});
      const delay = Math.max(0, app.audio.start);
      try {
        audioExport.source.start(ctx.currentTime + delay, 0);
      } catch {
        /* la fuente ya no está disponible */
      }
    }

    const duration = app.duration;
    const start = performance.now();

    await new Promise((resolve) => {
      const step = () => {
        if (cancelled) {
          resolve();
          return;
        }
        const elapsed = Math.min(duration, (performance.now() - start) / 1000);
        app.currentTime = elapsed;
        app.animation.evaluate(elapsed);
        app.viewport.renderOnce();
        progress.update((elapsed / duration) * 100, `${elapsed.toFixed(2)} s / ${duration.toFixed(2)} s`);
        if (elapsed >= duration) {
          resolve();
          return;
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });

    cancelAnimationFrame(raf);
    try {
      audioExport?.source.stop();
    } catch {
      /* ya terminó */
    }
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;

    if (cancelled) {
      toast(
        interrupted
          ? 'Grabación detenida: mantén esta pestaña visible mientras se exporta el video.'
          : 'Exportación de video cancelada.',
        'info',
        4200,
      );
    } else {
      const type = mime.includes('mp4') ? 'video/mp4' : 'video/webm';
      const extension = mime.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type });
      downloadBlob(blob, `pekita-animate-${Date.now()}.${extension}`);
      toast(`Video exportado (${extension.toUpperCase()}).`, 'success', 3200);
      progress.update(100, 'Listo');
    }
  } catch (error) {
    console.error(error);
    toast(error.message || 'No se pudo exportar el video.', 'error', 5000);
  } finally {
    document.removeEventListener('visibilitychange', onVisibility);
    cancelAnimationFrame(raf);
    try {
      audioExport?.source.stop();
    } catch {
      /* ya terminó */
    }
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch {
      /* ya terminó */
    }
    progress.close();
    app.finishExport();
    app.seek(originalTime);
  }
}

/* ============================================================
   Secuencia PNG
   ============================================================ */

export async function exportPNG(app, options = {}) {
  const camera = options.camera || null;
  const { width, height } = resolveOutputSize(app, options);
  await app.waitForAutosave?.();
  const originalTime = app.currentTime;
  const fps = clamp(Math.round(Number(options.fps) || app.fps), 1, 120);
  const frames = Math.max(1, Math.round(app.duration * fps));
  const progress = showProgress('Exportando secuencia PNG', {
    label: `0 / ${frames} fotogramas`,
    onCancel: () => {},
  });

  try {
    app.prepareForExport();
    app.viewport.beginCapture(width, height, camera);
    const canvas = app.viewport.renderer.domElement;
    const zip = new JSZip();

    for (let i = 0; i < frames; i += 1) {
      if (progress.cancelled) break;
      const time = i / fps;
      app.currentTime = time;
      app.animation.evaluate(time);
      app.viewport.renderOnce();
      const blob = await canvasToBlob(canvas);
      if (blob) zip.file(`frame_${String(i).padStart(4, '0')}.png`, blob);
      progress.update((i / frames) * 100, `${i + 1} / ${frames} fotogramas`);
      await tick();
    }

    if (progress.cancelled) {
      toast('Exportación PNG cancelada.', 'info');
      progress.close();
      return;
    }

    progress.update(96, 'Comprimiendo ZIP…');
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },
      (metadata) => progress.update(96 + metadata.percent * 0.04, 'Comprimiendo ZIP…'),
    );
    downloadBlob(blob, `pekita-frames-${Date.now()}.zip`);
    progress.update(100, 'Listo');
    toast(`Secuencia PNG exportada (${frames} fotogramas).`, 'success', 3500);
  } catch (error) {
    console.error(error);
    toast(error.message || 'No se pudo exportar la secuencia PNG.', 'error', 5000);
  } finally {
    progress.close();
    app.finishExport();
    app.seek(originalTime);
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

/** Tamaño de salida: el del proyecto, salvo que el diálogo lo cambie. */
function resolveOutputSize(app, options = {}) {
  const fallback = app.renderSize || { width: WIDTH, height: HEIGHT };
  const width = Math.round(clamp(Number(options.width) || fallback.width || WIDTH, 64, 4096));
  const height = Math.round(clamp(Number(options.height) || fallback.height || HEIGHT, 64, 4096));
  return { width, height };
}

/* ============================================================
   Imagen fija (fotograma actual)
   ============================================================ */

export async function exportStill(app, options = {}) {
  const camera = options.camera || null;
  const { width, height } = resolveOutputSize(app, options);
  await app.waitForAutosave?.();
  const originalTime = app.currentTime;
  const progress = showProgress('Exportando imagen', { label: 'Renderizando fotograma…' });
  try {
    app.prepareForExport();
    app.viewport.beginCapture(width, height, camera);
    app.animation.evaluate(app.currentTime);
    app.viewport.renderOnce();
    const blob = await canvasToBlob(app.viewport.renderer.domElement);
    if (blob) downloadBlob(blob, `pekita-imagen-${Date.now()}.png`);
    progress.update(100, 'Listo');
    toast(`Imagen exportada (${width}×${height}).`, 'success', 3000);
  } catch (error) {
    console.error(error);
    toast(error.message || 'No se pudo exportar la imagen.', 'error', 5000);
  } finally {
    progress.close();
    app.finishExport();
    app.seek(originalTime);
  }
}

/* ============================================================
   GLB + animación
   ============================================================ */

/**
 * Genera un clip compatible con glTF. Para conservar las curvas Bézier se
 * muestrea la animación en cada fotograma; glTF solo admite interpolación
 * lineal/step y el resultado visual es idéntico al del editor.
 */
export function buildAnimationClip(app, options = {}) {
  const bake = options.bake !== false;
  const fps = Math.max(1, Math.min(60, Math.round(app.fps || 30)));
  const tracks = [];
  const isLinear = (key) =>
    !key?.easing ||
    key.easing.every((value, index) => Math.abs(value - [0, 0, 1, 1][index]) < 1e-4);

  const addRotationTrack = (entry, times, rotations) => {
    const values = [];
    const euler = new THREE.Euler(0, 0, 0, entry.object.rotation.order);
    const quat = new THREE.Quaternion();
    const previous = new THREE.Quaternion();
    let hasPrevious = false;
    for (const rotation of rotations) {
      euler.set(rotation[0], rotation[1], rotation[2]);
      quat.setFromEuler(euler);
      if (hasPrevious && previous.dot(quat) < 0) {
        quat.set(-quat.x, -quat.y, -quat.z, -quat.w);
      }
      previous.copy(quat);
      hasPrevious = true;
      values.push(quat.x, quat.y, quat.z, quat.w);
    }
    const track = new THREE.QuaternionKeyframeTrack(`${entry.object.name}.quaternion`, times, values);
    track.setInterpolation(THREE.InterpolateLinear);
    tracks.push(track);
  };

  const addVectorTrack = (entry, channel, times, values) => {
    const track = new THREE.VectorKeyframeTrack(`${entry.object.name}.${channel}`, times, values);
    track.setInterpolation(THREE.InterpolateLinear);
    tracks.push(track);
  };

  for (const entry of app.entries) {
    if (!entry.object?.name) continue;
    for (const channel of ['position', 'rotation', 'scale']) {
      const keys = entry.tracks?.[channel]?.keys || [];
      if (!keys.length) continue;

      const linear = keys.every((key) => isLinear(key));
      let times;
      let samples;
      if (bake && !linear) {
        // Solo es necesario hornear los tramos con curvas Bézier.
        const first = keys[0].time;
        const last = keys[keys.length - 1].time;
        const steps = Math.max(1, Math.ceil((last - first) * fps));
        times = [];
        samples = [];
        for (let step = 0; step <= steps; step += 1) {
          const time = Math.min(last, first + step / fps);
          const value = app.animation.sample(entry, channel, time);
          if (!value) continue;
          if (times.length && Math.abs(times[times.length - 1] - time) < 1e-6) continue;
          times.push(time);
          samples.push(value);
        }
      } else {
        times = keys.map((key) => key.time);
        samples = keys.map((key) => key.value);
      }
      if (!times.length) continue;

      if (channel === 'rotation') {
        addRotationTrack(entry, times, samples);
      } else {
        const values = [];
        for (const value of samples) values.push(value[0], value[1], value[2]);
        addVectorTrack(entry, channel, times, values);
      }
    }
  }
  if (!tracks.length) return null;
  return new THREE.AnimationClip('PEKITA Animation', app.duration, tracks);
}

export async function buildGLBBlob(app, includeAnimations = true) {
  const viewport = app.viewport;
  viewport.detachForModelExport();
  try {
    const clip = includeAnimations ? buildAnimationClip(app) : null;
    const options = {
      binary: true,
      onlyVisible: false,
      animations: clip ? [clip] : [],
    };
    return await new Promise((resolve, reject) => {
      new GLTFExporter().parse(
        viewport.scene,
        (result) => resolve(new Blob([result], { type: 'model/gltf-binary' })),
        (error) => reject(error instanceof Error ? error : new Error('Error al generar el GLB.')),
        options,
      );
    });
  } finally {
    viewport.reattachAfterModelExport();
  }
}

export async function exportGLB(app) {
  await app.waitForAutosave?.();
  const progress = showProgress('Exportando modelo GLB', { label: 'Generando escena…' });
  const wasExporting = app.exporting;
  try {
    app.exporting = true;
    app.viewport.setSuspended(true);
    progress.update(20, 'Generando escena…');
    const blob = await buildGLBBlob(app, true);
    progress.update(85, 'Preparando descarga…');
    downloadBlob(blob, `pekita-model-${Date.now()}.glb`);
    progress.update(100, 'Listo');
    const clip = buildAnimationClip(app);
    toast(clip ? 'GLB exportado con animación (interpolación lineal).' : 'GLB exportado.', 'success', 3600);
  } catch (error) {
    console.error(error);
    toast(error.message || 'No se pudo exportar el GLB.', 'error', 5000);
  } finally {
    progress.close();
    app.exporting = wasExporting;
    app.viewport.setSuspended(false);
    app.finishExport();
  }
}

/* ============================================================
   Proyecto .peki
   ============================================================ */

export async function buildProjectBlob(app, onProgress = () => {}) {
  // La identidad viaja en extras del GLB: los nombres pueden cambiar al
  // pasar por glTF (espacios -> guiones bajos), los ids no.
  for (const entry of app.entries) entry.object.userData.pekitaId = entry.id;

  onProgress(15, 'Generando escena 3D…');
  const glb = await buildGLBBlob(app, false);

  onProgress(55, 'Guardando keyframes y curvas…');
  const project = {
    format: 'pekita-animate-3d',
    version: 1,
    name: 'Proyecto PEKITA',
    createdAt: new Date().toISOString(),
    duration: app.duration,
    fps: app.fps,
    currentTime: app.currentTime,
    loop: app.loop,
    autoKey: app.autoKey,
    selectedId: app.selectedEntry?.id || null,
    selectedName: app.selectedEntry?.object?.name || null,
    activeCameraId: app.activeCameraEntry?.id || null,
    activeCameraName: app.activeCameraEntry?.object?.name || null,
    render: {
      width: app.renderSize?.width || 1920,
      height: app.renderSize?.height || 1080,
    },
    textures: [
      ...new Map(
        app.entries
          .flatMap((entry) => [entry.textureId, entry.normalMapId])
          .filter((id) => id && app.textures.get(id))
          .map((id) => {
            const record = app.textures.get(id);
            return [
              id,
              {
                id,
                name: record.name || 'Textura',
                file: `texture-${id}.png`,
                repeat: app.entries.find((entry) => entry.textureId === id)?.textureRepeat ?? 1,
              },
            ];
          }),
      ).values(),
    ],
    objects: app.entries.map((entry) => ({
      id: entry.id,
      name: entry.object.name,
      type: entry.type,
      color: entry.color,
      visible: entry.visible,
      locked: entry.locked,
      tracks: entry.tracks,
      textureId: entry.textureId || null,
      textureRepeat: entry.textureRepeat ?? 1,
      normalMapId: entry.normalMapId || null,
      normalScale: entry.normalScale ?? 1,
      primitive: entry.primitive ? { kind: entry.primitive.kind, params: entry.primitive.params } : null,
    })),
    audio: app.audio.hasAudio
      ? {
          name: app.audio.name,
          fileName: app.audio.fileName || 'audio.wav',
          mime: app.audio.mime || 'audio/wav',
          start: app.audio.start,
          volume: app.audio.volume,
        }
      : null,
    background: app.background
      ? {
          name: app.background.name,
          fileName: app.background.fileName || 'background.png',
          mime: app.background.mime || 'image/png',
          presetId: app.background.presetId || null,
        }
      : null,
  };

  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(project));
  zip.file('scene.glb', glb);
  if (app.audio.hasAudio && app.audio.fileBuffer) {
    zip.file(`audio/${project.audio.fileName}`, app.audio.fileBuffer);
  }
  if (app.background?.fileBuffer) {
    zip.file(`background/${project.background.fileName}`, app.background.fileBuffer);
  }
  for (const texture of project.textures) {
    const record = app.textures.get(texture.id);
    if (!record?.dataUrl) continue;
    zip.file(`textures/${texture.file}`, record.dataUrl.split(',')[1] || '', { base64: true });
  }
  onProgress(78, 'Comprimiendo proyecto…');
  return zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (metadata) => onProgress(78 + metadata.percent * 0.2, 'Comprimiendo proyecto…'),
  );
}

export async function saveProject(app) {
  await app.waitForAutosave?.();
  const progress = showProgress('Guardando proyecto', { label: 'Empaquetando escena…' });
  const wasExporting = app.exporting;
  const originalTime = app.currentTime;
  try {
    app.exporting = true;
    app.viewport.setSuspended(true);
    const blob = await buildProjectBlob(app, (percent, label) => progress.update(percent, label));
    downloadBlob(blob, `pekita-proyecto-${Date.now()}.peki`);
    progress.update(100, 'Listo');
    toast('Proyecto .peki guardado.', 'success', 3000);
  } catch (error) {
    console.error(error);
    toast(error.message || 'No se pudo guardar el proyecto.', 'error', 5000);
  } finally {
    progress.close();
    app.exporting = wasExporting;
    app.viewport.setSuspended(false);
    app.finishExport();
    app.seek(originalTime);
  }
}

export async function loadProjectFile(app, file) {
  const progress = showProgress('Abriendo proyecto', { label: 'Leyendo archivo…' });
  const wasExporting = app.exporting;
  app.exporting = true;
  try {
    const zip = await JSZip.loadAsync(file);
    const projectFile = zip.file('project.json');
    if (!projectFile) throw new Error('El archivo no contiene project.json.');
    const project = JSON.parse(await projectFile.async('text'));
    if (project.format !== 'pekita-animate-3d') throw new Error('El archivo no es un proyecto de PEKITA ANIMATE 3D.');

    const sceneFile = zip.file('scene.glb');
    if (!sceneFile) throw new Error('El proyecto no contiene scene.glb.');
    progress.update(30, 'Cargando escena 3D…');
    const glb = await sceneFile.async('arraybuffer');
    const gltf = await new Promise((resolve, reject) => {
      new GLTFLoader().parse(glb, '', resolve, reject);
    });

    progress.update(65, 'Restaurando keyframes…');
    app.clearScene();
    const roots = [...gltf.scene.children];
    if (!roots.length) roots.push(gltf.scene);
    for (const root of roots) {
      if (root.parent) root.parent.remove(root);
      root.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      app.viewport.scene.add(root);
      app.registerImportedRoot(root, root.name || 'Objeto', []);
    }

    const metaById = new Map((project.objects || []).filter((item) => item.id).map((item) => [item.id, item]));
    const metaByName = new Map((project.objects || []).map((item) => [item.name, item]));

    // Texturas del proyecto: se registran para poder reutilizarlas o editarlas.
    const textureMeta = new Map((project.textures || []).map((item) => [item.id, item]));
    for (const [id, meta] of textureMeta) {
      try {
        const file = zip.file(`textures/${meta.file}`) || zip.file(meta.file);
        if (!file) continue;
        const base64 = await file.async('base64');
        app.textures.set(id, { id, name: meta.name || 'Textura', dataUrl: `data:image/png;base64,${base64}` });
      } catch (error) {
        console.warn('[PEKITA] Textura del proyecto no restaurada', error);
      }
    }

    for (const entry of app.entries) {
      const pekitaId = entry.object.userData?.pekitaId;
      const meta = (pekitaId && metaById.get(pekitaId)) || metaByName.get(entry.object.name);
      if (!meta) continue;
      if (meta.name) {
        entry.name = meta.name;
        entry.object.name = meta.name;
      }
      if (meta.type) entry.type = meta.type;
      entry.tracks = meta.tracks || entry.tracks;
      entry.color = meta.color || entry.color;
      entry.visible = meta.visible !== false;
      entry.object.visible = entry.visible;
      entry.locked = !!meta.locked;
      if (meta.primitive?.kind) entry.primitive = { kind: meta.primitive.kind, params: meta.primitive.params || {} };
      entry.textureRepeat = Number(meta.textureRepeat) || 1;
      if (meta.textureId && app.textures.has(meta.textureId)) {
        entry.textureId = meta.textureId;
        const repeat = entry.textureRepeat;
        entry.object.traverse((node) => {
          if (!node.isMesh) return;
          const apply = (material) => {
            if (!material?.map) return material;
            material.map.repeat.set(repeat, repeat);
            return material;
          };
          node.material = Array.isArray(node.material) ? node.material.map(apply) : apply(node.material);
        });
      }
      entry.normalScale = Number(meta.normalScale) || 1;
      if (meta.normalMapId && app.textures.has(meta.normalMapId)) {
        const record = app.textures.get(meta.normalMapId);
        try {
          await app.applyNormalMap(record.dataUrl, record.name || 'Mapa de normales', {
            entry,
            silent: true,
            scale: entry.normalScale,
            record,
          });
        } catch (error) {
          console.warn('[PEKITA] Mapa de normales del proyecto no restaurado', error);
        }
      }
    }

    if (project.render) app.setRenderSize(project.render.width, project.render.height);
    app.duration = Number(project.duration) || 8;
    app.fps = Number(project.fps) || 30;
    app.loop = project.loop !== false;
    app.autoKey = !!project.autoKey;
    app.currentTime = Math.min(Number(project.currentTime) || 0, app.duration);
    app.animation.evaluate(app.currentTime);

    const selectedById = project.selectedId
      ? app.entries.find((entry) => entry.object.userData?.pekitaId === project.selectedId)
      : null;
    const selected = selectedById || app.entries.find((entry) => entry.object.name === project.selectedName);
    if (selected) app.select(selected.id);
    else {
      const first = app.entries.find((entry) => entry.type === 'mesh' || entry.type === 'model');
      if (first) app.select(first.id);
    }

    if (project.activeCameraId || project.activeCameraName) {
      const cam =
        app.entries.find((entry) => entry.type === 'camera' && entry.object.userData?.pekitaId === project.activeCameraId) ||
        app.entries.find((entry) => entry.type === 'camera' && entry.object.name === project.activeCameraName);
      if (cam) {
        app.activeCameraId = cam.id;
        app.viewport.setActiveCamera(cam.object);
      }
    }
    app.refreshCameraHud();

    if (project.audio) {
      progress.update(82, 'Restaurando audio…');
      const audioFile =
        zip.file(`audio/${project.audio.fileName}`) ||
        zip.file(project.audio.fileName) ||
        zip.file('audio/audio.wav');
      if (audioFile) {
        try {
          const buffer = await audioFile.async('arraybuffer');
          await app.audio.loadArrayBuffer(buffer, {
            name: project.audio.name || 'Audio',
            fileName: project.audio.fileName,
            mime: project.audio.mime,
          });
          app.audio.setStart(project.audio.start || 0);
          app.audio.setVolume(project.audio.volume ?? 0.85);
        } catch (error) {
          console.warn('[PEKITA] Audio del proyecto no cargado', error);
          toast('El proyecto se abrió, pero el audio no pudo decodificarse.', 'warn', 4000);
        }
      }
    }

    if (project.background) {
      progress.update(88, 'Restaurando fondo…');
      const backgroundFile =
        zip.file(`background/${project.background.fileName}`) ||
        zip.file(project.background.fileName) ||
        zip.file('background/background.png');
      if (backgroundFile) {
        try {
          const buffer = await backgroundFile.async('arraybuffer');
          await app.loadBackgroundArrayBuffer(buffer, {
            name: project.background.name || 'Fondo',
            fileName: project.background.fileName || 'background.png',
            mime: project.background.mime || 'image/png',
            presetId: project.background.presetId || null,
            silent: true,
          });
        } catch (error) {
          console.warn('[PEKITA] Fondo del proyecto no cargado', error);
          toast('El proyecto se abrió, pero el fondo no pudo cargarse.', 'warn', 4000);
        }
      }
    }

    // El estado recién abierto se convierte en el primer paso del historial:
    // así Ctrl+Z vuelve a este punto en lugar de encontrarse el historial vacío.
    const keepExporting = app.exporting;
    app.exporting = false;
    app.clearHistory();
    app.exporting = keepExporting;
    app.refreshAll();
    app.timeline?.setPlayhead(app.currentTime);
    app.topbar?.refresh();
    progress.update(100, 'Listo');
    toast(`Proyecto abierto · ${app.entries.length} objetos.`, 'success', 3000);
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    progress.close();
    app.exporting = wasExporting;
    app.viewport.setSuspended(false);
    if (!wasExporting) app.scheduleAutosave(700);
  }
}
