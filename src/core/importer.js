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
    case 'prisma': {
      const text = await file.text();
      let json = null;
      try {
        json = JSON.parse(text.replace(/^\uFEFF/, ''));
      } catch {
        throw new Error('Prisma 3D: exporta el modelo como .obj o .glb desde la app.');
      }
      if (json.elements || json.outliner) {
        const parsed = parseBBModel(json, resources);
        object = parsed.group;
        warnings = warnings.concat(parsed.warnings);
      } else {
        throw new Error('Prisma 3D: exporta el modelo como .obj o .glb para importarlo aquí.');
      }
      break;
    }
    case 'proj':
    case 'projy': {
      const parsed = await importProjectModel(app, file, resources);
      if (parsed.imported) return parsed.imported;
      object = parsed.object;
      warnings = warnings.concat(parsed.warnings || []);
      break;
    }
    default:
      throw new Error(`Formato .${ext || '?'} no soportado. Usa GLB, GLTF, OBJ, FBX, STL, PLY, DAE, 3MF, BBModel o PROJ.`);
  }

  if (!object) throw new Error('No se pudo crear el objeto 3D.');

  prepareObject(object, displayName);
  groundAndCenter(object);
  const entry = app.registerImportedRoot(object, displayName, warnings);
  return { entry, object, warnings, name: displayName };
}

async function importProjectModel(app, file, resources = null) {
  const buffer = await file.arrayBuffer();
  let zip = null;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    zip = null;
  }

  if (zip) {
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    const projectEntry = entries.find((entry) => /(^|\/)project\.json$/i.test(entry.name));
    if (projectEntry) {
      try {
        const project = JSON.parse((await projectEntry.async('text')).replace(/^\uFEFF/, ''));
        if (project.format === 'pekita-animate-3d') {
          throw new Error('Este PROJ contiene un proyecto PEKITA. Ábrelo con Archivo → Abrir proyecto (.peki).');
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
      entries.find((entry) => /\.(obj|fbx|stl|ply|dae|3mf)$/i.test(entry.name));

    if (modelEntry) {
      const name = modelEntry.name.split('/').pop();
      const data = await modelEntry.async('uint8array');
      const modelFile = new File([data], name, { type: mimeForName(name) });
      const imported = await importFile(app, modelFile, zipResources);
      return { imported };
    }

    for (const entry of entries.filter((item) => /\.json$/i.test(item.name))) {
      try {
        const json = JSON.parse((await entry.async('text')).replace(/^\uFEFF/, ''));
        if (json.elements || json.outliner) {
          const parsed = parseBBModel(json, zipResources);
          return { object: parsed.group, warnings: parsed.warnings };
        }
      } catch {
        /* prueba con el siguiente JSON */
      }
    }

    throw new Error('El archivo PROJ no contiene un modelo compatible. Si es un proyecto de Prisma 3D, exporta el modelo como OBJ o GLB.');
  }

  const text = new TextDecoder().decode(buffer);
  let json = null;
  try {
    json = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('PROJ no reconocido. Exporta el modelo como GLB, OBJ o BBModel para importarlo.');
  }
  if (json.format === 'pekita-animate-3d') {
    throw new Error('Este PROJ es un proyecto PEKITA. Ábrelo con Archivo → Abrir proyecto (.peki).');
  }
  if (json.elements || json.outliner) {
    const parsed = parseBBModel(json, resources);
    return { object: parsed.group, warnings: parsed.warnings };
  }
  if (json.asset?.version) {
    const gltf = await parseGLTF(text, resources);
    return { object: gltf.scene, warnings: gltf.animations?.length ? ['El modelo incluye animaciones; se importó en pose estática.'] : [] };
  }
  throw new Error('PROJ no reconocido. Exporta el modelo como GLB, OBJ o BBModel para importarlo.');
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
