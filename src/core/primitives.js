import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Piezas básicas del modelado.
 *
 * Cada pieza guarda sus propios parámetros (`entry.primitive = { kind, params }`),
 * de forma que se puede volver a construir la geometría en cualquier momento:
 * cambiar el tamaño, redondear las aristas o subir los segmentos sin perder
 * el objeto, sus materiales ni su animación.
 */

const clampNum = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const int = (value, min, max, fallback) => Math.round(clampNum(value, min, max, fallback));

/** Perfil para LatheGeometry: cilindro con los bordes redondeados. */
function cylinderProfile(radius, height, round, steps = 5) {
  const half = height / 2;
  const rr = Math.min(round, radius * 0.95, half * 0.95);
  const points = [];
  points.push(new THREE.Vector2(0, -half));
  if (rr > 0.0005) {
    points.push(new THREE.Vector2(radius - rr, -half));
    for (let i = 1; i <= steps; i += 1) {
      const a = -Math.PI / 2 + (i / steps) * (Math.PI / 2);
      points.push(new THREE.Vector2(radius - rr + Math.cos(a) * rr, -half + rr + Math.sin(a) * rr));
    }
  } else {
    points.push(new THREE.Vector2(radius, -half));
  }
  if (rr > 0.0005) {
    for (let i = 1; i <= steps; i += 1) {
      const a = (i / steps) * (Math.PI / 2);
      points.push(new THREE.Vector2(radius - rr + Math.cos(a) * rr, half - rr + Math.sin(a) * rr));
    }
  } else {
    points.push(new THREE.Vector2(radius, half));
  }
  points.push(new THREE.Vector2(0, half));
  return points;
}

function roundedBox(size, radius, segments) {
  const r = Math.min(radius, size / 2 - 0.001);
  if (r > 0.002) return new RoundedBoxGeometry(size, size, size, Math.max(1, segments), r);
  return new THREE.BoxGeometry(size, size, size);
}

export const PRIMITIVES = {
  box: {
    name: 'Cubo',
    icon: 'cube',
    color: 0xf5c542,
    defaults: { size: 1.64, radius: 0, segments: 3 },
    fields: [
      { key: 'size', label: 'Tamaño', min: 0.05, max: 60, step: 0.05 },
      { key: 'radius', label: 'Redondeo', min: 0, max: 1, step: 0.01 },
      { key: 'segments', label: 'Suavidad', min: 1, max: 10, step: 1, int: true },
    ],
    normalize: (p) => ({
      size: clampNum(p.size, 0.05, 60, 1.64),
      radius: clampNum(p.radius, 0, 1, 0),
      segments: int(p.segments, 1, 10, 3),
    }),
    ground: (p) => p.size / 2,
    build: (p) => roundedBox(p.size, p.radius, p.segments),
  },
  sphere: {
    name: 'Esfera',
    icon: 'sphere',
    color: 0x5aa2ff,
    defaults: { radius: 0.68, segments: 40, rings: 26 },
    fields: [
      { key: 'radius', label: 'Radio', min: 0.05, max: 30, step: 0.02 },
      { key: 'segments', label: 'Segmentos', min: 6, max: 128, step: 2, int: true },
      { key: 'rings', label: 'Anillos', min: 4, max: 96, step: 2, int: true },
    ],
    normalize: (p) => ({
      radius: clampNum(p.radius, 0.05, 30, 0.68),
      segments: int(p.segments, 6, 128, 40),
      rings: int(p.rings, 4, 96, 26),
    }),
    ground: (p) => p.radius,
    build: (p) => new THREE.SphereGeometry(p.radius, p.segments, p.rings),
  },
  cylinder: {
    name: 'Cilindro',
    icon: 'cylinder',
    color: 0x5ad68c,
    defaults: { radius: 0.6, height: 1.4, radius2: 0, segments: 40 },
    fields: [
      { key: 'radius', label: 'Radio', min: 0.05, max: 30, step: 0.02 },
      { key: 'height', label: 'Alto', min: 0.05, max: 60, step: 0.05 },
      { key: 'radius2', label: 'Redondeo', min: 0, max: 0.99, step: 0.01 },
      { key: 'segments', label: 'Segmentos', min: 3, max: 128, step: 1, int: true },
    ],
    normalize: (p) => ({
      radius: clampNum(p.radius, 0.05, 30, 0.6),
      height: clampNum(p.height, 0.05, 60, 1.4),
      radius2: clampNum(p.radius2, 0, 0.99, 0),
      segments: int(p.segments, 3, 128, 40),
    }),
    ground: (p) => p.height / 2,
    build: (p) => {
      const round = p.radius2 * Math.min(p.radius, p.height / 2);
      if (round > 0.002) {
        return new THREE.LatheGeometry(cylinderProfile(p.radius, p.height, round), p.segments);
      }
      return new THREE.CylinderGeometry(p.radius, p.radius, p.height, p.segments);
    },
  },
  cone: {
    name: 'Cono',
    icon: 'cone',
    color: 0xff9f5a,
    defaults: { radius: 0.72, height: 1.5, segments: 40 },
    fields: [
      { key: 'radius', label: 'Radio', min: 0.05, max: 30, step: 0.02 },
      { key: 'height', label: 'Alto', min: 0.05, max: 60, step: 0.05 },
      { key: 'segments', label: 'Segmentos', min: 3, max: 128, step: 1, int: true },
    ],
    normalize: (p) => ({
      radius: clampNum(p.radius, 0.05, 30, 0.72),
      height: clampNum(p.height, 0.05, 60, 1.5),
      segments: int(p.segments, 3, 128, 40),
    }),
    ground: (p) => p.height / 2,
    build: (p) => new THREE.ConeGeometry(p.radius, p.height, p.segments),
  },
  torus: {
    name: 'Toro',
    icon: 'torus',
    color: 0xb18cff,
    defaults: { radius: 0.7, tube: 0.22, segments: 72, tubeSegments: 24 },
    fields: [
      { key: 'radius', label: 'Radio', min: 0.05, max: 30, step: 0.02 },
      { key: 'tube', label: 'Grosor', min: 0.01, max: 10, step: 0.01 },
      { key: 'segments', label: 'Segmentos', min: 8, max: 200, step: 2, int: true },
      { key: 'tubeSegments', label: 'Anillos', min: 4, max: 96, step: 2, int: true },
    ],
    normalize: (p) => ({
      radius: clampNum(p.radius, 0.05, 30, 0.7),
      tube: clampNum(p.tube, 0.01, 10, 0.22),
      segments: int(p.segments, 8, 200, 72),
      tubeSegments: int(p.tubeSegments, 4, 96, 24),
    }),
    ground: (p) => p.tube,
    build: (p) => new THREE.TorusGeometry(p.radius, p.tube, p.tubeSegments, p.segments),
  },
  plane: {
    name: 'Plano',
    icon: 'plane',
    color: 0x78889f,
    defaults: { width: 2.4, height: 2.4, segments: 1 },
    fields: [
      { key: 'width', label: 'Ancho', min: 0.05, max: 200, step: 0.05 },
      { key: 'height', label: 'Alto', min: 0.05, max: 200, step: 0.05 },
      { key: 'segments', label: 'Divisiones', min: 1, max: 64, step: 1, int: true },
    ],
    normalize: (p) => ({
      width: clampNum(p.width, 0.05, 200, 2.4),
      height: clampNum(p.height, 0.05, 200, 2.4),
      segments: int(p.segments, 1, 64, 1),
    }),
    ground: () => 0.012,
    rotation: [-Math.PI / 2, 0, 0],
    build: (p) => new THREE.PlaneGeometry(p.width, p.height, p.segments, p.segments),
  },
  empty: {
    name: 'Vacío',
    icon: 'target',
    color: 0x9aa7bb,
    defaults: {},
    fields: [],
    normalize: () => ({}),
    ground: () => 0,
    build: null,
  },
};

/** Acepta también los nombres antiguos que usaba la app. */
export const PRIMITIVE_ALIASES = { cubo: 'box', 'caja': 'box', esfera: 'sphere', cilindro: 'cylinder', cono: 'cone', toro: 'torus', plano: 'plane' };

export function primitiveDef(kind) {
  if (!kind) return null;
  const id = PRIMITIVES[kind] ? kind : PRIMITIVE_ALIASES[String(kind).toLowerCase()];
  return id ? PRIMITIVES[id] : null;
}

export function primitiveId(kind) {
  if (PRIMITIVES[kind]) return kind;
  return PRIMITIVE_ALIASES[String(kind || '').toLowerCase()] || 'box';
}

export function defaultParams(kind) {
  const def = primitiveDef(kind) || PRIMITIVES.box;
  return { ...def.defaults };
}

export function normalizeParams(kind, params = {}) {
  const def = primitiveDef(kind) || PRIMITIVES.box;
  return def.normalize({ ...def.defaults, ...params });
}

/** Construye la geometría de la pieza. Devuelve `null` para grupos vacíos. */
export function buildPrimitiveGeometry(kind, params = {}) {
  const def = primitiveDef(kind);
  if (!def?.build) return null;
  try {
    return def.build(normalizeParams(kind, params));
  } catch (error) {
    console.warn('[PEKITA] No se pudo generar la pieza', kind, error);
    return null;
  }
}

/** Lista de piezas para los menús (sin el grupo vacío). */
export const PRIMITIVE_LIST = Object.entries(PRIMITIVES)
  .filter(([, def]) => def.build)
  .map(([id, def]) => ({ id, ...def }));
