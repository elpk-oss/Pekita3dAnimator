import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import JSZip from 'jszip';
import { baseName, fileExt, formatSeconds } from '../utils.js';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tga', 'ktx2']);
const AUX_EXTENSIONS = new Set(['mtl', 'bin']);

/**
 * Importa uno o varios archivos. Devuelve la lista de entradas raíz creadas.
 */
export async function importFiles(app, fileList) {
  const allFiles = [...fileList];
  const resources = new Map();
  for (const file of allFiles) {
    const key = resourceKey(file.name);
    if (key && !resources.has(key)) resources.set(key, file);
  }
  const files = allFiles.filter((file) => {
    const ext = fileExt(file.name);
    return !IMAGE_EXTENSIONS.has(ext) && !AUX_EXTENSIONS.has(ext);
  });
  if (!files.length) throw new Error('No se encontró ningún modelo en los archivos seleccionados.');

  const results = [];
  const errors = [];
  for (const file of files) {
    try {
      const result = await importFile(app, file, resources);
      if (result) results.push(result);
    } catch (error) {
      console.error('[PEKITA] Error importando', file.name, error);
      errors.push(`${file.name}: ${error.message || error}`);
    }
  }
  return { results, errors };
}

function resourceKey(url = '') {
  let clean = String(url);
  try {
    clean = decodeURIComponent(clean);
  } catch {
    /* conserva el texto original */
  }
  return clean.replace(/\\/g, '/').split('/').pop().toLowerCase();
}

/**
 * Los navegadores no pueden leer rutas relativas del disco. Cuando el usuario
 * selecciona un GLTF + BIN + texturas, se crean object URLs para que los
 * loaders resuelvan las referencias entre esos archivos.
 */
function createResourceManager(resources) {
  const manager = new THREE.LoadingManager();
  const objectUrls = [];
  manager.setURLModifier((url) => {
    if (!url || /^(data:|blob:|https?:|file:)/i.test(url)) return url;
    const file = resources?.get(resourceKey(url));
    if (!file) return url;
    const objectUrl = URL.createObjectURL(file);
    objectUrls.push(objectUrl);
    return objectUrl;
  });
  return {
    manager,
    dispose() {
      if (!objectUrls.length) return;
      setTimeout(() => {
        for (const url of objectUrls) URL.revokeObjectURL(url);
        objectUrls.length = 0;
      }, 5000);
    },
  };
}

function findResource(resources, name) {
  if (!resources) return null;
  const direct = resources.get(resourceKey(name));
  if (direct) return direct;
  return null;
}

export async function importFile(app, file, resources = null) {
  const ext = fileExt(file.name);
  const displayName = baseName(file.name);
  let object = null;
  let warnings = [];

  switch (ext) {
    case 'glb': {
      const buffer = await file.arrayBuffer();
      const gltf = await parseGLTF(buffer, resources);
      object = gltf.scene;
      if (gltf.animations?.length) warnings.push('El modelo incluye animaciones; se importó en pose estática.');
      break;
    }
    case 'gltf': {
      const text = await file.text();
      const gltf = await parseGLTF(text, resources);
      object = gltf.scene;
      if (gltf.animations?.length) warnings.push('El modelo incluye animaciones; se importó en pose estática.');
      break;
    }
    case 'obj': {
      const text = await file.text();
      const { manager, dispose } = createResourceManager(resources);
      try {
        const mtlReference = /^mtllib\s+(.+)$/im.exec(text)?.[1]?.trim().split(/\s+/)[0] || '';
        const mtlFile = findResource(resources, mtlReference);
        if (mtlFile) {
          const materials = new MTLLoader(manager).parse(await mtlFile.text(), '');
          materials.preload();
          object = new OBJLoader(manager).setMaterials(materials).parse(text);
        } else {
          object = new OBJLoader(manager).parse(text);
        }
      } finally {
        dispose();
      }
      break;
    }
    case 'fbx': {
      const buffer = await file.arrayBuffer();
      const { manager, dispose } = createResourceManager(resources);
      try {
        object = new FBXLoader(manager).parse(buffer, '');
      } finally {
        dispose();
      }
      break;
    }
    case 'stl': {
      const buffer = await file.arrayBuffer();
      const geometry = new STLLoader().parse(buffer);
      object = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0xa8b6cc, roughness: 0.48, metalness: 0.22 }),
      );
      break;
    }
    case 'ply': {
      const buffer = await file.arrayBuffer();
      const geometry = new PLYLoader().parse(buffer);
      const hasColors = !!geometry.attributes.color;
      object = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: hasColors ? 0xffffff : 0xa8b6cc,
          vertexColors: hasColors,
          roughness: 0.5,
          metalness: 0.15,
        }),
      );
      break;
    }
    case 'dae': {
      const text = await file.text();
      const { manager, dispose } = createResourceManager(resources);
      try {
        const collada = await new Promise((resolve, reject) => {
          new ColladaLoader(manager).parse(text, '', resolve, reject);
        });
        object = collada.scene;
      } finally {
        dispose();
      }
      break;
    }
    case '3mf': {
      const buffer = await file.arrayBuffer();
      object = await new Promise((resolve, reject) => {
        new ThreeMFLoader().parse(buffer, resolve, reject);
      });
      break;
    }
    case 'bbmodel': {
      const json = JSON.parse(await file.text());
      const parsed = parseBBModel(json, resources);
      object = parsed.group;
      warnings = warnings.concat(parsed.warnings);
      break;
    }
    case 'json': {
      const text = await file.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('El JSON no es válido.');
      }
      if (json.elements || json.outliner) {
        const parsed = parseBBModel(json, resources);
        object = parsed.group;
        warnings = warnings.concat(parsed.warnings);
      } else if (json.asset && json.asset.version) {
        const gltf = await parseGLTF(text, resources);
        object = gltf.scene;
      } else {
        throw new Error('JSON no reconocido. Usa .bbmodel, .gltf o .glb.');
      }
      break;
    }
    case 'prisma':
    case 'prism':
    case 'proj':
    case 'projy': {
      const parsed = await importContainerModel(app, file, resources, ext);
      if (parsed.imported) return parsed.imported;
      object = parsed.object;
      warnings = warnings.concat(parsed.warnings || []);
      break;
    }
    default:
      throw new Error(
        `Formato .${ext || '?'} no soportado. Usa GLB, GLTF, OBJ, FBX, STL, PLY, DAE, 3MF, BBModel, Prisma (.prism/.prisma) o PROJ.`,
      );
  }

  if (!object) throw new Error('No se pudo crear el objeto 3D.');

  prepareObject(object, displayName);
  groundAndCenter(object);
  const entry = app.registerImportedRoot(object, displayName, warnings);
  return { entry, object, warnings, name: displayName };
}

const CONTAINER_LABELS = { prism: 'Prisma 3D', prisma: 'Prisma 3D', proj: 'PROJ', projy: 'PROJ' };

function containerLabel(ext) {
  return CONTAINER_LABELS[ext] || 'El archivo';
}

/**
 * Importa proyectos propietarios o contenedores de otras apps (Prisma 3D,
 * Prisma/Beepbox, PROJ, PROJY…). Prueba, en este orden:
 *   1. ZIP (busca GLB/glTF/OBJ/FBX/BBModel/JSON dentro)
 *   2. JSON (BBModel, glTF o escena genérica)
 *   3. GLB binario completo
 *   4. GLB incrustado dentro de un binario
 *   5. Malla OBJ incrustada como texto dentro de un binario
 */
async function importContainerModel(app, file, resources = null, ext = '') {
  const buffer = await file.arrayBuffer();
  const label = containerLabel(ext);
  const diagnostics = [];

  if (isZipBuffer(buffer)) {
    const zipped = await importZipContainer(app, buffer, resources, diagnostics);
    if (zipped) return zipped;
  }

  const text = decodeBytes(buffer);
  if (looksLikeJsonText(text)) {
    const parsed = await importJsonContainer(app, text, resources);
    if (parsed) return parsed;
  }

  if (isGLBBuffer(buffer)) {
    const gltf = await parseGLTF(buffer, resources);
    return {
      object: gltf.scene,
      warnings: gltf.animations?.length ? ['El modelo incluye animaciones; se importó en pose estática.'] : [],
    };
  }

  const embedded = extractEmbeddedGLB(buffer);
  if (embedded) {
    const gltf = await parseGLTF(embedded, resources);
    return {
      object: gltf.scene,
      warnings: ['Se extrajo un modelo GLB incrustado dentro del archivo.'],
    };
  }

  const objText = extractEmbeddedOBJ(buffer);
  if (objText) {
    const { manager, dispose } = createResourceManager(resources);
    try {
      const parsed = new OBJLoader(manager).parse(objText);
      if (countMeshes(parsed)) {
        return {
          object: parsed,
          warnings: ['Se extrajo una malla OBJ incrustada dentro del archivo.'],
        };
      }
    } catch {
      /* prueba con el siguiente método */
    } finally {
      dispose();
    }
  }

  const head = hexPreview(buffer, 24);
  console.warn(`[PEKITA] ${label}: contenedor no reconocido`, { file: file.name, bytes: buffer.byteLength, head, diagnostics });
  throw new Error(
    `${label} no reconocido (${file.name}). Puede usar un formato propietario. ` +
      'Exporta el modelo desde la app original como OBJ o GLB e impórtalo aquí. Si compartes el archivo, se puede añadir soporte específico.',
  );
}

async function importZipContainer(app, buffer, resources, diagnostics) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return null;
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (!entries.length) return null;
  diagnostics.push(`zip(${entries.length})`);

  const projectEntry = entries.find((entry) => /(^|\/)project\.json$/i.test(entry.name));
  if (projectEntry) {
    try {
      const project = JSON.parse((await projectEntry.async('text')).replace(/^\uFEFF/, ''));
      if (project.format === 'pekita-animate-3d') {
        throw new Error('Este archivo contiene un proyecto PEKITA. Ábrelo con Archivo → Abrir proyecto (.peki).');
      }
    } catch (error) {
      if (String(error.message).includes('proyecto PEKITA')) throw error;
    }
  }

  const zipResources = new Map(resources || []);
  for (const entry of entries) {
    const name = entry.name.split('/').pop();
    if (!name) continue;
    const key = resourceKey(name);
    if (!key || zipResources.has(key)) continue;
    const data = await entry.async('uint8array');
    zipResources.set(key, new File([data], name, { type: mimeForName(name) }));
  }

  const modelEntry =
    entries.find((entry) => /\.glb$/i.test(entry.name)) ||
    entries.find((entry) => /\.gltf$/i.test(entry.name)) ||
    entries.find((entry) => /\.bbmodel$/i.test(entry.name)) ||
    entries.find((entry) => /\.(obj|fbx|stl|ply|dae|3mf)$/i.test(entry.name)) ||
    entries.find((entry) => /\.(prism|prisma|proj|projy)$/i.test(entry.name));

  if (modelEntry) {
    const name = modelEntry.name.split('/').pop();
    const data = await modelEntry.async('uint8array');
    const modelFile = new File([data], name, { type: mimeForName(name) });
    try {
      const imported = await importFile(app, modelFile, zipResources);
      return { imported };
    } catch (error) {
      diagnostics.push(`nested:${error.message}`);
    }
  }

  for (const entry of entries.filter((item) => /\.json$/i.test(item.name))) {
    try {
      const raw = (await entry.async('text')).replace(/^\uFEFF/, '');
      const parsed = await importJsonContainer(app, raw, zipResources);
      if (parsed) return parsed;
    } catch {
      /* prueba con el siguiente JSON */
    }
  }

  return null;
}

async function importJsonContainer(app, text, resources) {
  let json;
  try {
    json = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  if (json?.format === 'pekita-animate-3d') {
    throw new Error('Este archivo contiene un proyecto PEKITA. Ábrelo con Archivo → Abrir proyecto (.peki).');
  }
  if (json?.elements || json?.outliner) {
    const parsed = parseBBModel(json, resources);
    return { object: parsed.group, warnings: parsed.warnings };
  }
  if (json?.asset?.version) {
    const gltf = await parseGLTF(text, resources);
    return {
      object: gltf.scene,
      warnings: gltf.animations?.length ? ['El modelo incluye animaciones; se importó en pose estática.'] : [],
    };
  }
  return parseGenericSceneJson(json);
}

/**
 * Interpreta JSON de escenas genéricas (algunos exports de apps móviles) que
 * guardan vértices/caras en arrays. No es un formato oficial: es una red de
 * seguridad para no perder modelos sencillos.
 */
function parseGenericSceneJson(json) {
  if (!json || typeof json !== 'object') return null;
  const nodes = [];
  const seen = new Set();
  const visit = (node, depth = 0) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (node.vertices || node.positions || node.verts || node.mesh || node.faces || node.indices) nodes.push(node);
    for (const key of ['scene', 'scenes', 'objects', 'nodes', 'children', 'meshes', 'models', 'parts']) {
      if (node[key]) visit(node[key], depth + 1);
    }
  };
  visit(json.scene ?? json.scenes ?? json.objects ?? json.models ?? json.nodes ?? json, 0);
  if (!nodes.length) return null;

  const group = new THREE.Group();
  group.name = json.name || 'Modelo Prisma';
  let built = 0;
  for (const node of nodes) {
    const geometry = geometryFromJsonNode(node);
    if (!geometry) continue;
    const material = new THREE.MeshStandardMaterial({
      color: colorFromJsonNode(node),
      roughness: 0.55,
      metalness: 0.14,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = node.name || `Parte ${built + 1}`;
    const translation = node.translation || node.position || node.pos || node.location;
    if (Array.isArray(translation) && translation.length >= 3) {
      mesh.position.set(Number(translation[0]) || 0, Number(translation[1]) || 0, Number(translation[2]) || 0);
    }
    const scale = node.scale;
    if (Array.isArray(scale) && scale.length >= 3) {
      mesh.scale.set(Number(scale[0]) || 1, Number(scale[1]) || 1, Number(scale[2]) || 1);
    }
    group.add(mesh);
    built += 1;
  }
  if (!built) return null;
  return { object: group, warnings: ['Se interpretó un JSON de escena genérico; revisa escala y materiales.'] };
}

function geometryFromJsonNode(node) {
  const source = node.mesh && typeof node.mesh === 'object' ? node.mesh : node;
  const rawVerts = source.vertices || source.positions || source.verts || source.vertexPositions || node.vertices || node.positions;
  const points = flattenPoints(rawVerts);
  if (!points || points.length < 9) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));

  const rawIndices = source.faces || source.indices || source.triangles || node.faces || node.indices;
  const indices = flattenIndices(rawIndices, points.length / 3);
  if (indices && indices.length >= 3) geometry.setIndex(indices);
  else geometry.computeVertexNormals();

  geometry.computeBoundingBox();
  return geometry;
}

function flattenPoints(value) {
  if (!Array.isArray(value) || !value.length) return null;
  if (typeof value[0] === 'number') return value.map((n) => Number(n) || 0);
  const flat = [];
  for (const item of value) {
    if (Array.isArray(item) && item.length >= 3) {
      flat.push(Number(item[0]) || 0, Number(item[1]) || 0, Number(item[2]) || 0);
    } else if (item && typeof item === 'object') {
      flat.push(Number(item.x ?? item[0]) || 0, Number(item.y ?? item[1]) || 0, Number(item.z ?? item[2]) || 0);
    } else {
      return null;
    }
  }
  return flat;
}

function flattenIndices(value, vertexCount) {
  if (!Array.isArray(value) || !value.length) return null;
  const flat = [];
  const isFlatNumbers = typeof value[0] === 'number';
  const numbers = [];
  if (isFlatNumbers) numbers.push(...value);
  else for (const face of value) {
    if (Array.isArray(face)) numbers.push(...face);
    else numbers.push(face);
  }
  // Si algún índice alcanza vertexCount, la numeración empieza en 1 (formato OBJ-like).
  const oneBased = numbers.some((raw) => Math.trunc(Number(raw)) >= vertexCount);
  for (const raw of numbers) {
    let n = Math.trunc(Number(raw));
    if (!Number.isFinite(n)) continue;
    if (n < 0) n += vertexCount;
    else if (oneBased) n -= 1;
    if (n >= 0 && n < vertexCount) flat.push(n);
  }
  return flat.length ? flat : null;
}

function colorFromJsonNode(node) {
  const raw = node.color ?? node.colour ?? node.material?.color ?? node.materialColor;
  if (typeof raw === 'number') return new THREE.Color(raw);
  if (Array.isArray(raw) && raw.length >= 3) {
    const [r, g, b] = raw.map((n) => Number(n) || 0);
    const normalized = r > 1 || g > 1 || b > 1 ? [r, g, b] : [r * 255, g * 255, b * 255];
    return new THREE.Color(
      `rgb(${Math.round(normalized[0])},${Math.round(normalized[1])},${Math.round(normalized[2])})`,
    );
  }
  if (typeof raw === 'string' && raw.trim()) return new THREE.Color(raw.trim());
  return new THREE.Color(0xf5c542);
}

function isZipBuffer(buffer) {
  if (!buffer || buffer.byteLength < 4) return false;
  const head = new Uint8Array(buffer, 0, 4);
  return head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07);
}

function isGLBBuffer(buffer) {
  if (!buffer || buffer.byteLength < 12) return false;
  return new DataView(buffer).getUint32(0, true) === 0x46546c67;
}

function decodeBytes(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  } catch {
    return '';
  }
}

function looksLikeJsonText(text) {
  const trimmed = String(text || '').replace(/^\uFEFF/, '').trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function findAsciiOffset(buffer, needle) {
  const bytes = new Uint8Array(buffer);
  const target = [];
  for (let i = 0; i < needle.length; i += 1) target.push(needle.charCodeAt(i));
  outer: for (let i = 0; i <= bytes.length - target.length; i += 1) {
    for (let j = 0; j < target.length; j += 1) {
      if (bytes[i + j] !== target[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function extractEmbeddedGLB(buffer) {
  const offset = findAsciiOffset(buffer, 'glTF');
  if (offset < 0 || offset + 12 > buffer.byteLength) return null;
  const length = new DataView(buffer, offset).getUint32(8, true);
  if (!Number.isFinite(length) || length < 20 || offset + length > buffer.byteLength) return null;
  return buffer.slice(offset, offset + length);
}

function extractEmbeddedOBJ(buffer) {
  if (buffer.byteLength > 80 * 1024 * 1024) return null;
  let text = '';
  try {
    text = new TextDecoder('latin1').decode(buffer);
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/);
  let start = -1;
  let end = -1;
  let vertices = 0;
  let faces = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*v\s+-?[\d.]/.test(line)) {
      vertices += 1;
      if (start < 0) start = Math.max(0, i - 1);
    }
    if (/^\s*f\s+\d/.test(line)) {
      faces += 1;
      end = i;
    }
  }
  if (vertices < 3 || faces < 1) return null;
  return lines.slice(start, end + 1).join('\n');
}

function countMeshes(object) {
  let count = 0;
  object?.traverse?.((node) => {
    if (node.isMesh && node.geometry?.attributes?.position) count += 1;
  });
  return count;
}

function hexPreview(buffer, bytes = 16) {
  if (!buffer) return '';
  return [...new Uint8Array(buffer, 0, Math.min(bytes, buffer.byteLength))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join(' ');
}

function mimeForName(name) {
  const ext = fileExt(name);
  if (ext === 'glb') return 'model/gltf-binary';
  if (ext === 'gltf' || ext === 'json' || ext === 'bbmodel') return 'application/json';
  if (ext === 'obj') return 'text/plain';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  return 'application/octet-stream';
}

async function parseGLTF(source, resources = null) {
  const { manager, dispose } = createResourceManager(resources);
  try {
    const loader = new GLTFLoader(manager);
    return await new Promise((resolve, reject) => loader.parse(source, '', resolve, reject));
  } finally {
    dispose();
  }
}

function standardizeMaterial(material) {
  if (!material) return material;
  if (material.isMeshStandardMaterial) {
    material.envMapIntensity = 0.85;
    if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
    return material;
  }
  if (material.isMeshBasicMaterial) return material;
  const std = new THREE.MeshStandardMaterial({
    name: material.name || '',
    color: material.color?.clone?.() || new THREE.Color(0xffffff),
    map: material.map || null,
    alphaMap: material.alphaMap || null,
    transparent: !!material.transparent,
    opacity: material.opacity ?? 1,
    alphaTest: material.alphaTest || 0,
    side: material.side ?? THREE.FrontSide,
    vertexColors: !!material.vertexColors,
    flatShading: !!material.flatShading,
    emissive: material.emissive?.clone?.() || new THREE.Color(0x000000),
    emissiveIntensity: material.emissiveIntensity ?? 1,
    roughness: material.shininess != null ? 0.58 : 0.64,
    metalness: 0.06,
  });
  std.envMapIntensity = 0.85;
  if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
  return std;
}

export function prepareObject(object, displayName = 'Modelo') {
  object.name = object.name || displayName;
  object.updateMatrixWorld(true);
  object.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
      if (node.isSkinnedMesh) node.frustumCulled = false;
      if (Array.isArray(node.material)) node.material = node.material.map(standardizeMaterial);
      else if (node.material) node.material = standardizeMaterial(node.material);
    }
    if (node.isLight) {
      if (node.isDirectionalLight || node.isSpotLight) {
        node.castShadow = true;
        node.shadow.mapSize.set(2048, 2048);
        node.shadow.bias = -0.0004;
      }
    }
  });
}

export function groundAndCenter(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);
  if (maxDimension > 20 || (maxDimension > 0 && maxDimension < 0.25)) {
    const target = 4.5;
    const factor = target / maxDimension;
    object.scale.multiplyScalar(factor);
    object.updateMatrixWorld(true);
    box.setFromObject(object);
  }

  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
  object.updateMatrixWorld(true);
}

/* ============================================================
   Blockbench .bbmodel
   ============================================================ */

export function parseBBModel(json, resources = null) {
  const group = new THREE.Group();
  group.name = json.name || json.model_identifier || 'Modelo Blockbench';
  const warnings = [];
  const resolution = json.resolution || { width: 16, height: 16 };
  const unit = 1 / 16;
  const textureCache = new Map();

  const loadTexture = (index) => {
    if (index == null) return null;
    if (textureCache.has(index)) return textureCache.get(index);
    const source = json.textures?.[index]?.source;
    if (!source) {
      textureCache.set(index, null);
      return null;
    }
    let textureUrl = source;
    let objectUrl = '';
    if (!/^(data:|blob:|https?:)/i.test(source)) {
      const resource = findResource(resources, source);
      if (resource) {
        objectUrl = URL.createObjectURL(resource);
        textureUrl = objectUrl;
      }
    }
    const texture = new THREE.TextureLoader().load(textureUrl, () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    });
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    textureCache.set(index, texture);
    return texture;
  };

  const elements = Array.isArray(json.elements) ? json.elements : [];
  for (const element of elements) {
    if (element.visibility === false) continue;
    if ((element.type || 'cube') !== 'cube') {
      warnings.push('Se omitió una malla avanzada de Blockbench (tipo mesh).');
      continue;
    }
    const mesh = buildBBCube(element, loadTexture, resolution, unit);
    if (mesh) group.add(mesh);
  }

  if (!group.children.length) {
    warnings.push('No se encontraron cubos visibles en el archivo .bbmodel.');
  }
  group.userData.importWarnings = warnings;
  return { group, warnings };
}

function buildBBCube(element, loadTexture, resolution, unit) {
  const from = new THREE.Vector3(...(element.from || [0, 0, 0]));
  const to = new THREE.Vector3(...(element.to || [0, 0, 0]));
  const inflate = Number(element.inflate) || 0;
  const min = from.clone().min(to).subScalar(inflate);
  const max = from.clone().max(to).addScalar(inflate);
  const size = max.clone().sub(min).multiplyScalar(unit);
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) return null;

  const center = min.clone().add(max).multiplyScalar(0.5).multiplyScalar(unit);
  const origin = element.origin
    ? new THREE.Vector3(...element.origin).multiplyScalar(unit)
    : center.clone();

  const geometry = buildCubeGeometry(size, element, loadTexture, resolution);
  if (!geometry) return null;
  const holder = new THREE.Group();
  holder.name = element.name || 'Cubo';
  holder.position.copy(origin);
  const rotation = element.rotation || [0, 0, 0];
  holder.rotation.set(
    THREE.MathUtils.degToRad(Number(rotation[0]) || 0),
    THREE.MathUtils.degToRad(Number(rotation[1]) || 0),
    THREE.MathUtils.degToRad(Number(rotation[2]) || 0),
  );

  const mesh = new THREE.Mesh(geometry.geometry, geometry.materials);
  mesh.name = holder.name;
  mesh.position.copy(center).sub(origin);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  holder.add(mesh);
  return holder;
}

function buildCubeGeometry(size, element, loadTexture, resolution) {
  const hx = size.x / 2;
  const hy = size.y / 2;
  const hz = size.z / 2;

  const faceDefs = [
    {
      key: 'east',
      corners: [
        [hx, hy, hz],
        [hx, -hy, hz],
        [hx, -hy, -hz],
        [hx, hy, -hz],
      ],
    },
    {
      key: 'west',
      corners: [
        [-hx, hy, -hz],
        [-hx, -hy, -hz],
        [-hx, -hy, hz],
        [-hx, hy, hz],
      ],
    },
    {
      key: 'up',
      corners: [
        [-hx, hy, -hz],
        [-hx, hy, hz],
        [hx, hy, hz],
        [hx, hy, -hz],
      ],
    },
    {
      key: 'down',
      corners: [
        [-hx, -hy, hz],
        [-hx, -hy, -hz],
        [hx, -hy, -hz],
        [hx, -hy, hz],
      ],
    },
    {
      key: 'south',
      corners: [
        [-hx, hy, hz],
        [-hx, -hy, hz],
        [hx, -hy, hz],
        [hx, hy, hz],
      ],
    },
    {
      key: 'north',
      corners: [
        [hx, hy, -hz],
        [hx, -hy, -hz],
        [-hx, -hy, -hz],
        [-hx, hy, -hz],
      ],
    },
  ];

  const positions = [];
  const uvs = [];
  const indices = [];
  const materials = [];
  const faces = element.faces || {};
  const hasFaceData = typeof element.faces === 'object' && element.faces !== null && Object.keys(element.faces).length > 0;

  for (const def of faceDefs) {
    const face = faces[def.key];
    if (hasFaceData && !face) continue;

    const texture = face?.texture != null ? loadTexture(face.texture) : null;
    let uv = face?.uv;
    if (!Array.isArray(uv) || uv.length !== 4) {
      uv = [0, 0, resolution.width || 16, resolution.height || 16];
    }
    const [u1, v1, u2, v2] = uv;
    const texW = texture?.image?.width || resolution.width || 16;
    const texH = texture?.image?.height || resolution.height || 16;

    const base = positions.length / 3;
    for (const corner of def.corners) positions.push(...corner);
    uvs.push(
      u1 / texW,
      1 - v1 / texH,
      u1 / texW,
      1 - v2 / texH,
      u2 / texW,
      1 - v2 / texH,
      u2 / texW,
      1 - v1 / texH,
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);

    const material = texture
      ? new THREE.MeshStandardMaterial({
          map: texture,
          color: 0xffffff,
          roughness: 0.82,
          metalness: 0,
          alphaTest: 0.35,
          side: THREE.DoubleSide,
        })
      : new THREE.MeshStandardMaterial({
          color: 0xaeb9ca,
          roughness: 0.86,
          metalness: 0.02,
          side: THREE.DoubleSide,
        });
    materials.push(material);
  }

  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Reconstruir grupos (cada cara usa su propio material).
  geometry.clearGroups();
  const faceCount = indices.length / 6;
  for (let i = 0; i < faceCount; i += 1) geometry.addGroup(i * 6, 6, i);
  return { geometry, materials };
}

export function describeImport(result) {
  const warnings = result.warnings?.length ? ` ${result.warnings.join(' ')}` : '';
  return `${result.name} importado.${warnings}`;
}

export function importSummary(results) {
  const total = results.length;
  if (total === 1) {
    const result = results[0];
    return `${result.name} importado${result.warnings?.length ? ` · ${result.warnings[0]}` : ''}`;
  }
  return `${total} modelos importados.`;
}

export function formatDuration(seconds) {
  return formatSeconds(seconds);
}
