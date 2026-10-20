import './style.css';
import { App } from './app.js';
import { loadProjectFile } from './core/exporter.js';
import { fileExt } from './utils.js';
import { toast } from './ui/ui.js';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']);

async function boot() {
  try {
    const app = new App(document.getElementById('app'));
    window.__PEKITA__ = app;

    try {
      await app.restoreAutosave();
    } catch (error) {
      console.error('[PEKITA] Autoguardado no disponible', error);
    }
    app.initAutosave();

    document.getElementById('boot')?.classList.add('hidden');
    setTimeout(() => document.getElementById('boot')?.remove(), 650);

    document.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });

    document.addEventListener('drop', async (event) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      const files = [...event.dataTransfer.files];
      const first = files[0];
      const ext = fileExt(first.name);

      if (ext === 'peki' || ext === 'zip') {
        try {
          await loadProjectFile(app, first);
        } catch (error) {
          toast(error.message || 'No se pudo abrir el proyecto.', 'error', 4000);
        }
        return;
      }

      if (first.type?.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) {
        await app.loadAudioFile(first);
        return;
      }

      const onlyImages = files.every((file) => IMAGE_EXTENSIONS.has(fileExt(file.name)) || file.type?.startsWith('image/'));
      if (onlyImages) {
        await app.loadBackgroundFile(first);
        return;
      }

      await app.importFileList(files);
    });

    window.addEventListener('error', (event) => {
      if (event.error) console.error('[PEKITA]', event.error);
    });
    window.addEventListener('unhandledrejection', (event) => {
      console.error('[PEKITA] Promesa rechazada', event.reason);
    });
  } catch (error) {
    console.error('[PEKITA] No se pudo iniciar la app', error);
    const bootNode = document.getElementById('boot');
    if (bootNode) {
      bootNode.innerHTML = `
        <div style="max-width:520px;text-align:center;padding:24px">
          <h2 style="margin:0 0 10px;font-size:18px">No se pudo iniciar PEKITA ANIMATE 3D</h2>
          <p style="color:#8693a8;font-size:12px;line-height:1.6">Revisa la consola del navegador para más detalles.</p>
          <pre style="text-align:left;white-space:pre-wrap;font-size:11px;color:#ff8d97;background:#111721;border:1px solid #2d3b51;border-radius:8px;padding:12px">${String(error?.stack || error)}</pre>
        </div>`;
      bootNode.classList.remove('hidden');
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
