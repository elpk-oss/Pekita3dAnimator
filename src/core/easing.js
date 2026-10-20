export const EASING_PRESETS = {
  linear: { label: 'Lineal', points: [0, 0, 1, 1] },
  ease: { label: 'Suave', points: [0.25, 0.1, 0.25, 1] },
  easeIn: { label: 'Entrada', points: [0.42, 0, 1, 1] },
  easeOut: { label: 'Salida', points: [0, 0, 0.58, 1] },
  easeInOut: { label: 'Entrada/Salida', points: [0.42, 0, 0.58, 1] },
  punch: { label: 'Punch', points: [0.7, 0, 0.84, 0] },
  backOut: { label: 'Rebote', points: [0.18, 0.89, 0.32, 1.28] },
};

export const DEFAULT_EASING = [...EASING_PRESETS.easeInOut.points];

export function cubic(a, b, t) {
  const mt = 1 - t;
  return 3 * mt * mt * t * a + 3 * mt * t * t * b + t * t * t;
}

function cubicDerivative(a, b, t) {
  const mt = 1 - t;
  return 3 * mt * mt * a + 6 * mt * t * (b - a) + 3 * t * t * (1 - b);
}

/**
 * Evalúa una curva cubic-bezier(x1,y1,x2,y2) igual que CSS.
 * Resuelve x = progress y devuelve y.
 */
export function bezierEase(points, progress) {
  const p = Array.isArray(points) && points.length === 4 ? points : DEFAULT_EASING;
  const [x1, y1, x2, y2] = p;
  const t = Math.min(1, Math.max(0, progress));

  if (x1 === y1 && x2 === y2) return t;
  if (t === 0 || t === 1) return t;

  let s = t;
  for (let i = 0; i < 10; i += 1) {
    const x = cubic(x1, x2, s);
    const dx = x - t;
    if (Math.abs(dx) < 1e-6) break;
    const d = cubicDerivative(x1, x2, s);
    if (Math.abs(d) < 1e-6) break;
    s -= dx / d;
    s = Math.min(1.2, Math.max(-0.2, s));
  }

  if (s < 0 || s > 1) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i += 1) {
      s = (lo + hi) / 2;
      const x = cubic(x1, x2, s);
      if (x < t) lo = s;
      else hi = s;
    }
  }

  return cubic(y1, y2, Math.min(1, Math.max(0, s)));
}

export function presetForPoints(points) {
  for (const [key, preset] of Object.entries(EASING_PRESETS)) {
    if (preset.points.every((v, i) => Math.abs(v - (points?.[i] ?? 999)) < 0.005)) {
      return key;
    }
  }
  return 'custom';
}

export function easingLabel(points) {
  const key = presetForPoints(points);
  if (key === 'custom') {
    return `Bézier ${(points || []).map((v) => Number(v).toFixed(2)).join(' ')}`;
  }
  return EASING_PRESETS[key].label;
}
