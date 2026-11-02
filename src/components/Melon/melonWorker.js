// Builds the melon meshes off the main thread (~200 ms of Delaunay + embedding),
// so the intro animation never stutters while the slice is being prepared.
import { buildMelon } from './geometry.js'

self.onmessage = () => {
  try {
    const m = buildMelon()
    const transfer = [
      m.sim.rest.buffer, m.sim.tets.buffer, m.sim.region.buffer, m.sim.surface.buffer,
      m.render.rest.buffer, m.render.mat.buffer, m.render.index.buffer,
      m.skinIdx.buffer, m.skinW.buffer,
    ]
    self.postMessage({ ok: true, mesh: m }, transfer)
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.message || err) })
  }
}
