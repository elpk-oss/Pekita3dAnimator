import { TEXTURE_PATTERNS, drawPattern } from '../core/textures.js';
import { escapeHtml, h } from '../utils.js';
import { icon } from '../icons.js';
import { showModal, toast } from './ui.js';

const SIZE = 256;
const MAX_UNDO = 14;

const SWATCHES = ['#f5c542', '#ffffff', '#1b2230', '#000000', '#5aa2ff', '#5ad68c', '#ff9f5a', '#ff7bb0', '#b18cff', '#00b140', '#c98b4b', '#8b5a2b'];

/**
 * Editor de texturas: lienzo para pintar a mano o generar patrones, y aplicar
 * el resultado como mapa de color del objeto seleccionado.
 *
 * Devuelve una promesa con el data URL (o `null` si se cancela).
 */
export function openTextureEditor(options = {}) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.className = 'tex-canvas';
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');

    const state = {
      colorA: '#f5c542',
      colorB: '#1b2230',
      brush: 18,
      tool: 'brush',
      cells: 8,
      seed: 3,
    };

    let settled = false;
    const undoStack = [];

    const fillBase = () => {
      ctx.fillStyle = '#c9ccd4';
      ctx.fillRect(0, 0, SIZE, SIZE);
    };
    fillBase();

    const snapshot = () => {
      undoStack.push(ctx.getImageData(0, 0, SIZE, SIZE));
      if (undoStack.length > MAX_UNDO) undoStack.shift();
    };
    const undo = () => {
      const data = undoStack.pop();
      if (!data) return;
      ctx.putImageData(data, 0, 0);
    };

    const body = h('div', { class: 'tex-editor' });

    const patternButtons = () =>
      TEXTURE_PATTERNS.map((pattern) => {
        const url = (() => {
          const preview = document.createElement('canvas');
          preview.width = 60;
          preview.height = 60;
          drawPattern(preview.getContext('2d'), pattern.id, 60, 60, {
            colorA: state.colorA,
            colorB: state.colorB,
            cells: state.cells,
            seed: state.seed,
          });
          return preview.toDataURL('image/png');
        })();
        return `<button class="tex-pattern" data-pattern="${pattern.id}" title="${escapeHtml(pattern.name)}">
          <img src="${url}" alt="" /><span>${escapeHtml(pattern.name)}</span>
        </button>`;
      }).join('');

    const renderPatterns = () => {
      const grid = body.querySelector('#tex-patterns');
      if (grid) grid.innerHTML = patternButtons();
    };

    body.innerHTML = `
      <div class="tex-layout">
        <div class="tex-stage">
          <div class="tex-canvas-wrap"></div>
          <div class="tex-tools">
            <button class="btn sm ${state.tool === 'brush' ? 'primary' : ''}" data-tool="brush">${icon('sparkles', 11)} Pincel</button>
            <button class="btn sm ${state.tool === 'eraser' ? 'primary' : ''}" data-tool="eraser">Goma</button>
            <button class="btn sm ${state.tool === 'fill' ? 'primary' : ''}" data-tool="fill">${icon('grid', 11)} Relleno</button>
            <button class="btn sm" data-tool="undo">${icon('undo', 11)} Deshacer</button>
          </div>
          <div class="field-row"><label>Grosor</label><input type="range" id="tex-brush" min="2" max="64" step="1" value="${state.brush}" /><span class="val" id="tex-brush-val">${state.brush}px</span></div>
        </div>
        <div class="tex-side">
          <div class="tex-block">
            <h4>Colores</h4>
            <div class="tex-colors">
              <label class="tex-color"><input type="color" id="tex-color-a" value="${state.colorA}" /><span>Principal</span></label>
              <label class="tex-color"><input type="color" id="tex-color-b" value="${state.colorB}" /><span>Secundario</span></label>
            </div>
            <div class="tex-swatches">
              ${SWATCHES.map((color) => `<button class="tex-swatch" data-swatch="${color}" style="background:${color}" title="${color}"></button>`).join('')}
            </div>
          </div>
          <div class="tex-block">
            <h4>Patrones</h4>
            <div class="field-row"><label>Escala</label><input type="range" id="tex-cells" min="2" max="16" step="1" value="${state.cells}" /><span class="val" id="tex-cells-val">${state.cells}</span></div>
            <div class="tex-patterns" id="tex-patterns">${patternButtons()}</div>
          </div>
          <div class="tex-block">
            <h4>Lienzo</h4>
            <div class="btn-row grid2">
              <button class="btn sm" data-action="fill-color">${icon('grid', 11)} Rellenar</button>
              <button class="btn sm" data-action="clear">${icon('trash', 11)} Limpiar</button>
              <button class="btn sm" data-action="invert">Invertir</button>
              <button class="btn sm" data-action="flip">Voltear</button>
            </div>
            <p class="mod-desc">Pinta con el dedo o el ratón. La textura se repite en la pieza.</p>
          </div>
        </div>
      </div>
    `;

    body.querySelector('.tex-canvas-wrap')?.appendChild(canvas);

    const modal = showModal({
      title: 'Crear textura',
      body,
      wide: true,
      className: 'texture-modal',
      actions: [
        {
          label: 'Cancelar',
          onClick: () => {
            settled = true;
            resolve(null);
          },
        },
        {
          label: 'Aplicar al objeto',
          class: 'primary',
          onClick: () => {
            settled = true;
            resolve(canvas.toDataURL('image/png'));
          },
        },
      ],
      onClose: () => {
        if (!settled) resolve(null);
      },
    });
    if (!modal) {
      resolve(null);
      return;
    }

    /* --------- Pintura --------- */
    let drawing = null;

    const pointFromEvent = (event) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * SIZE,
        y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * SIZE,
      };
    };

    const paintAt = (point) => {
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    };

    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      const point = pointFromEvent(event);
      if (state.tool === 'fill') {
        snapshot();
        ctx.fillStyle = state.colorA;
        ctx.fillRect(0, 0, SIZE, SIZE);
        return;
      }
      snapshot();
      drawing = true;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = state.brush;
      ctx.strokeStyle = state.tool === 'eraser' ? '#c9ccd4' : state.colorA;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + 0.01, point.y);
      ctx.stroke();
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!drawing) return;
      event.preventDefault();
      paintAt(pointFromEvent(event));
    });

    const stopDraw = () => {
      drawing = null;
    };
    canvas.addEventListener('pointerup', stopDraw);
    canvas.addEventListener('pointercancel', stopDraw);
    canvas.addEventListener('pointerleave', stopDraw);

    /* --------- Controles --------- */
    const setTool = (tool) => {
      if (tool === 'undo') {
        undo();
        return;
      }
      state.tool = tool;
      body.querySelectorAll('[data-tool]').forEach((button) => {
        if (button.dataset.tool === 'undo') return;
        button.classList.toggle('primary', button.dataset.tool === tool);
      });
    };

    body.querySelectorAll('[data-tool]').forEach((button) => {
      button.addEventListener('click', () => setTool(button.dataset.tool));
    });

    const brushInput = body.querySelector('#tex-brush');
    brushInput?.addEventListener('input', () => {
      state.brush = Number(brushInput.value) || 18;
      const label = body.querySelector('#tex-brush-val');
      if (label) label.textContent = `${state.brush}px`;
    });

    const cellsInput = body.querySelector('#tex-cells');
    cellsInput?.addEventListener('input', () => {
      state.cells = Number(cellsInput.value) || 8;
      const label = body.querySelector('#tex-cells-val');
      if (label) label.textContent = String(state.cells);
      renderPatterns();
    });

    body.querySelector('#tex-color-a')?.addEventListener('input', (event) => {
      state.colorA = event.target.value;
      renderPatterns();
    });
    body.querySelector('#tex-color-b')?.addEventListener('input', (event) => {
      state.colorB = event.target.value;
      renderPatterns();
    });

    body.addEventListener('click', (event) => {
      const swatch = event.target.closest('[data-swatch]');
      if (swatch) {
        state.colorA = swatch.dataset.swatch;
        const input = body.querySelector('#tex-color-a');
        if (input) input.value = state.colorA;
        renderPatterns();
        return;
      }
      const pattern = event.target.closest('[data-pattern]');
      if (pattern) {
        snapshot();
        drawPattern(ctx, pattern.dataset.pattern, SIZE, SIZE, {
          colorA: state.colorA,
          colorB: state.colorB,
          cells: state.cells,
          seed: state.seed,
        });
        return;
      }
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      if (action === 'fill-color') {
        snapshot();
        ctx.fillStyle = state.colorA;
        ctx.fillRect(0, 0, SIZE, SIZE);
      } else if (action === 'clear') {
        snapshot();
        fillBase();
      } else if (action === 'invert') {
        snapshot();
        ctx.fillStyle = state.colorB;
        ctx.globalCompositeOperation = 'difference';
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.globalCompositeOperation = 'source-over';
      } else if (action === 'flip') {
        snapshot();
        const copy = document.createElement('canvas');
        copy.width = SIZE;
        copy.height = SIZE;
        copy.getContext('2d').drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.save();
        ctx.translate(SIZE, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(copy, 0, 0);
        ctx.restore();
      }
    });

    /* --------- Textura actual --------- */
    if (options.sourceDataUrl) {
      const image = new Image();
      image.onload = () => {
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.drawImage(image, 0, 0, SIZE, SIZE);
      };
      image.onerror = () => toast('No se pudo abrir la textura actual.', 'warn', 2200);
      image.src = options.sourceDataUrl;
    }
  });
}
