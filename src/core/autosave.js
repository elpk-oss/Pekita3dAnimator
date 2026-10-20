const DB_NAME = 'pekita-animate-3d';
const DB_VERSION = 1;
const STORE = 'autosave';
const KEY = 'current';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no está disponible en este navegador.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir el almacenamiento local.'));
  });
}

/** Guarda una copia completa del proyecto en IndexedDB. */
export class AutoSaveStore {
  constructor() {
    this.dbPromise = null;
  }

  get available() {
    return typeof indexedDB !== 'undefined';
  }

  db() {
    if (!this.dbPromise) this.dbPromise = openDatabase();
    return this.dbPromise;
  }

  async save(blob, meta = {}) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ blob, meta, savedAt: Date.now() }, KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('No se pudo escribir el autoguardado.'));
      tx.onabort = () => reject(tx.error || new Error('Autoguardado cancelado.'));
    });
  }

  async load() {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('No se pudo leer el autoguardado.'));
    });
  }

  async clear() {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('No se pudo borrar el autoguardado.'));
    });
  }
}
