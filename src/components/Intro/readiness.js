// Stand-ins for the textures sofaknows preloads behind its loading line: our
// "assets" are the document, the intro font and any strip photos. Each task
// is capped so a font or image that never answers cannot hang the intro.

const CAP = 6000

export function readinessTasks({ images = [], onFonts } = {}) {
  const timers = []
  const capped = (p) =>
    Promise.race([
      Promise.resolve(p).catch(() => {}),
      new Promise((resolve) => timers.push(setTimeout(resolve, CAP))),
    ])

  const fonts = document.fonts
    ? document.fonts.load('900 16px Archivo', 'AADIRAMNANI').then(() => document.fonts.ready)
    : Promise.resolve()

  const page =
    document.readyState === 'complete'
      ? Promise.resolve()
      : new Promise((resolve) => window.addEventListener('load', resolve, { once: true }))

  const pics = images.map(({ src }) => {
    const img = new Image()
    img.decoding = 'async'
    img.src = src
    return img.decode ? img.decode() : new Promise((res, rej) => ((img.onload = res), (img.onerror = rej)))
  })

  const afterFonts = capped(fonts).then(() => {
    try {
      onFonts?.()
    } catch {
      /* measuring is best effort */
    }
  })
  const tasks = [afterFonts, capped(page), ...pics.map(capped)]
  return { tasks, cancel: () => timers.forEach(clearTimeout) }
}
