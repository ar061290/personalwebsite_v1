// "Aadi" signature artwork, drawn on by Signature.jsx.
//
// SIGNATURE_VIEWBOX  'minX minY w h' of the artwork (the same 320 x 154 box as
//                    the haoqi.design reference, so pen speed matches it).
// SIGNATURE_STROKES  single-stroke centreline paths, one per pen-down, IN
//                    DRAWING ORDER (each path also runs in the pen's direction):
//   id      name of the stroke
//   d       SVG path data (M + cubic C segments), stroked, never filled
//   width   stroke width in viewBox units (uniform; the reference has no
//           pressure variation: 4 for the writing, 5 for the dot)
//   pause   (optional, s) pen-lift before this stroke. Not set on any stroke:
//           every stroke uses the reference's uniform 30 ms lift.
// Strokes are drawn with butt caps, like the reference. Each path's length is
// measured at runtime (getTotalLength), so no lengths are stored here.
// Lengths at the time of writing: A 297.7, adi 813.4, dot 5.8 viewBox units.
//
// Drawn as hand-placed knots on an upright baseline, smoothed with centripetal
// Catmull-Rom into cubic Beziers, then slanted (shear 0.32) and turned -4 deg.
export const SIGNATURE_VIEWBOX = '0 0 320 154'

export const SIGNATURE_STROKES = [
  // capital A: up the left leg from the bottom-left foot to the apex, then down
  // the right leg, ending in a small flick
  {
    id: 'A',
    width: 4,
    d: 'M21.25 147C25.17 141.93 28.96 137.92 33.02 131.78C38.71 123.18 44.22 111.25 50.93 99.68C58.92 85.89 69.26 68.03 78.05 54.6C85.39 43.39 92.92 32.57 99.54 24.3C104.45 18.17 108.75 14.06 113.36 8.94C112.16 17.94 111.08 26.2 109.77 35.93C108.23 47.37 106.29 61.03 104.65 73.3C103.06 85.24 100.72 98.47 100.05 108.59C99.52 116.43 98.46 124.22 100.04 129.15C101.22 132.81 104.14 134.35 106.18 136.95',
  },
  // crossbar + "adi", one connected stroke: starts on the left leg, loops out
  // left, sweeps right across both legs into the "a" (retracing its top), then the
  // "d" bowl and tall looped ascender, the "i" and a long rising exit tail
  {
    id: 'adi',
    width: 4,
    d: 'M54.89 93.75C50.84 95.92 46.73 97.6 42.74 100.25C38.49 103.08 33.06 106.75 30.21 110.38C27.85 113.39 25.43 117.72 25.86 119.94C26.26 122.02 29.19 123.57 32 123.63C35.8 123.71 41.99 120.02 47.6 117.39C54.35 114.24 61.85 109.39 69.6 105.57C78.14 101.37 87.71 97.13 96.72 93.39C105.61 89.71 114.86 86.58 123.33 83.31C131.08 80.31 138.16 77.47 145.58 74.55C142.17 74.79 138.53 73.57 135.35 75.27C131.83 77.14 127.84 82.14 125.63 86.23C123.26 90.61 121.31 97.38 122.05 100.88C122.65 103.72 125.19 106.75 127.67 106.65C130.26 106.56 134.48 103.31 137.4 99.8C141.95 94.31 144.9 82.83 148.65 74.34C146.95 79.94 144.54 86 143.54 91.15C142.66 95.63 141.16 101.11 142.51 103.56C143.58 105.5 146.38 105.82 148.91 106.2C151.8 106.62 155.81 106.74 159.14 105.48C162.46 104.22 166.15 101.56 168.86 98.63C171.79 95.46 173.75 91.03 175.77 86.84C177.99 82.23 179.52 76.98 181.4 72.05C178.16 70.22 174.62 67.45 171.17 68.65C167.62 69.88 163.35 74.66 160.68 78.64C157.68 83.1 154.98 89.98 154.79 94.47C154.62 98.42 155.88 103.48 158.37 104.51C160.59 105.42 165.42 103.84 168.09 101.77C170.98 99.54 172.64 95.17 174.75 91.02C177.49 85.63 179.81 78.78 182.42 71.98C185.42 64.14 188.76 54.91 191.63 46.65C194.37 38.77 197.82 30.28 199.31 23.5C200.5 18.06 202.19 11.42 200.84 8.99C200.02 7.5 197.78 6.5 196.24 7.26C193.87 8.41 191.18 14.83 189.08 20.1C185.84 28.21 183.62 41.05 181.4 51.48C179.18 61.93 176.83 74 175.77 82.72C174.99 89.15 173.54 95.88 174.74 99.25C175.5 101.36 176.83 103.15 178.84 103.08C181.61 102.97 187.25 98.48 190.86 95.04C194.84 91.26 198.57 85.1 201.35 80.94C203.47 77.77 204.76 75.21 206.47 72.35C204.59 77.28 201.93 82.46 200.84 87.14C199.82 91.49 198.35 97.36 199.81 99.55C200.95 101.25 203.73 101.16 206.47 101.14C210.14 101.12 215.38 99.67 220.28 98.12C225.87 96.35 232.03 93.94 238.19 90.7C245.11 87.05 252.56 82.22 259.68 76.86C267.4 71.04 275.83 63.4 282.7 56.74C288.79 50.84 293.62 45.01 299.08 39.14',
  },
  // dot of the i, a short down-tick drawn last, slightly heavier
  {
    id: 'dot',
    width: 5,
    d: 'M214.91 54.28C214.14 56.05 213.38 57.82 212.61 59.58',
  },
]
