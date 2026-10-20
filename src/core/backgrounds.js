import { uid } from '../utils.js';

/**
 * Fondos listos para usar.
 *
 * Todos se generan con canvas (no hay que descargar nada) y se entregan como
 * PNG en memoria, así que funcionan igual en el editor, en la vista previa de
 * exportación y en los videos/PNG exportados.
 */

const THUMBS = new Map();

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function cloud(ctx, x, y, scale, alpha = 0.9) {
  const puffs = [
    [0, 0, 1],
    [0.72, -0.1, 0.78],
    [-0.7, 0.06, 0.72],
    [0.34, 0.18, 0.62],
    [-0.32, 0.2, 0.58],
    [0.05, -0.24, 0.6],
  ];
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const [dx, dy, r] of puffs) {
    const px = x + dx * scale;
    const py = y + dy * scale;
    const radius = r * scale;
    const g = ctx.createRadialGradient(px, py, radius * 0.1, px, py, radius);
    g.addColorStop(0, 'rgba(255,255,255,0.98)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.72)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawStars(ctx, w, h, count, seed = 7, maxAlpha = 0.95) {
  const rnd = rand(seed);
  for (let i = 0; i < count; i += 1) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = rnd() * 1.9 + 0.35;
    const a = 0.25 + rnd() * maxAlpha;
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSky(ctx, w, h) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1c5aa6');
  sky.addColorStop(0.42, '#5fa3dd');
  sky.addColorStop(0.74, '#a9d3f0');
  sky.addColorStop(1, '#dfeef8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const sun = ctx.createRadialGradient(w * 0.78, h * 0.16, 0, w * 0.78, h * 0.16, w * 0.34);
  sun.addColorStop(0, 'rgba(255,252,235,0.95)');
  sun.addColorStop(0.35, 'rgba(255,246,205,0.42)');
  sun.addColorStop(1, 'rgba(255,246,205,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);

  const unit = w / 24;
  cloud(ctx, w * 0.22, h * 0.3, unit * 1.5, 0.92);
  cloud(ctx, w * 0.62, h * 0.2, unit * 1.25, 0.8);
  cloud(ctx, w * 0.45, h * 0.52, unit * 1.1, 0.75);
  cloud(ctx, w * 0.86, h * 0.44, unit * 0.95, 0.7);
  cloud(ctx, w * 0.12, h * 0.62, unit * 0.8, 0.6);

  const haze = ctx.createLinearGradient(0, h * 0.78, 0, h);
  haze.addColorStop(0, 'rgba(255,255,255,0)');
  haze.addColorStop(1, 'rgba(255,255,255,0.65)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
}

function drawSunset(ctx, w, h) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#20265a');
  sky.addColorStop(0.35, '#7c3f70');
  sky.addColorStop(0.62, '#d9663f');
  sky.addColorStop(0.82, '#f2ad5c');
  sky.addColorStop(1, '#fbd9a0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const sun = ctx.createRadialGradient(w * 0.5, h * 0.72, 0, w * 0.5, h * 0.72, w * 0.3);
  sun.addColorStop(0, 'rgba(255,246,214,0.98)');
  sun.addColorStop(0.22, 'rgba(255,213,132,0.75)');
  sun.addColorStop(1, 'rgba(255,180,110,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);

  const unit = w / 22;
  cloud(ctx, w * 0.24, h * 0.34, unit * 1.5, 0.55);
  cloud(ctx, w * 0.72, h * 0.26, unit * 1.2, 0.45);
  cloud(ctx, w * 0.5, h * 0.46, unit * 1.05, 0.5);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(60,30,60,0.42)';
  ctx.beginPath();
  ctx.ellipse(w * 0.24, h * 0.35, unit * 1.4, unit * 0.16, 0, 0, Math.PI * 2);
  ctx.ellipse(w * 0.72, h * 0.27, unit * 1.1, unit * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawNight(ctx, w, h) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#040713');
  sky.addColorStop(0.55, '#0b1734');
  sky.addColorStop(1, '#1d2c52');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  drawStars(ctx, w, h, 220, 21);

  const moon = ctx.createRadialGradient(w * 0.74, h * 0.22, 0, w * 0.74, h * 0.22, w * 0.16);
  moon.addColorStop(0, 'rgba(255,255,245,0.95)');
  moon.addColorStop(0.3, 'rgba(220,232,255,0.4)');
  moon.addColorStop(1, 'rgba(180,200,255,0)');
  ctx.fillStyle = moon;
  ctx.fillRect(0, 0, w, h);

  const unit = w / 26;
  cloud(ctx, w * 0.3, h * 0.7, unit * 1.4, 0.16);
  cloud(ctx, w * 0.68, h * 0.62, unit * 1.1, 0.12);
}

function drawSpace(ctx, w, h) {
  ctx.fillStyle = '#03040a';
  ctx.fillRect(0, 0, w, h);
  const nebula = ctx.createRadialGradient(w * 0.3, h * 0.38, 0, w * 0.3, h * 0.38, w * 0.5);
  nebula.addColorStop(0, 'rgba(96,84,220,0.5)');
  nebula.addColorStop(0.5, 'rgba(58,92,200,0.22)');
  nebula.addColorStop(1, 'rgba(10,12,30,0)');
  ctx.fillStyle = nebula;
  ctx.fillRect(0, 0, w, h);
  const nebula2 = ctx.createRadialGradient(w * 0.78, h * 0.66, 0, w * 0.78, h * 0.66, w * 0.42);
  nebula2.addColorStop(0, 'rgba(200,86,170,0.32)');
  nebula2.addColorStop(1, 'rgba(10,12,30,0)');
  ctx.fillStyle = nebula2;
  ctx.fillRect(0, 0, w, h);
  drawStars(ctx, w, h, 320, 5);
}

function drawStudio(ctx, w, h) {
  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, '#3c4250');
  base.addColorStop(0.55, '#6b7488');
  base.addColorStop(1, '#242a36');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  const light = ctx.createRadialGradient(w * 0.5, h * 0.36, 0, w * 0.5, h * 0.36, w * 0.62);
  light.addColorStop(0, 'rgba(255,255,255,0.5)');
  light.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  light.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, w, h);

  const floor = ctx.createLinearGradient(0, h * 0.55, 0, h);
  floor.addColorStop(0, 'rgba(255,255,255,0.08)');
  floor.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = floor;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);
}

function drawGrid(ctx, w, h) {
  ctx.fillStyle = '#0c1119';
  ctx.fillRect(0, 0, w, h);
  const step = w / 16;
  ctx.lineWidth = Math.max(1, w / 1600);
  ctx.strokeStyle = 'rgba(90,162,255,0.22)';
  ctx.beginPath();
  for (let x = 0; x <= w; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = 0; y <= h; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(120,190,255,0.5)';
  ctx.lineWidth = Math.max(1.5, w / 900);
  ctx.beginPath();
  for (let x = 0; x <= w; x += step * 4) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = 0; y <= h; y += step * 4) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  const glow = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.6);
  glow.addColorStop(0, 'rgba(90,162,255,0.14)');
  glow.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}

function drawBricks(ctx, w, h) {
  ctx.fillStyle = '#2b2f38';
  ctx.fillRect(0, 0, w, h);
  const rows = 10;
  const bh = h / rows;
  const bw = w / 6;
  ctx.fillStyle = '#7f8895';
  for (let r = 0; r < rows; r += 1) {
    const offset = r % 2 ? -bw / 2 : 0;
    for (let c = -1; c <= 6; c += 1) {
      ctx.fillRect(c * bw + offset + bw * 0.04, r * bh + bh * 0.06, bw * 0.92, bh * 0.88);
    }
  }
  const shade = ctx.createLinearGradient(0, 0, 0, h);
  shade.addColorStop(0, 'rgba(255,255,255,0.12)');
  shade.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
}

const DRAWERS = {
  sky: drawSky,
  sunset: drawSunset,
  night: drawNight,
  space: drawSpace,
  studio: drawStudio,
  grid: drawGrid,
  bricks: drawBricks,
};

export const BACKGROUND_PRESETS = [
  { id: 'chroma-green', name: 'Verde croma', solid: '#00b140' },
  { id: 'chroma-blue', name: 'Azul croma', solid: '#0047bb' },
  { id: 'sky', name: 'Cielo con nubes' },
  { id: 'sunset', name: 'Atardecer' },
  { id: 'night', name: 'Noche estrellada' },
  { id: 'studio', name: 'Estudio gris' },
  { id: 'grid', name: 'Cuadrícula técnica' },
  { id: 'space', name: 'Espacio' },
  { id: 'bricks', name: 'Muro de ladrillos' },
  { id: 'white', name: 'Blanco', solid: '#ffffff' },
  { id: 'black', name: 'Negro', solid: '#05070c' },
];

export function backgroundPreset(id) {
  return BACKGROUND_PRESETS.find((preset) => preset.id === id) || null;
}

function paint(ctx, preset, w, h) {
  if (preset.solid) {
    ctx.fillStyle = preset.solid;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const drawer = DRAWERS[preset.id];
  if (drawer) drawer(ctx, w, h);
  else {
    ctx.fillStyle = '#0b0f16';
    ctx.fillRect(0, 0, w, h);
  }
}

/** Miniatura en data URL para la galería del inspector. */
export function presetThumbnail(id, w = 160, h = 90) {
  const preset = backgroundPreset(id);
  if (!preset) return '';
  const key = `${id}:${w}x${h}`;
  if (THUMBS.has(key)) return THUMBS.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  paint(ctx, preset, w, h);
  const url = canvas.toDataURL('image/png');
  THUMBS.set(key, url);
  return url;
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

/**
 * Genera la imagen del fondo a tamaño completo.
 * Devuelve `{ id, name, fileName, mime, buffer, url }`, listo para
 * `app.loadBackgroundArrayBuffer`.
 */
export async function presetImageBuffer(id, w = 1600, h = 900) {
  const preset = backgroundPreset(id);
  if (!preset) throw new Error('Fondo no encontrado.');
  const solidSize = preset.solid ? 32 : 0;
  const canvas = document.createElement('canvas');
  canvas.width = solidSize || w;
  canvas.height = solidSize || h;
  const ctx = canvas.getContext('2d');
  paint(ctx, preset, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas);
  const buffer = await blob.arrayBuffer();
  return {
    id: uid('bg'),
    presetId: preset.id,
    name: preset.name,
    fileName: `${preset.id}.png`,
    mime: 'image/png',
    buffer,
  };
}
