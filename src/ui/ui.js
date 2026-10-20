import { icon } from '../icons.js';
import { escapeHtml, h } from '../utils.js';

export function toast(message, type = 'success', duration = 3000) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const iconName = type === 'error' ? 'warning' : type === 'warn' ? 'warning' : type === 'info' ? 'info' : 'check';
  const node = h('div', { class: `toast ${type}` }, h('span', { class: 't-ico', html: icon(iconName, 15) }), h('span', { text: message }));
  root.appendChild(node);
  while (root.children.length > 4) root.firstElementChild?.remove();
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 220);
  }, duration);
}

export function showModal(options = {}) {
  const {
    title = '',
    body = '',
    actions = [],
    wide = false,
    onClose = null,
    closeOnBackdrop = true,
    className = '',
  } = options;

  const root = document.getElementById('modal-root');
  if (!root) return null;

  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', { class: `modal ${wide ? 'wide' : ''} ${className}`.trim() });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    onClose?.();
  };

  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };

  const header = h(
    'div',
    { class: 'modal-head' },
    h('h3', { text: title }),
    h('button', { class: 'close', title: 'Cerrar (Esc)', html: icon('close', 15), onClick: close }),
  );

  const bodyNode = h('div', { class: 'modal-body' });
  if (body instanceof Node) bodyNode.appendChild(body);
  else bodyNode.innerHTML = body;

  const foot = h('div', { class: 'modal-foot' });
  for (const action of actions) {
    const button = h('button', {
      class: `btn ${action.class || ''}`,
      text: action.label,
      onClick: async () => {
        try {
          const result = await action.onClick?.(close);
          if (result !== false && action.keepOpen !== true) close();
        } catch (error) {
          console.error(error);
          toast(error.message || 'Ocurrió un error.', 'error');
        }
      },
    });
    foot.appendChild(button);
  }
  if (!actions.length) {
    foot.appendChild(h('button', { class: 'btn primary', text: 'Listo', onClick: close }));
  }

  modal.append(header, bodyNode, foot);
  backdrop.appendChild(modal);
  backdrop.addEventListener('pointerdown', (event) => {
    if (closeOnBackdrop && event.target === backdrop) close();
  });
  root.appendChild(backdrop);
  document.addEventListener('keydown', onKey);

  return { close, modal, body: bodyNode, foot };
}

export function confirmDialog(title, message, confirmLabel = 'Confirmar', options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value, close) => {
      if (settled) return;
      settled = true;
      resolve(value);
      close();
    };
    const modal = showModal({
      title,
      body: `<p>${escapeHtml(message)}</p>`,
      actions: [
        { label: 'Cancelar', onClick: (close) => finish(false, close) },
        {
          label: confirmLabel,
          class: options.danger ? 'danger' : 'primary',
          onClick: (close) => finish(true, close),
        },
      ],
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });
    return modal;
  });
}

export function showProgress(title, options = {}) {
  let cancelled = false;
  const body = h(
    'div',
    { class: 'progress-wrap' },
    h('div', { class: 'progress-track' }, h('div', { class: 'progress-fill' })),
    h(
      'div',
      { class: 'progress-meta' },
      h('span', { class: 'progress-label', text: options.label || 'Procesando…' }),
      h('span', { class: 'progress-value', text: '0%' }),
    ),
  );

  const handle = showModal({
    title,
    body,
    actions: [
      {
        label: 'Cancelar',
        class: 'danger',
        onClick: (close) => {
          cancelled = true;
          options.onCancel?.();
          close();
        },
      },
    ],
    closeOnBackdrop: false,
  });

  const fill = body.querySelector('.progress-fill');
  const label = body.querySelector('.progress-label');
  const value = body.querySelector('.progress-value');

  return {
    update(percent, text) {
      const p = Math.max(0, Math.min(100, Number(percent) || 0));
      if (fill) fill.style.width = `${p}%`;
      if (value) value.textContent = `${Math.round(p)}%`;
      if (text && label) label.textContent = text;
    },
    close: () => handle?.close(),
    get cancelled() {
      return cancelled;
    },
  };
}

export function openHelpModal() {
  const shortcuts = [
    ['Mover / Rotar / Escalar', 'W / E / R'],
    ['Seleccionar', 'Q'],
    ['Reproducir / Pausar', 'Espacio'],
    ['Añadir keyframe', 'K'],
    ['Enfocar seleccionado', 'F'],
    ['Enfocar todo', 'Inicio'],
    ['Frame anterior / siguiente', '← / →'],
    ['Eliminar keyframe / objeto', 'Supr'],
    ['Deshacer / Rehacer', 'Ctrl+Z / Ctrl+Y'],
    ['Importar modelo', 'Ctrl+I'],
    ['Guardar proyecto', 'Ctrl+S'],
    ['Abrir proyecto', 'Ctrl+O'],
    ['Exportar', 'Ctrl+E'],
    ['Duplicar objeto', 'Ctrl+D'],
    ['Salir de cámara / deseleccionar', 'Esc'],
  ];
  const rows = shortcuts
    .map(
      ([label, keys]) =>
        `<div class="sc-row"><span>${escapeHtml(label)}</span><span>${keys
          .split(' / ')
          .map((k) => `<kbd>${escapeHtml(k)}</kbd>`)
          .join(' / ')}</span></div>`,
    )
    .join('');

  showModal({
    title: 'Atajos de teclado',
    wide: true,
    body: `<div class="shortcuts">${rows}</div>
      <p style="margin-top:14px">Consejo: activa <b>Auto Key</b> para que cada cambio de posición, rotación o escala cree una clave automáticamente en el fotograma actual.</p>`,
    actions: [{ label: 'Entendido', class: 'primary' }],
  });
}

export function openAboutModal() {
  showModal({
    title: 'Acerca de PEKITA ANIMATE 3D',
    body: `<p><b>PEKITA ANIMATE 3D</b> es un estudio de animación 3D en el navegador: viewport estilo Blender, timeline estilo CapCut, inspector con keyframes y curvas Bézier.</p>
      <p>Importa GLB, GLTF, OBJ, FBX, STL, PLY, DAE, 3MF y modelos de Blockbench (.bbmodel). Exporta video, secuencia PNG, modelo GLB o proyecto .peki.</p>
      <p style="margin:0">Hecho para que puedas animar los modelos de tus amigos sin instalar un motor 3D completo. Versión 1.0.</p>`,
    actions: [{ label: 'Cerrar', class: 'primary' }],
  });
}
