import { icon } from '../icons.js';
import { clamp, debounce, escapeHtml, formatTimecode, snapTime } from '../utils.js';

export class Timeline {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.drag = null;
    this.zoom = app.timelinePPS;
    this.build();
    this.bind();
    this.render();
    this.updateAutoKey();
    this.updateTransport();
    this.setPlaying(false);
    this.setPlayhead(app.currentTime);

    this.resizeObserver = new ResizeObserver(debounce(() => this.render(), 100));
    this.resizeObserver.observe(this.body);
  }

  build() {
    this.root.innerHTML = `
      <div class="tl-head">
        <div class="tl-brand">${icon('film', 15)} Timeline</div>
        <div class="tl-time" id="tl-time">00:00:00:00</div>
        <div class="transport">
          <button class="tp-btn" data-act="start" title="Ir al inicio">${icon('skipBack', 13)}</button>
          <button class="tp-btn" data-act="prev" title="Fotograma anterior (←)">${icon('stepBack', 13)}</button>
          <button class="tp-btn play" data-act="play" title="Reproducir / Pausar (Espacio)">${icon('play', 13)}</button>
          <button class="tp-btn" data-act="next" title="Fotograma siguiente (→)">${icon('stepForward', 13)}</button>
          <button class="tp-btn" data-act="end" title="Ir al final">${icon('skipForward', 13)}</button>
          <button class="tp-btn" data-act="loop" id="tl-loop" title="Repetir">${icon('repeat', 13)}</button>
        </div>
        <div class="tl-spacer"></div>
        <div class="tl-field duration-field"><span>Dur</span><input id="tl-duration" type="number" min="0.5" max="600" step="0.5" title="Duración en segundos"></div>
        <div class="tl-field fps-field"><span>FPS</span>
          <select id="tl-fps" title="Fotogramas por segundo">
            <option value="24">24</option>
            <option value="30">30</option>
            <option value="60">60</option>
            <option value="12">12</option>
          </select>
        </div>
        <button class="tl-autokey" id="tl-autokey" title="Crear claves automáticamente al transformar"><span class="dot"></span>Auto Key</button>
        <div class="tl-zoom">
          <span style="display:grid;place-items:center">${icon('zoomOut', 12)}</span>
          <input type="range" id="tl-zoom-range" min="20" max="560" step="5" title="Zoom del timeline">
          <span style="display:grid;place-items:center">${icon('zoomIn', 12)}</span>
        </div>
        <div class="tl-divider"></div>
        <button class="icon-btn small" id="tl-addaudio" title="Importar audio">${icon('audio', 14)}</button>
      </div>
      <div class="tl-body" id="tl-body">
        <div class="tl-canvas" id="tl-canvas">
          <div class="tl-ruler-row">
            <div class="tl-corner">Pistas</div>
            <div class="tl-ruler" id="tl-ruler"></div>
          </div>
          <div class="tl-rows" id="tl-rows"></div>
          <div class="tl-duration-shade" id="tl-shade" style="top:27px"></div>
          <div class="tl-playhead" id="tl-playhead"></div>
        </div>
      </div>
    `;

    this.body = this.root.querySelector('#tl-body');
    this.canvas = this.root.querySelector('#tl-canvas');
    this.ruler = this.root.querySelector('#tl-ruler');
    this.rowsEl = this.root.querySelector('#tl-rows');
    this.shade = this.root.querySelector('#tl-shade');
    this.playhead = this.root.querySelector('#tl-playhead');
    this.timeLabel = this.root.querySelector('#tl-time');
    this.durationInput = this.root.querySelector('#tl-duration');
    this.fpsSelect = this.root.querySelector('#tl-fps');
    this.autoKeyButton = this.root.querySelector('#tl-autokey');
    this.loopButton = this.root.querySelector('#tl-loop');
    this.zoomRange = this.root.querySelector('#tl-zoom-range');
    this.playButton = this.root.querySelector('[data-act="play"]');
  }

  bind() {
    this.root.querySelector('.transport')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-act]');
      if (!button) return;
      const action = button.dataset.act;
      if (action === 'start') this.app.seek(0);
      else if (action === 'prev') this.app.stepFrame(-1);
      else if (action === 'play') this.app.togglePlay();
      else if (action === 'next') this.app.stepFrame(1);
      else if (action === 'end') this.app.seek(this.app.duration);
      else if (action === 'loop') this.app.setLoop(!this.app.loop);
    });

    this.durationInput?.addEventListener('change', () => this.app.setDuration(Number(this.durationInput.value)));
    this.fpsSelect?.addEventListener('change', () => this.app.setFPS(Number(this.fpsSelect.value)));
    this.autoKeyButton?.addEventListener('click', () => this.app.setAutoKey(!this.app.autoKey));
    this.zoomRange?.addEventListener('input', () => this.app.setTimelinePPS(Number(this.zoomRange.value)));
    this.root.querySelector('#tl-addaudio')?.addEventListener('click', () => this.app.triggerAudioImport());

    this.body.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    window.addEventListener('pointermove', (event) => this.onPointerMove(event));
    window.addEventListener('pointerup', () => this.onPointerUp());

    this.body.addEventListener('dblclick', (event) => {
      const lane = event.target.closest('.tl-lane[data-entry]');
      if (!lane) return;
      const rect = lane.getBoundingClientRect();
      const time = clamp((event.clientX - rect.left) / this.app.timelinePPS, 0, this.app.duration);
      this.app.addKeyframeAtTime(lane.dataset.entry, snapTime(time, this.app.fps));
    });

    this.body.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.12 : 0.89;
        this.app.setTimelinePPS(this.app.timelinePPS * factor);
      },
      { passive: false },
    );
  }

  get labelWidth() {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--label-w');
    return parseFloat(value) || 212;
  }

  render() {
    if (!this.body) return;
    const scrollLeft = this.body.scrollLeft;
    const scrollTop = this.body.scrollTop;
    const labelW = this.labelWidth;
    const pps = this.app.timelinePPS;
    const duration = this.app.duration;
    const contentW = Math.max(duration * pps + 60, this.body.clientWidth - labelW);
    this.contentWidth = contentW;

    this.canvas.style.width = `${labelW + contentW}px`;
    this.canvas.style.minHeight = `${Math.max(this.body.clientHeight, 34)}px`;
    this.ruler.style.width = `${contentW}px`;
    this.ruler.innerHTML = this.buildRuler(contentW, pps, duration);

    const rows = [];
    for (const entry of this.app.entries) {
      rows.push(this.buildRow(entry, contentW, pps));
    }
    rows.push(this.buildAudioRow(contentW, pps));
    if (!this.app.entries.length && !this.app.audio.hasAudio) {
      rows.push(`<div class="tl-empty">Añade o importa un objeto para empezar a animar.</div>`);
    }
    this.rowsEl.innerHTML = rows.join('');

    this.playhead.style.left = `${labelW + this.app.currentTime * pps}px`;
    const shadeLeft = labelW + duration * pps;
    this.shade.style.left = `${shadeLeft}px`;
    this.shade.style.width = `${Math.max(0, contentW - duration * pps)}px`;
    this.shade.style.top = '27px';

    this.timeLabel.textContent = formatTimecode(this.app.currentTime, this.app.fps);
    if (document.activeElement !== this.durationInput) this.durationInput.value = String(this.app.duration);
    if (document.activeElement !== this.fpsSelect) this.fpsSelect.value = String(this.app.fps);
    if (document.activeElement !== this.zoomRange) this.zoomRange.value = String(this.app.timelinePPS);
    this.zoom = this.app.timelinePPS;

    this.body.scrollLeft = scrollLeft;
    this.body.scrollTop = scrollTop;
    this.updateTransport();
    this.drawWaveforms();
  }

  buildRuler(contentW, pps, duration) {
    const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const major = steps.find((step) => step * pps >= 58) || 300;
    const minor = major / 4;
    let html = '';
    const addTick = (time, isMajor) => {
      const x = time * pps;
      if (x > contentW + 1) return;
      html += `<div class="ruler-tick ${isMajor ? 'major' : 'minor'}" style="left:${x}px"></div>`;
      if (isMajor) {
        html += `<div class="ruler-label" style="left:${x}px">${this.rulerLabel(time, major)}</div>`;
      }
    };
    for (let time = 0; time <= duration + 1e-6; time += minor) {
      const rounded = Math.round(time * 1000) / 1000;
      const isMajor = Math.abs(rounded / major - Math.round(rounded / major)) < 0.001;
      addTick(rounded, isMajor);
    }
    html += '<div class="ruler-tick major" style="left:0;opacity:.9"></div>';
    return html;
  }

  rulerLabel(time, major) {
    const rounded = Math.round(time * 1000) / 1000;
    if (major < 1) return `${rounded}s`;
    if (rounded < 60) return `${Math.round(rounded)}s`;
    const minutes = Math.floor(rounded / 60);
    const seconds = Math.floor(rounded % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  buildRow(entry, contentW, pps) {
    const times = this.app.animation.allTimes(entry);
    const range = this.app.compositeClipRange(entry);
    const subtree = this.app.subtreeEntries(entry);
    const composite = subtree.length > 1;
    const selected = entry.id === this.app.selectedId;
    let clip = '';
    let keys = '';
    if (range) {
      const left = range.start * pps;
      const width = Math.max(8, (range.end - range.start) * pps);
      clip = `<div class="tl-clip ${composite ? 'composite' : ''}" data-entry="${entry.id}" style="left:${left}px;width:${width}px;--clip-color:${entry.color}" title="${composite ? 'Clip compuesto del rig' : 'Clip de animación'}">${composite ? '<span class="tl-clip-badge">RIG</span>' : ''}</div>`;
    }
    for (const time of times) {
      const isSelected =
        this.app.selectedKey && this.app.selectedKey.id === entry.id && Math.abs(this.app.selectedKey.time - time) < 0.0006;
      keys += `<div class="tl-key ${isSelected ? 'selected' : ''}" data-entry="${entry.id}" data-time="${time}" style="left:${Math.max(4, time * pps)}px" title="${formatTimecode(time, this.app.fps)}"></div>`;
    }
    const eyeIcon = entry.visible ? 'eye' : 'eyeOff';
    return `
      <div class="tl-row ${selected ? 'selected' : ''}" style="--row-color:${entry.color}">
        <div class="tl-label" data-entry="${entry.id}" title="${escapeHtml(entry.name)}">
          <span class="tl-color"></span>
          <span class="tl-ico">${icon(this.app.getEntryIcon(entry), 12)}</span>
          <span class="tl-name">${escapeHtml(entry.name)}</span>
          <span class="tl-mini">
            <button class="mini-btn" data-act="key" data-entry="${entry.id}" title="Añadir keyframe">${icon('key', 11)}</button>
            <button class="mini-btn ${entry.visible ? '' : 'off'}" data-act="vis" data-entry="${entry.id}" title="Mostrar/ocultar">${icon(eyeIcon, 11)}</button>
          </span>
        </div>
        <div class="tl-lane" data-entry="${entry.id}" style="width:${contentW}px;background-size:${pps}px 100%">
          ${clip}${keys}
        </div>
      </div>`;
  }

  buildAudioRow(contentW, pps) {
    const audio = this.app.audio;
    if (!audio.hasAudio) {
      return `
        <div class="tl-row" style="--row-color:#5ad68c">
          <div class="tl-label">
            <span class="tl-color"></span>
            <span class="tl-ico">${icon('audio', 12)}</span>
            <span class="tl-name">Audio</span>
          </div>
          <div class="tl-lane" style="width:${contentW}px;background-size:${pps}px 100%">
            <button class="btn sm tl-add-audio" style="position:absolute;left:8px;top:5px;height:21px">${icon('plus', 10)} Importar audio</button>
          </div>
        </div>`;
    }
    const left = audio.start * pps;
    const width = Math.max(12, audio.duration * pps);
    return `
      <div class="tl-row" style="--row-color:#5ad68c">
        <div class="tl-label" title="${escapeHtml(audio.name)}">
          <span class="tl-color"></span>
          <span class="tl-ico">${icon('audio', 12)}</span>
          <span class="tl-name">${escapeHtml(audio.name)}</span>
          <span class="tl-mini">
            <button class="mini-btn" data-act="remove-audio" title="Quitar audio">${icon('trash', 11)}</button>
          </span>
        </div>
        <div class="tl-lane" data-audio="1" style="width:${contentW}px;background-size:${pps}px 100%">
          <div class="tl-audio-clip" data-audio-clip="1" style="left:${left}px;width:${width}px">
            <canvas class="tl-wave"></canvas>
            <span class="tl-audio-name">${escapeHtml(audio.name)}</span>
          </div>
        </div>
      </div>`;
  }

  drawWaveforms() {
    const audio = this.app.audio;
    if (!audio.hasAudio) return;
    const canvas = this.rowsEl.querySelector('.tl-wave');
    if (!canvas) return;
    requestAnimationFrame(() => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx || !audio.peaks.length) return;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(128, 238, 170, 0.72)';
      const peaks = audio.peaks;
      const mid = height / 2;
      for (let x = 0; x < width; x += 1) {
        const index = Math.min(peaks.length - 1, Math.floor((x / width) * peaks.length));
        const amp = Math.max(0.5, peaks[index] * (height - 2));
        ctx.fillRect(x, mid - amp / 2, 1, amp);
      }
      ctx.fillStyle = 'rgba(128, 238, 170, 0.22)';
      ctx.fillRect(0, Math.floor(mid), width, 1);
    });
  }

  timeFromEvent(event) {
    const target = event.target.closest('.tl-ruler, .tl-lane');
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    const time = (event.clientX - rect.left) / this.app.timelinePPS;
    return clamp(time, 0, this.app.duration);
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    const target = event.target;

    const mini = target.closest('[data-act]');
    if (mini) {
      const action = mini.dataset.act;
      if (action === 'key') this.app.addKeyframe(mini.dataset.entry);
      else if (action === 'vis') this.app.toggleVisible(mini.dataset.entry);
      else if (action === 'remove-audio') this.app.removeAudio();
      event.preventDefault();
      return;
    }

    if (target.closest('.tl-add-audio')) {
      this.app.triggerAudioImport();
      return;
    }

    const audioClip = target.closest('.tl-audio-clip');
    if (audioClip) {
      event.preventDefault();
      const startX = event.clientX;
      const originalStart = this.app.audio.start;
      this.drag = { mode: 'audio', startX, originalStart };
      audioClip.classList.add('dragging');
      return;
    }

    const key = target.closest('.tl-key');
    if (key) {
      event.preventDefault();
      const entryId = key.dataset.entry;
      const time = Number(key.dataset.time);
      this.app.selectKey(entryId, time);
      this.drag = { mode: 'key', entryId, originalTime: time, lastTime: time, startX: event.clientX };
      key.classList.add('dragging');
      return;
    }

    const clip = target.closest('.tl-clip');
    if (clip) {
      event.preventDefault();
      const entry = this.app.objects.get(clip.dataset.entry);
      if (!entry) return;
      this.app.select(entry.id);
      const subtree = this.app.subtreeEntries(entry);
      const composite = subtree.length > 1;
      const originalTracks = new Map();
      for (const item of composite ? subtree : [entry]) {
        originalTracks.set(item.id, JSON.parse(JSON.stringify(item.tracks)));
      }
      this.drag = {
        mode: 'clip',
        entryId: entry.id,
        startX: event.clientX,
        originalTracks,
        composite,
        lastDelta: 0,
      };
      clip.classList.add('dragging');
      return;
    }

    const lane = target.closest('.tl-lane');
    const ruler = target.closest('.tl-ruler');
    const label = target.closest('.tl-label');

    if (label) {
      if (label.dataset.entry) this.app.select(label.dataset.entry);
      return;
    }

    if (lane || ruler) {
      event.preventDefault();
      let entryId = lane?.dataset.entry || null;
      if (entryId) this.app.select(entryId);
      const time = this.timeFromEvent(event);
      if (time == null) return;
      const snapped = snapTime(time, this.app.fps);
      this.app.seek(snapped);
      this.drag = { mode: 'scrub' };
    }
  }

  onPointerMove(event) {
    if (!this.drag) return;
    const pps = this.app.timelinePPS;

    if (this.drag.mode === 'scrub') {
      const lane = this.rowsEl.querySelector('.tl-lane') || this.ruler;
      const rect = lane.getBoundingClientRect();
      const time = clamp((event.clientX - rect.left) / pps, 0, this.app.duration);
      this.app.seek(snapTime(time, this.app.fps));
      return;
    }

    if (this.drag.mode === 'key') {
      const delta = (event.clientX - this.drag.startX) / pps;
      const target = snapTime(clamp(this.drag.originalTime + delta, 0, this.app.duration), this.app.fps);
      if (Math.abs(target - this.drag.lastTime) > 0.0001) {
        this.app.moveKeyframe(this.drag.entryId, this.drag.lastTime, target);
        this.drag.lastTime = target;
      }
      return;
    }

    if (this.drag.mode === 'clip') {
      const delta = (event.clientX - this.drag.startX) / pps;
      this.drag.lastDelta = delta;
      if (this.drag.composite) this.app.shiftSubtreeKeys(this.drag.entryId, this.drag.originalTracks, delta, false);
      else {
        const original = this.drag.originalTracks.get(this.drag.entryId);
        this.app.shiftEntryKeys(this.drag.entryId, original, delta, false);
      }
      this.render();
      this.rowsEl.querySelector(`.tl-clip[data-entry="${this.drag.entryId}"]`)?.classList.add('dragging');
      return;
    }

    if (this.drag.mode === 'audio') {
      const delta = (event.clientX - this.drag.startX) / pps;
      const start = Math.max(0, snapTime(this.drag.originalStart + delta, this.app.fps));
      this.app.audio.setStart(start);
      const clip = this.rowsEl.querySelector('.tl-audio-clip');
      if (clip) clip.style.left = `${start * pps}px`;
    }
  }

  onPointerUp() {
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;
    this.rowsEl.querySelectorAll('.dragging').forEach((node) => node.classList.remove('dragging'));

    if (drag.mode === 'key' || drag.mode === 'clip' || drag.mode === 'audio') {
      if (drag.mode === 'clip') {
        if (drag.composite) this.app.shiftSubtreeKeys(drag.entryId, drag.originalTracks, drag.lastDelta, true);
        else this.app.shiftEntryKeys(drag.entryId, drag.originalTracks.get(drag.entryId), drag.lastDelta, true);
      } else if (drag.mode === 'audio') {
        this.app.commitChange();
      } else {
        this.app.commitChange();
      }
      this.render();
    }
  }

  setPlayhead(time) {
    if (!this.playhead) return;
    const pps = this.app.timelinePPS;
    this.playhead.style.left = `${this.labelWidth + time * pps}px`;
    if (this.timeLabel) this.timeLabel.textContent = formatTimecode(time, this.app.fps);
    const x = this.labelWidth + time * pps;
    const visibleLeft = this.body.scrollLeft;
    const visibleRight = visibleLeft + this.body.clientWidth;
    if (x > visibleRight - 30) this.body.scrollLeft = x - this.body.clientWidth + 90;
    else if (x < visibleLeft + 6) this.body.scrollLeft = Math.max(0, x - 90);
  }

  setTimeLabel(time) {
    if (this.timeLabel) this.timeLabel.textContent = formatTimecode(time, this.app.fps);
  }

  setPlaying(playing) {
    if (this.playButton) {
      this.playButton.innerHTML = icon(playing ? 'pause' : 'play', 13);
      this.playButton.classList.toggle('on', playing);
    }
  }

  updateAutoKey() {
    this.autoKeyButton?.classList.toggle('on', this.app.autoKey);
  }

  updateTransport() {
    this.loopButton?.classList.toggle('on', this.app.loop);
  }
}
