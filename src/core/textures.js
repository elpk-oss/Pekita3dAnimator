/**
 * Texturas generadas por código.
 *
 * Sirven para dos cosas: los patrones rápidos ("Cuadros", "Madera"…), el
 * lienzo del editor de texturas (`src/ui/texture.js`) y los mapas de normales.
 */

import { clamp } from '../utils.js';

function rnd(seed) {
  let s = (seed || 1) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const TEXTURE_PATTERNS = [
  { id: 'checker', name: 'Cuadros' },
  { id: 'stripes', name: 'Rayas' },
  { id: 'grid', name: 'Rejilla' },
  { id: 'dots', name: 'Lunares' },
  { id: 'gradient', name: 'Degradado' },
  { id: 'bricks', name: 'Ladrillos' },
  { id: 'wood', name: 'Madera' },
  { id: 'metal', name: 'Metal' },
  { id: 'noise', name: 'Ruido' },
];

export function drawPattern(ctx, id, w, h, options = {}) {
  const a = options.colorA || '#f5c542';
  const b = options.colorB || '#1b2230';
  const random = rnd(options.seed || 3);

  switch (id) {
    case 'checker': {
      const cells = Number(options.cells) || 8;
      const cw = w / cells;
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = b;
      for (let y = 0; y < cells; y += 1) {
        for (let x = 0; x < cells; x += 1) {
          if ((x + y) % 2 === 0) ctx.fillRect(x * cw, y * cw, cw, cw);
        }
      }
      break;
    }
    case 'stripes': {
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = b;
      const bands = Number(options.cells) || 8;
      const bw = w / (bands * 2);
      for (let i = 0; i < bands * 2; i += 2) ctx.fillRect(i * bw, 0, bw, h);
      break;
    }
    case 'grid': {
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = b;
      ctx.lineWidth = Math.max(1, w / 64);
      const step = w / (Number(options.cells) || 8);
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
      break;
    }
    case 'dots': {
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = b;
      const cells = Number(options.cells) || 6;
      const step = w / cells;
      for (let y = 0; y < cells; y += 1) {
        for (let x = 0; x < cells; x += 1) {
          ctx.beginPath();
          ctx.arc((x + 0.5) * step, (y + 0.5) * step, step * 0.28, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'gradient': {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, a);
      g.addColorStop(1, b);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'bricks': {
      ctx.fillStyle = b;
      ctx.fillRect(0, 0, w, h);
      const rows = Number(options.cells) || 8;
      const bh = h / rows;
      const bw = w / 4;
      ctx.fillStyle = a;
      for (let r = 0; r < rows; r += 1) {
        const offset = r % 2 ? -bw / 2 : 0;
        for (let c = -1; c <= 4; c += 1) {
          ctx.fillRect(c * bw + offset + bw * 0.03, r * bh + bh * 0.05, bw * 0.94, bh * 0.9);
        }
      }
      break;
    }
    case 'wood': {
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i += 1) {
        const y = (i / 90) * h;
        ctx.strokeStyle = `rgba(0,0,0,${(0.04 + random() * 0.12).toFixed(3)})`;
        ctx.lineWidth = 1 + random() * 3;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += w / 12) {
          ctx.lineTo(x, y + Math.sin((x / w) * Math.PI * 3 + i) * (h / 90));
        }
        ctx.stroke();
      }
      const shade = ctx.createLinearGradient(0, 0, w, 0);
      shade.addColorStop(0, 'rgba(255,255,255,0.10)');
      shade.addColorStop(0.5, 'rgba(0,0,0,0.05)');
      shade.addColorStop(1, 'rgba(0,0,0,0.16)');
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'metal': {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, a);
      g.addColorStop(0.45, b);
      g.addColorStop(1, a);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i += 1) {
        const x = random() * w;
        ctx.strokeStyle = `rgba(255,255,255,${(random() * 0.14).toFixed(3)})`;
        ctx.lineWidth = random() * 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (random() - 0.5) * 6, h);
        ctx.stroke();
      }
      break;
    }
    case 'noise': {
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < w * h * 0.22; i += 1) {
        const x = random() * w;
        const y = random() * h;
        const s = 1 + random() * 3;
        ctx.fillStyle = `rgba(0,0,0,${(random() * 0.28).toFixed(3)})`;
        ctx.fillRect(x, y, s, s);
        if (random() > 0.6) {
          ctx.fillStyle = `rgba(255,255,255,${(random() * 0.2).toFixed(3)})`;
          ctx.fillRect(x, y, s, s);
        }
      }
      break;
    }
    default: {
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

export function patternDataUrl(id, size = 256, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  drawPattern(ctx, id, size, size, options);
  return canvas.toDataURL('image/png');
}

export function patternThumbnail(id, size = 44, options = {}) {
  return patternDataUrl(id, size, options);
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    image.src = src;
  });
}

/**
 * Convierte una imagen en un mapa de normales (relieve) usando su luminancia
 * como altura y un filtro de Sobel. Sirve para "esculpir" con texturas planas.
 */
export async function normalMapFromDataUrl(dataUrl, options = {}) {
  const image = await loadImageElement(dataUrl);
  const max = Math.max(64, Number(options.max) || 512);
  const naturalWidth = image.naturalWidth || image.width || 1;
  const naturalHeight = image.naturalHeight || image.height || 1;
  const scale = Math.min(1, max / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const sourceCtx = source.getContext('2d', { willReadFrequently: true });
  sourceCtx.drawImage(image, 0, 0, width, height);
  const pixels = sourceCtx.getImageData(0, 0, width, height).data;

  const strength = clamp(Number(options.strength) || 2.2, 0.2, 12);
  const heights = new Float32Array(width * height);
  for (let i = 0; i < heights.length; i += 1) {
    const o = i * 4;
    const alpha = pixels[o + 3] / 255;
    heights[i] = ((pixels[o] * 0.299 + pixels[o + 1] * 0.587 + pixels[o + 2] * 0.114) / 255) * alpha;
  }

  // Muestreo con borde envolvente: el mapa se puede repetir sin cortes.
  const at = (x, y) => heights[((y + height) % height) * width + ((x + width) % width)];

  const target = document.createElement('canvas');
  target.width = width;
  target.height = height;
  const targetCtx = target.getContext('2d');
  const output = targetCtx.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx =
        at(x + 1, y - 1) +
        2 * at(x + 1, y) +
        at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));

      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;

      const o = (y * width + x) * 4;
      output.data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      output.data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      output.data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      output.data[o + 3] = 255;
    }
  }

  targetCtx.putImageData(output, 0, 0);
  return target.toDataURL('image/png');
}

