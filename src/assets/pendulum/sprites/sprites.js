// The mini watermelon slice (light theme) and chocolate bar (dark) that slide down the homepage into
// the footer's pendulum figure (components/Footer/FooterPendulum.jsx), each rendered once from the
// owner's Pendulum Heroes code (src/vendor/pendulum) at that figure's progress 0 with its idle clock
// at 0, so where it lands it matches the figure's own slice/bar exactly.
//   w, h        image px
//   hotX, hotY  the hotspot, image px: the slice's tip; the centre of the bar's cream end face (the
//               point that is placed exactly on the figure's)
//   reelPx      image px per reel px (the figure's 1280x720 drawing space)
//   hotReel     the hotspot in reel px at progress 0, so a figure whose camera is (s, ox, oy) shows it
//               at element px (ox + hotReel[0] * s, oy + hotReel[1] * s), drawn at s / reelPx
//   lengthPx    image px from the hotspot to the farthest opaque pixel (it sizes the mini)
// Rendered with the figure's own drawMelon / BarGL in a throwaway page: the slice on a clear canvas,
// the bar on white and on black paper with its alpha pulled from the pair.
import melonSrc from './melon-sprite.webp'
import barSrc from './bar-sprite.webp'

export const SPRITES = {
  melon: { src: melonSrc, w: 558, h: 527, hotX: 244.2, hotY: 521.6, reelPx: 2, hotReel: [825.3, 459.2], lengthPx: 522.5 },
  bar: { src: barSrc, w: 1112, h: 495, hotX: 1065.9, hotY: 340.0, reelPx: 1, hotReel: [1176.13, 434.02], lengthPx: 1079.4 },
}
