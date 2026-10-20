import { icon } from '../icons.js';
import { h } from '../utils.js';

const TOOLS = [
  { tool: 'select', icon: 'cursor', label: 'Seleccionar' },
  { tool: 'translate', icon: 'move', label: 'Mover' },
  { tool: 'rotate', icon: 'rotate', label: 'Rotar' },
  { tool: 'scale', icon: 'scale', label: 'Escalar' },
];

/**
 * Barra inferior táctil de la versión móvil (estilo app de animación 3D).
 * Solo se crea cuando la app arranca en modo móvil; el CSS la oculta fuera de
 * `body.is-mobile` de todos modos.
 */
export class MobileBar {
  constructor(app, root) {
    this.app = app;
    this.root = root;

    this.toolButtons = [];
    this.track = h('div', { class: 'md-track' });

    this.menuButton = h('button', {
      class: 'md-btn',
      type: 'button',
      title: 'Menú',
      html: icon('menu', 21),
      onClick: () => this.app.openMobileMenu(),
    });
    this.track.appendChild(this.menuButton);
    this.track.appendChild(h('span', { class: 'md-sep' }));

    for (const item of TOOLS) {
      const button = h('button', {
        class: 'md-btn',
        type: 'button',
        dataset: { tool: item.tool },
        title: item.label,
        html: icon(item.icon, 21),
        onClick: () => this.app.setTool(item.tool),
      });
      this.track.appendChild(button);
      this.toolButtons.push({ button, tool: item.tool });
    }

    this.track.appendChild(h('span', { class: 'md-sep' }));
    this.track.appendChild(
      h('button', {
        class: 'md-btn',
        type: 'button',
        title: 'Importar modelo',
        html: icon('folderOpen', 21),
        onClick: () => this.app.triggerImport(),
      }),
    );
    this.track.appendChild(
      h('button', {
        class: 'md-btn',
        type: 'button',
        title: 'Añadir objeto',
        html: icon('plus', 21),
        onClick: () => this.app.openAddDialog(),
      }),
    );
    this.keyButton = h('button', {
      class: 'md-btn',
      type: 'button',
      title: 'Añadir clave',
      html: icon('key', 21),
      onClick: () => this.app.addKeyframe(),
    });
    this.track.appendChild(this.keyButton);
    this.track.appendChild(h('span', { class: 'md-sep' }));

    this.undoButton = h('button', {
      class: 'md-btn',
      type: 'button',
      title: 'Deshacer',
      html: icon('undo', 21),
      onClick: () => this.app.undo(),
    });
    this.redoButton = h('button', {
      class: 'md-btn',
      type: 'button',
      title: 'Rehacer',
      html: icon('redo', 21),
      onClick: () => this.app.redo(),
    });
    this.track.appendChild(this.undoButton);
    this.track.appendChild(this.redoButton);
    this.track.appendChild(
      h('button', {
        class: 'md-btn',
        type: 'button',
        title: 'Mostrar u ocultar la línea de tiempo',
        html: icon('chevronDown', 21),
        onClick: () => this.app.toggleMobileTimeline(),
      }),
    );

    this.panelButton = h('button', {
      class: 'md-btn',
      type: 'button',
      title: 'Propiedades',
      html: icon('sliders', 21),
      onClick: () => this.app.toggleMobileSheet(),
    });
    this.playButton = h('button', {
      class: 'md-btn md-primary',
      type: 'button',
      title: 'Reproducir / Pausar',
      html: icon('play', 22),
      onClick: () => this.app.togglePlay(),
    });
    this.exportButton = h('button', {
      class: 'md-btn',
      type: 'button',
      title: 'Exportar',
      html: icon('download', 21),
      onClick: () => this.app.openExportDialog(),
    });

    const right = h(
      'div',
      { class: 'md-side' },
      this.panelButton,
      this.playButton,
      this.exportButton,
    );

    this.element = h('div', { class: 'mobile-dock' }, this.track, right);
    this.root.appendChild(this.element);

    this.scrim = h('div', {
      class: 'mobile-scrim',
      onClick: () => this.closeSheet(),
    });
    this.root.appendChild(this.scrim);

    this.update();
  }

  closeSheet() {
    document.body.classList.remove('sheet-open');
    this.update();
  }

  update() {
    for (const item of this.toolButtons) {
      item.button.classList.toggle('active', this.app.tool === item.tool);
    }
    if (this.playButton) {
      this.playButton.innerHTML = icon(this.app.playing ? 'pause' : 'play', 22);
      this.playButton.classList.toggle('on', !!this.app.playing);
    }
    const sheetOpen = document.body.classList.contains('sheet-open');
    this.panelButton?.classList.toggle('active', sheetOpen);
    this.element.classList.toggle('sheet-open', sheetOpen);
    this.exportButton?.classList.toggle('busy', !!this.app.exporting);
    this.undoButton?.toggleAttribute('disabled', !this.app.history?.length || this.app.historyIndex <= 0);
    this.redoButton?.toggleAttribute('disabled', this.app.historyIndex >= (this.app.history?.length || 0) - 1);
  }
}
