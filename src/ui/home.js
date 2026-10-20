import { BACKGROUND_PRESETS, presetThumbnail } from '../core/backgrounds.js';
import { logoP, icon } from '../icons.js';
import { clamp, escapeHtml, h } from '../utils.js';
import { toast } from './ui.js';

const SIZE_PRESETS = [
  { id: 'landscape', label: 'Horizontal', width: 1920, height: 1080, hint: '16:9 · YouTube' },
  { id: 'vertical', label: 'Vertical', width: 1080, height: 1920, hint: '9:16 · Reels' },
  { id: 'square', label: 'Cuadrado', width: 1080, height: 1080, hint: '1:1 · Feed' },
  { id: 'portrait', label: 'Retrato', width: 1080, height: 1350, hint: '4:5' },
  { id: 'hd', label: 'HD rápido', width: 1280, height: 720, hint: '720p' },
  { id: 'uhd', label: '4K', width: 3840, height: 2160, hint: 'Máxima calidad' },
];

const FPS_OPTIONS = [24, 30, 60];

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

function ratioLabel(width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const d = gcd(w, h) || 1;
  const rw = Math.round(w / d);
  const rh = Math.round(h / d);
  if (rw > 40 || rh > 40) return (w / h).toFixed(2).replace('.', ',');
  return `${rw}:${rh}`;
}

/**
 * Pantalla principal: elegir tamaño de render, duración, fps y fondo antes de
 * entrar al editor. También permite continuar el autoguardado, abrir un .peki
 * o importar un modelo directamente.
 */
export function openHome(app, options = {}) {
  const hasAutosave = !!options.hasAutosave;
  const overlay = h('div', { class: 'home' });
  document.body.classList.add('home-open');

  const initial = app.renderSize || { width: 1920, height: 1080 };
  const state = {
    width: initial.width,
    height: initial.height,
    fps: app.fps || 30,
    duration: app.duration || 8,
    background: '',
  };

  overlay.innerHTML = `
    <div class="home-inner">
      <header class="home-head">
        <div class="home-brand">${logoP(46)}<div><strong>PEKITA</strong><span>ANIMATE 3D</span></div></div>
        <p class="home-tag">Elige el tamaño de render y entra al estudio. El tamaño se usa igual para imagen y video.</p>
      </header>

      <div class="home-columns">
        <section class="home-panel">
          <h4>${icon('grid', 13)} Tamaño de render</h4>
          <div class="home-sizes">
            ${SIZE_PRESETS.map(
              (preset) => `<button class="home-size" data-size="${preset.id}" data-w="${preset.width}" data-h="${preset.height}">
                <b>${preset.label}</b><span>${preset.width}×${preset.height}</span><i>${preset.hint}</i>
              </button>`,
            ).join('')}
          </div>
          <div class="home-custom">
            <input type="number" id="home-width" min="64" max="7680" step="1" value="${state.width}" aria-label="Ancho" />
            <button class="home-swap" id="home-swap" title="Girar orientación">${icon('repeat', 14)}</button>
            <input type="number" id="home-height" min="64" max="7680" step="1" value="${state.height}" aria-label="Alto" />
          </div>
          <p class="home-ratio">Proporción <b id="home-ratio">${ratioLabel(state.width, state.height)}</b> · <span id="home-mp">0 MP</span></p>
          <div class="field-row"><label>FPS</label>
            <select id="home-fps">
              ${FPS_OPTIONS.map((fps) => `<option value="${fps}" ${fps === state.fps ? 'selected' : ''}>${fps} fps</option>`).join('')}
            </select>
          </div>
          <div class="field-row"><label>Duración</label>
            <input type="number" id="home-duration" min="1" max="600" step="1" value="${Math.round(state.duration)}" /><span class="unit">s</span>
          </div>
        </section>

        <section class="home-panel">
          <h4>${icon('image', 13)} Fondo inicial</h4>
          <div class="home-bgs" id="home-bgs">
            <button class="home-bg selected" data-bg="" title="Sin fondo"><span class="bg-none">Ninguno</span><i>Sin fondo</i></button>
            ${BACKGROUND_PRESETS.map(
              (preset) => `<button class="home-bg" data-bg="${preset.id}" title="${escapeHtml(preset.name)}">
                <img src="${presetThumbnail(preset.id, 132, 76)}" alt="" /><i>${escapeHtml(preset.name)}</i>
              </button>`,
            ).join('')}
          </div>
          <p class="mod-desc">Fondos listos para usar (croma, cielo, estudio…). Puedes cambiarlo cuando quieras en <b>Inspector → Escena</b>.</p>
        </section>
      </div>

      <div class="home-actions">
        <button class="home-btn primary" id="home-create">${icon('plus', 14)} Crear proyecto</button>
        <button class="home-btn" id="home-continue" ${hasAutosave ? '' : 'disabled'}>
          ${icon('clock', 14)} Continuar${hasAutosave && options.autosaveLabel ? ` <small>${escapeHtml(options.autosaveLabel)}</small>` : ''}
        </button>
        <button class="home-btn" id="home-open">${icon('folderOpen', 14)} Abrir proyecto</button>
        <button class="home-btn" id="home-import">${icon('upload', 14)} Importar modelo</button>
      </div>
      <p class="home-foot">
        ${hasAutosave ? 'Hay un proyecto guardado en este navegador.' : 'Todo se guarda automáticamente en este navegador.'}
        Atajos: <kbd>Ctrl</kbd>+<kbd>Z</kbd> deshacer · <kbd>Espacio</kbd> reproducir · <kbd>Ctrl</kbd>+<kbd>E</kbd> exportar.
      </p>
    </div>
  `;

  document.body.appendChild(overlay);
  app.homeOpen = true;

  const widthInput = overlay.querySelector('#home-width');
  const heightInput = overlay.querySelector('#home-height');
  const fpsInput = overlay.querySelector('#home-fps');
  const durationInput = overlay.querySelector('#home-duration');

  const refreshInfo = () => {
    overlay.querySelector('#home-ratio').textContent = ratioLabel(state.width, state.height);
    overlay.querySelector('#home-mp').textContent = `${((state.width * state.height) / 1e6).toFixed(2)} MP`;
    overlay.querySelectorAll('.home-size').forEach((button) => {
      const match = Number(button.dataset.w) === state.width && Number(button.dataset.h) === state.height;
      button.classList.toggle('selected', match);
    });
  };

  const syncInputs = () => {
    widthInput.value = String(state.width);
    heightInput.value = String(state.height);
    refreshInfo();
  };

  widthInput.addEventListener('input', () => {
    state.width = clamp(Math.round(Number(widthInput.value) || state.width), 64, 7680);
    refreshInfo();
  });
  heightInput.addEventListener('input', () => {
    state.height = clamp(Math.round(Number(heightInput.value) || state.height), 64, 7680);
    refreshInfo();
  });
  overlay.querySelector('#home-swap').addEventListener('click', () => {
    const w = state.width;
    state.width = state.height;
    state.height = w;
    syncInputs();
  });
  fpsInput.addEventListener('change', () => {
    state.fps = Number(fpsInput.value) || 30;
  });
  durationInput.addEventListener('input', () => {
    state.duration = clamp(Math.round(Number(durationInput.value) || 8), 1, 600);
  });

  overlay.querySelectorAll('.home-size').forEach((button) => {
    button.addEventListener('click', () => {
      state.width = Number(button.dataset.w);
      state.height = Number(button.dataset.h);
      syncInputs();
    });
  });

  overlay.querySelectorAll('.home-bg').forEach((button) => {
    button.addEventListener('click', () => {
      state.background = button.dataset.bg || '';
      overlay.querySelectorAll('.home-bg').forEach((item) => item.classList.toggle('selected', item === button));
    });
  });

  refreshInfo();

  const close = () => {
    if (!overlay.isConnected) return;
    overlay.remove();
    document.body.classList.remove('home-open');
    app.homeOpen = false;
    unbindKeys();
    app.scheduleAutosave?.(1400);
  };

  let started = false;
  const startProject = (extra = {}) => {
    if (started) return;
    started = true;
    close();
    app.startNewProject({
      width: state.width,
      height: state.height,
      fps: state.fps,
      duration: state.duration,
      background: state.background || null,
      ...extra,
    });
  };

  overlay.querySelector('#home-create').addEventListener('click', () => startProject());

  overlay.querySelector('#home-continue').addEventListener('click', async () => {
    if (!hasAutosave) {
      startProject();
      return;
    }
    close();
    const ok = await app.restoreAutosave();
    if (!ok) startProject();
  });

  overlay.querySelector('#home-open').addEventListener('click', () => {
    const input = document.getElementById('file-project');
    if (!input) return;
    input.addEventListener(
      'change',
      () => {
        close();
      },
      { once: true },
    );
    app.triggerOpenProject();
  });

  overlay.querySelector('#home-import').addEventListener('click', () => {
    if (started) return;
    // Proyecto con escena base (cámara y luces) y luego se añade el modelo.
    startProject();
    toast('Elige el modelo que quieres importar.', 'info', 2400);
    app.triggerImport();
  });

  const onKey = (event) => {
    if (!overlay.isConnected) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      startProject();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      startProject();
    }
  };
  const bindKeys = () => window.addEventListener('keydown', onKey);
  const unbindKeys = () => window.removeEventListener('keydown', onKey);
  bindKeys();

  return {
    close,
    open() {
      if (!overlay.isConnected) document.body.appendChild(overlay);
      app.homeOpen = true;
      document.body.classList.add('home-open');
      bindKeys();
    },
    node: overlay,
  };
}
