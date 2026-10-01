import { buildChunk } from './terrain.js';
self.onmessage = (e) => {
  const { id, T, face, level, i, j } = e.data;
  const c = buildChunk(T, face, level, i, j);
  self.postMessage({ id, c }, [c.pos.buffer, c.nrm.buffer, c.dir.buffer, c.elev.buffer]);
};
