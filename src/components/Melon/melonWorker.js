// Builds the hero meshes off the main thread (~200–400 ms of Delaunay + embedding), so the intro
// animation never stutters while a model is being prepared. Message: 'melon' (default), or
// { kind: 'bar', priority } for the chocolate bar (barModel.js: fetches the GLB, fits the soft body
// to it and decodes its textures).
import { buildMelon } from './geometry.js'
import { barTransfers, loadBar } from './barModel.js'

self.onmessage = async (e) => {
  try {
    if (e.data?.kind === 'bar') {
      const m = await loadBar({ priority: e.data.priority })
      self.postMessage({ ok: true, mesh: m }, barTransfers(m))
      return
    }
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
