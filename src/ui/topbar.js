import { icon, logoP } from '../icons.js';
import { escapeHtml, h } from '../utils.js';

export class Topbar {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.root.innerHTML = `
      <div class="brand">
        <div class="brand-mark">${logoP(30)}</div>
        <div class="brand-title"><b>PEKITA</b><span>ANIMATE 3D</span></div>
      </div>
      <div class="menubar" id="menubar"></div>
      <div class="top-actions">
        <span class="autosave" id="autosave-status" title="Guardado automático"><span class="dot"></span><span class="txt">Auto</span></span>
        <button class="icon-btn" id="btn-undo" title="Deshacer (Ctrl+Z)">${icon('undo', 15)}</button>
        <button class="icon-btn" id="btn-redo" title="Rehacer (Ctrl+Y)">${icon('redo', 15)}</button>
        <button class="autokey-pill" id="btn-autokey" title="Crear claves automáticamente al transformar"><span class="dot"></span><span>Auto Key</span></button>
        <button class="play-pill" id="btn-play" title="Reproducir / Pausar (Espacio)">${icon('play', 14)}</button>
        <button class="export-btn" id="btn-export" title="Exportar (Ctrl+E)">${icon('download', 14)} Exportar</button>
      </div>
    `;

    this.buildMenus();

    this.root.querySelector('#btn-undo')?.addEventListener('click', () => this.app.undo());
    this.root.querySelector('#btn-redo')?.addEventListener('click', () => this.app.redo());
    this.root.querySelector('#btn-autokey')?.addEventListener('click', () => this.app.setAutoKey(!this.app.autoKey));
    this.root.querySelector('#btn-play')?.addEventListener('click', () => this.app.togglePlay());
    this.root.querySelector('#btn-export')?.addEventListener('click', () => this.app.openExportDialog());

    document.addEventListener('pointerdown', (event) => {
      if (!event.target.closest('.menu')) this.closeMenus();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeMenus();
    });

    this.refresh();
  }

  menuData() {
    const app = this.app;
    return [
      {
        label: 'Archivo',
        items: [
          { label: 'Nuevo proyecto', icon: 'plus', shortcut: 'Ctrl+N', action: () => app.newProject() },
          { label: 'Importar modelo…', icon: 'upload', shortcut: 'Ctrl+I', action: () => app.triggerImport() },
          { label: 'Importar audio…', icon: 'audio', action: () => app.triggerAudioImport() },
          { label: 'Imagen de fondo…', icon: 'image', action: () => app.triggerBackgroundImport() },
          { sep: true },
          { label: 'Abrir proyecto…', icon: 'folderOpen', shortcut: 'Ctrl+O', action: () => app.triggerOpenProject() },
          { label: 'Guardar proyecto', icon: 'save', shortcut: 'Ctrl+S', action: () => app.saveProject() },
          { sep: true },
          { label: 'Exportar…', icon: 'download', shortcut: 'Ctrl+E', action: () => app.openExportDialog() },
        ],
      },
      {
        label: 'Editar',
        items: [
          { label: 'Deshacer', icon: 'undo', shortcut: 'Ctrl+Z', action: () => app.undo() },
          { label: 'Rehacer', icon: 'redo', shortcut: 'Ctrl+Y', action: () => app.redo() },
          { sep: true },
          { label: 'Duplicar objeto', icon: 'copy', shortcut: 'Ctrl+D', action: () => app.duplicateSelected() },
          { label: 'Eliminar objeto', icon: 'trash', shortcut: 'Supr', action: () => app.deleteSelected() },
          { sep: true },
          { label: 'Enfocar seleccionado', icon: 'focus', shortcut: 'F', action: () => app.focusSelected() },
        ],
      },
      {
        label: 'Objeto',
        items: [
          { label: 'Añadir objeto…', icon: 'plus', action: () => app.openAddDialog() },
          { sep: true },
          { label: 'Cubo', icon: 'cube', action: () => app.addPrimitive('box') },
          { label: 'Esfera', icon: 'sphere', action: () => app.addPrimitive('sphere') },
          { label: 'Plano', icon: 'plane', action: () => app.addPrimitive('plane') },
          { label: 'Cilindro', icon: 'cylinder', action: () => app.addPrimitive('cylinder') },
          { label: 'Cono', icon: 'cone', action: () => app.addPrimitive('cone') },
          { label: 'Toro', icon: 'torus', action: () => app.addPrimitive('torus') },
          { sep: true },
          { label: 'Luz direccional', icon: 'sun', action: () => app.addLight('directional') },
          { label: 'Luz puntual', icon: 'light', action: () => app.addLight('point') },
          { label: 'Foco', icon: 'light', action: () => app.addLight('spot') },
          { label: 'Luz ambiental', icon: 'sun', action: () => app.addLight('ambient') },
          { label: 'Cámara', icon: 'camera', action: () => app.addCamera() },
          { label: 'Vacío', icon: 'target', action: () => app.addPrimitive('empty') },
          { sep: true },
          { label: 'Crear control de rig', icon: 'target', action: () => app.createRigControl() },
          { label: 'Soltar del padre', icon: 'link', action: () => app.unparentSelected() },
        ],
      },
      {
        label: 'Animación',
        items: [
          { label: 'Reproducir / Pausar', icon: 'play', shortcut: 'Espacio', action: () => app.togglePlay() },
          { label: 'Detener', icon: 'stop', action: () => app.stop() },
          { sep: true },
          { label: 'Añadir keyframe', icon: 'key', shortcut: 'K', action: () => app.addKeyframe() },
          { label: 'Eliminar keyframe', icon: 'trash', action: () => app.deleteKeyframe() },
          { label: 'Auto Key', icon: 'key', action: () => app.setAutoKey(!app.autoKey) },
          { sep: true },
          { label: 'Duración del proyecto…', icon: 'clock', action: () => app.openDurationDialog() },
          { label: 'Ir al inicio', icon: 'skipBack', action: () => app.seek(0) },
          { label: 'Ir al final', icon: 'skipForward', action: () => app.seek(app.duration) },
        ],
      },
      {
        label: 'Cámara',
        items: [
          { label: 'Vista del editor', icon: 'camera', action: () => app.exitCameraView() },
          { label: 'Usar cámara seleccionada', icon: 'video', action: () => app.useSelectedCamera() },
          { label: 'Salir de vista de cámara', icon: 'close', action: () => app.exitCameraView() },
          { sep: true },
          { label: 'Enfocar todo', icon: 'focus', shortcut: 'Inicio', action: () => app.focusAll() },
          { label: 'Restablecer vista', icon: 'target', action: () => app.resetView() },
        ],
      },
      {
        label: 'Render',
        items: [
          { label: 'Exportar video…', icon: 'video', action: () => app.openExportDialog() },
          { label: 'Secuencia PNG…', icon: 'image', action: () => app.openExportDialog() },
          { label: 'Modelo GLB…', icon: 'cube', action: () => app.openExportDialog() },
          { label: 'Proyecto .peki', icon: 'save', action: () => app.saveProject() },
        ],
      },
      {
        label: 'Ayuda',
        items: [
          { label: 'Atajos de teclado', icon: 'key', action: () => app.openHelp() },
          { label: 'Acerca de PEKITA ANIMATE 3D', icon: 'info', action: () => app.openAbout() },
        ],
      },
    ];
  }

  buildMenus() {
    const menubar = this.root.querySelector('#menubar');
    if (!menubar) return;
    this.menus = [];
    for (const menu of this.menuData()) {
      const wrapper = h('div', { class: 'menu' });
      const trigger = h('button', { type: 'button' }, escapeHtml(menu.label));
      const drop = h('div', { class: 'menu-drop' });

      for (const item of menu.items) {
        if (item.sep) {
          drop.appendChild(h('div', { class: 'menu-sep' }));
          continue;
        }
        const row = h(
          'button',
          {
            class: 'menu-item',
            type: 'button',
            onClick: () => {
              this.closeMenus();
              item.action?.();
            },
          },
          item.icon ? h('span', { html: icon(item.icon, 14) }) : null,
          h('span', { text: item.label }),
          item.shortcut ? h('span', { class: 'shortcut', text: item.shortcut }) : null,
        );
        drop.appendChild(row);
      }

      trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        const isOpen = wrapper.classList.contains('open');
        this.closeMenus();
        if (!isOpen) wrapper.classList.add('open');
      });
      wrapper.addEventListener('pointerenter', () => {
        if (this.root.querySelector('.menu.open')) {
          this.closeMenus();
          wrapper.classList.add('open');
        }
      });

      wrapper.append(trigger, drop);
      menubar.appendChild(wrapper);
      this.menus.push(wrapper);
    }
  }

  closeMenus() {
    for (const menu of this.menus || []) menu.classList.remove('open');
  }

  setPlaying(playing) {
    const button = this.root.querySelector('#btn-play');
    if (!button) return;
    button.innerHTML = icon(playing ? 'pause' : 'play', 14);
    button.classList.toggle('on', playing);
    button.title = playing ? 'Pausar (Espacio)' : 'Reproducir (Espacio)';
  }

  updateAutoKey() {
    this.root.querySelector('#btn-autokey')?.classList.toggle('on', this.app.autoKey);
  }

  updateHistory() {
    const undo = this.root.querySelector('#btn-undo');
    const redo = this.root.querySelector('#btn-redo');
    if (undo) undo.disabled = this.app.historyIndex <= 0;
    if (redo) redo.disabled = this.app.historyIndex >= this.app.history.length - 1;
  }

  setAutosaveStatus(state = 'idle', label = 'Auto') {
    const node = this.root.querySelector('#autosave-status');
    if (!node) return;
    node.dataset.state = state;
    node.querySelector('.txt').textContent = label;
    node.title =
      state === 'saving'
        ? 'Guardando una copia automática…'
        : state === 'saved'
          ? 'Proyecto guardado automáticamente'
          : state === 'error'
            ? 'No se pudo guardar automáticamente'
            : 'Guardado automático activo';
  }

  refresh() {
    this.setPlaying(this.app.playing);
    this.updateAutoKey();
    this.updateHistory();
  }
}
