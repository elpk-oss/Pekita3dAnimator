import { bezierEase, DEFAULT_EASING } from './easing.js';
import { clamp, deepClone, snapTime } from '../utils.js';

export const CHANNELS = ['position', 'rotation', 'scale'];
export const CHANNEL_LABELS = {
  position: 'Posición',
  rotation: 'Rotación',
  scale: 'Escala',
};

export function createTracks() {
  return {
    position: { keys: [] },
    rotation: { keys: [] },
    scale: { keys: [] },
  };
}

export function cloneTracks(tracks) {
  return deepClone(tracks || createTracks());
}

export class AnimationSystem {
  constructor(app) {
    this.app = app;
  }

  createTracks() {
    return createTracks();
  }

  channelHasKeys(entry, channel) {
    return (entry?.tracks?.[channel]?.keys?.length || 0) > 0;
  }

  hasAnyKeys(entry) {
    return CHANNELS.some((channel) => this.channelHasKeys(entry, channel));
  }

  allTimes(entry) {
    const set = new Set();
    for (const channel of CHANNELS) {
      for (const key of entry?.tracks?.[channel]?.keys || []) {
        set.add(Number(key.time.toFixed(4)));
      }
    }
    return [...set].sort((a, b) => a - b);
  }

  keyAt(entry, channel, time, epsilon = 0.0006) {
    const keys = entry?.tracks?.[channel]?.keys || [];
    return keys.find((key) => Math.abs(key.time - time) <= epsilon) || null;
  }

  sample(entry, channel, time) {
    const keys = entry?.tracks?.[channel]?.keys;
    if (!keys || keys.length === 0) return null;
    if (time <= keys[0].time) return [...keys[0].value];
    const last = keys[keys.length - 1];
    if (time >= last.time) return [...last.value];

    for (let i = 0; i < keys.length - 1; i += 1) {
      const a = keys[i];
      const b = keys[i + 1];
      if (time >= a.time && time <= b.time) {
        const span = Math.max(1e-7, b.time - a.time);
        const linear = (time - a.time) / span;
        const eased = bezierEase(a.easing || DEFAULT_EASING, linear);
        return [
          a.value[0] + (b.value[0] - a.value[0]) * eased,
          a.value[1] + (b.value[1] - a.value[1]) * eased,
          a.value[2] + (b.value[2] - a.value[2]) * eased,
        ];
      }
    }
    return [...last.value];
  }

  currentValue(entry, channel) {
    const object = entry?.object;
    if (!object) return [0, 0, 0];
    return [object[channel].x, object[channel].y, object[channel].z];
  }

  valueAt(entry, channel, time) {
    return this.sample(entry, channel, time) || this.currentValue(entry, channel);
  }

  addKey(entry, channel, time, value, easing = null) {
    if (!entry?.tracks?.[channel] || !Array.isArray(value)) return null;
    const keys = entry.tracks[channel].keys;
    const existing = this.keyAt(entry, channel, time);
    if (existing) {
      existing.value = value.map((v) => Number(v) || 0);
      if (easing) existing.easing = [...easing];
      return existing;
    }

    const index = keys.findIndex((key) => key.time > time);
    const previous = index > 0 ? keys[index - 1] : keys[keys.length - 1];
    const key = {
      time,
      value: value.map((v) => Number(v) || 0),
      easing: easing ? [...easing] : previous?.easing ? [...previous.easing] : [...DEFAULT_EASING],
    };
    if (index === -1) keys.push(key);
    else keys.splice(index, 0, key);
    this.sortKeys(entry, channel);
    return key;
  }

  addObjectKey(entry, time, channels = CHANNELS, options = {}) {
    if (!entry?.object) return 0;
    let added = 0;
    for (const channel of channels) {
      const sampled = options.sample === false ? null : this.sample(entry, channel, time);
      const value = sampled || this.currentValue(entry, channel);
      if (this.addKey(entry, channel, time, value)) added += 1;
    }
    return added;
  }

  removeKeyAt(entry, time) {
    if (!entry) return 0;
    let removed = 0;
    for (const channel of CHANNELS) {
      const keys = entry.tracks?.[channel]?.keys;
      if (!keys) continue;
      const index = keys.findIndex((key) => Math.abs(key.time - time) < 0.0006);
      if (index >= 0) {
        keys.splice(index, 1);
        removed += 1;
      }
    }
    return removed;
  }

  moveKeyAt(entry, fromTime, toTime) {
    if (!entry) return 0;
    let moved = 0;
    for (const channel of CHANNELS) {
      const keys = entry.tracks?.[channel]?.keys;
      if (!keys) continue;
      const key = keys.find((k) => Math.abs(k.time - fromTime) < 0.0006);
      if (!key) continue;
      const target = keys.find((k) => k !== key && Math.abs(k.time - toTime) < 0.0006);
      if (target) keys.splice(keys.indexOf(target), 1);
      key.time = toTime;
      moved += 1;
    }
    for (const channel of CHANNELS) this.sortKeys(entry, channel);
    return moved;
  }

  applyShiftedTracks(entry, originalTracks, delta, duration) {
    const shifted = cloneTracks(originalTracks);
    for (const channel of CHANNELS) {
      for (const key of shifted[channel]?.keys || []) {
        key.time = clamp(key.time + delta, 0, duration);
      }
    }
    entry.tracks = shifted;
  }

  shiftAllKeys(entry, delta, duration) {
    for (const channel of CHANNELS) {
      for (const key of entry.tracks?.[channel]?.keys || []) {
        key.time = clamp(key.time + delta, 0, duration);
      }
      this.sortKeys(entry, channel);
    }
  }

  clampShiftDelta(entry, delta, duration) {
    let min = Infinity;
    let max = -Infinity;
    for (const channel of CHANNELS) {
      for (const key of entry.tracks?.[channel]?.keys || []) {
        min = Math.min(min, key.time);
        max = Math.max(max, key.time);
      }
    }
    if (!Number.isFinite(min)) return 0;
    return clamp(delta, -min, duration - max);
  }

  setEasingAt(entry, time, easing, channel = 'all') {
    const channels = channel === 'all' ? CHANNELS : [channel];
    let changed = 0;
    for (const ch of channels) {
      const key = this.keyAt(entry, ch, time);
      if (key) {
        key.easing = [...easing];
        changed += 1;
      }
    }
    return changed;
  }

  getEasingAt(entry, time, channel = 'position') {
    const key = this.keyAt(entry, channel, time);
    return key?.easing ? [...key.easing] : [...DEFAULT_EASING];
  }

  sortKeys(entry, channel) {
    const keys = entry?.tracks?.[channel]?.keys;
    if (keys) keys.sort((a, b) => a.time - b.time);
  }

  clipRange(entry) {
    let min = Infinity;
    let max = -Infinity;
    for (const channel of CHANNELS) {
      for (const key of entry?.tracks?.[channel]?.keys || []) {
        min = Math.min(min, key.time);
        max = Math.max(max, key.time);
      }
    }
    if (!Number.isFinite(min)) return null;
    return { start: min, end: max };
  }

  evaluateEntry(entry, time) {
    if (!entry?.object || !this.hasAnyKeys(entry)) return;
    for (const channel of CHANNELS) {
      const value = this.sample(entry, channel, time);
      if (!value) continue;
      entry.object[channel].set(value[0], value[1], value[2]);
    }
  }

  evaluate(time, options = {}) {
    for (const entry of this.app.entries) {
      if (entry.id === options.skipEntryId) continue;
      this.evaluateEntry(entry, time);
    }
    this.app.viewport?.updateSelectionGeometry?.();
  }

  snap(time) {
    return snapTime(time, this.app.fps);
  }
}
