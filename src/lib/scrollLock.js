// Holds the page still under a popup (the certificates', the documents', the video's) WITHOUT hiding
// its scrollbar. Hiding it (overflow: hidden on <html>) hands the scrollbar's width back to the page,
// which re-flows a few pixels wider, and every line of text visibly shudders as the popup opens and
// again as it closes. So nothing about the layout changes: the scrolls that would move the page (the
// wheel, a finger, the keyboard) are stopped instead, except inside the popup's own scrolling parts
// (the report's pages, the certificates' list on a phone), which keep theirs and, with
// overscroll-behavior: contain, never hand them on to the page.
//
// holdPage(owner) / releasePage(owner): any number of owners; the page is held while any holds it,
// and holding or releasing twice for the same owner does nothing more.
const owners = new Set()

const SCROLL_KEYS = new Set([
  ' ',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])
const TYPING = 'input, textarea, select, [contenteditable], [role="slider"]' // every key is theirs
const PRESSABLE = 'button, a, [role="button"]' // a space presses them; the other keys would scroll

/** A scrolling part of a popup at or around `el` that can still move in this direction. */
function scrollsHere(el, dx, dy) {
  for (let n = el instanceof Element ? el : null; n && n !== document.body; n = n.parentElement) {
    if (n.tagName === 'DIALOG' && !n.contains(el)) break
    const cs = getComputedStyle(n)
    const y = /(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1
    const x = /(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1
    if ((y && dy) || (x && dx) || ((x || y) && !dx && !dy)) return true
    if (n.tagName === 'DIALOG') break
  }
  return false
}

const onWheel = (e) => {
  if (!scrollsHere(e.target, e.deltaX, e.deltaY)) e.preventDefault()
}

let touchY = 0
let touchX = 0
const onTouchStart = (e) => {
  touchX = e.touches[0]?.clientX ?? 0
  touchY = e.touches[0]?.clientY ?? 0
}
const onTouchMove = (e) => {
  const t = e.touches[0]
  if (!t || e.touches.length > 1) return // a pinch zooms, as ever
  if (!scrollsHere(e.target, touchX - t.clientX, touchY - t.clientY)) e.preventDefault()
}

const onKey = (e) => {
  if (!SCROLL_KEYS.has(e.key) || e.defaultPrevented) return
  const t = e.target instanceof Element ? e.target : null
  if (t?.closest(TYPING)) return // the key is the control's own
  if (e.key === ' ' && t?.closest(PRESSABLE)) return // a space presses a button, and scrolls nothing
  if (!scrollsHere(t, 0, 0)) e.preventDefault()
}

export function holdPage(owner) {
  if (owners.has(owner)) return
  owners.add(owner)
  if (owners.size > 1) return
  window.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchmove', onTouchMove, { passive: false })
  window.addEventListener('keydown', onKey)
}

export function releasePage(owner) {
  if (!owners.delete(owner) || owners.size) return
  window.removeEventListener('wheel', onWheel)
  window.removeEventListener('touchstart', onTouchStart)
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('keydown', onKey)
}
