import { icon } from '../icons.js';
import { h } from '../utils.js';

export class Toolrail {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.root.innerHTML = '';

    const tools = [
      { tool: 'select', icon: 'cursor', tip: 'Seleccionar (Q)' },
      { tool: 'translate', icon: 'move', tip: 'Mover (W)' },
      { tool: 'rotate', icon: 'rotate', tip: 'Rotar (E)' },
      { tool: 'scale', icon: 'scale', tip: 'Escalar (R)' },
    ];
    this.toolButtons = [];
    for (const item of tools) {
      const button = h('button', {
        class: 'tool',
        type: 'button',
        dataset: { tool: item.tool },
        title: item.tip,
        html: icon(item.icon, 17),
        onClick: () => this.app.setTool(item.tool),
      });
      this.root.appendChild(button);
      this.toolButtons.push({ button, tool: item.tool });
    }

    this.root.appendChild(h('div', { class: 'tool-sep' }));

    this.root.appendChild(
      h('button', {
        class: 'tool',
        type: 'button',
        dataset: { tip: 'Añadir objeto' },
        title: 'Añadir objeto',
        html: icon('plus', 18),
        onClick: () => this.app.openAddDialog(),
      }),
    );
    this.root.appendChild(
      h('button', {
        class: 'tool',
        type: 'button',
        dataset: { tip: 'Enfocar (F)' },
        title: 'Enfocar (F)',
        html: icon('focus', 17),
        onClick: () => this.app.focusSelected(),
      }),
    );
    this.root.appendChild(
      h('button', {
        class: 'tool',
        type: 'button',
        dataset: { tip: 'Duplicar (Ctrl+D)' },
        title: 'Duplicar (Ctrl+D)',
        html: icon('copy', 16),
        onClick: () => this.app.duplicateSelected(),
      }),
    );
    this.root.appendChild(
      h('button', {
        class: 'tool',
        type: 'button',
        dataset: { tip: 'Eliminar (Supr)' },
        title: 'Eliminar (Supr)',
        html: icon('trash', 16),
        onClick: () => this.app.deleteSelected(),
      }),
    );

    this.root.appendChild(h('div', { class: 'tool-sep' }));

    this.root.appendChild(
      h('button', {
        class: 'tool',
        type: 'button',
        dataset: { tip: 'Deshacer (Ctrl+Z)' },
        title: 'Deshacer (Ctrl+Z)',
        html: icon('undo', 16),
        onClick: () => this.app.undo(),
      }),
    );
    this.root.appendChild(
      h('button', {
        class: 'tool',
        type: 'button',
        dataset: { tip: 'Rehacer (Ctrl+Y)' },
        title: 'Rehacer (Ctrl+Y)',
        html: icon('redo', 16),
        onClick: () => this.app.redo(),
      }),
    );

    this.update();
  }

  update() {
    for (const item of this.toolButtons) {
      item.button.classList.toggle('active', this.app.tool === item.tool);
    }
  }
}
