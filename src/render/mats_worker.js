// ---------------------------------------------------------------------------
// Web Worker asíncrono sin copias (Transferable ArrayBuffer) para hornear PBR
// 512x512 / 1024x1024 fuera del hilo principal sin bloquear fotogramas.
// ---------------------------------------------------------------------------
import { ARCHETYPES, createBakeScratch, bakeArchetypeBuffers } from './mats_ops.js';

let cachedScratch = null;

self.onmessage = (ev) => {
  const { jobId, size } = ev.data || {};
  if (!size) return;
  if (!cachedScratch || cachedScratch.size !== size) {
    cachedScratch = createBakeScratch(size);
  }
  for (const kind of ARCHETYPES) {
    const { albedoBuf, ormBuf, normalBuf } = bakeArchetypeBuffers(kind, size, cachedScratch);
    self.postMessage(
      {
        jobId,
        size,
        kind,
        albedo: albedoBuf.buffer,
        orm: ormBuf.buffer,
        normal: normalBuf.buffer,
      },
      [albedoBuf.buffer, ormBuf.buffer, normalBuf.buffer]
    );
  }
  self.postMessage({ jobId, size, done: true });
};
