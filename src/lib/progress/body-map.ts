// Geometría del mapa corporal (SVG propio). Cada forma se define con unos pocos puntos del lado
// izquierdo del dibujo y se refleja sobre el eje central; los contornos se suavizan con
// Catmull-Rom → Bézier. Un `path` por músculo y vista (los dos lados en el mismo `d`).
// Sin dependencias: se calcula una vez al cargar el módulo.

export const BODY_VIEWBOX = { width: 200, height: 420 }
const CENTER = BODY_VIEWBOX.width / 2

type Pt = readonly [number, number]

const fmt = (n: number) => (Math.round(n * 10) / 10).toString()

// Contorno cerrado y suave que pasa por todos los puntos.
export function smoothClosedPath(points: readonly Pt[]) {
  const n = points.length
  const p = (i: number) => points[((i % n) + n) % n]!
  let d = `M${fmt(p(0)[0])} ${fmt(p(0)[1])}`
  for (let i = 0; i < n; i++) {
    const [x0, y0] = p(i - 1)
    const [x1, y1] = p(i)
    const [x2, y2] = p(i + 1)
    const [x3, y3] = p(i + 2)
    const c1x = x1 + (x2 - x0) / 6
    const c1y = y1 + (y2 - y0) / 6
    const c2x = x2 - (x3 - x1) / 6
    const c2y = y2 - (y3 - y1) / 6
    d += `C${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(x2)} ${fmt(y2)}`
  }
  return `${d}Z`
}

// Reflejo con el orden invertido: mismo sentido de giro que el original, así las formas que se
// solapan en un mismo `path` se suman (regla nonzero) en vez de anularse.
const mirror = (points: readonly Pt[]): Pt[] =>
  points.map(([x, y]): Pt => [2 * CENTER - x, y]).reverse()

// Forma del lado izquierdo + su reflejo.
const pair = (points: readonly Pt[]) =>
  `${smoothClosedPath(points)}${smoothClosedPath(mirror(points))}`

// ── Silueta ─────────────────────────────────────────────────

const HEAD = smoothClosedPath([
  [100, 11],
  [113, 16],
  [117, 32],
  [112, 48],
  [100, 54],
  [88, 48],
  [83, 32],
  [87, 16],
])
const NECK = smoothClosedPath([
  [91, 46],
  [109, 46],
  [112, 62],
  [88, 62],
])
const TORSO = smoothClosedPath([
  [100, 58],
  [114, 59],
  [130, 63],
  [146, 74],
  [150, 92],
  [140, 116],
  [134, 150],
  [136, 182],
  [138, 206],
  [126, 222],
  [100, 227],
  [74, 222],
  [62, 206],
  [64, 182],
  [66, 150],
  [60, 116],
  [50, 92],
  [54, 74],
  [70, 63],
  [86, 59],
])
const UPPER_ARM: Pt[] = [
  [50, 78],
  [62, 84],
  [66, 104],
  [64, 128],
  [60, 150],
  [48, 152],
  [41, 138],
  [41, 110],
  [44, 90],
]
const FOREARM: Pt[] = [
  [48, 146],
  [61, 150],
  [59, 176],
  [52, 206],
  [45, 212],
  [38, 206],
  [37, 182],
  [40, 160],
]
const HAND: Pt[] = [
  [39, 206],
  [51, 208],
  [53, 224],
  [47, 240],
  [38, 240],
  [34, 224],
]
const THIGH: Pt[] = [
  [63, 198],
  [82, 204],
  [99, 208],
  [98, 246],
  [94, 282],
  [90, 306],
  [74, 308],
  [67, 290],
  [62, 250],
]
const SHIN: Pt[] = [
  [70, 300],
  [91, 302],
  [93, 332],
  [88, 368],
  [85, 390],
  [75, 390],
  [70, 362],
  [67, 330],
]
const FOOT: Pt[] = [
  [74, 384],
  [86, 384],
  [90, 398],
  [85, 407],
  [68, 406],
  [66, 396],
]

export const BODY_SILHOUETTE = [
  HEAD,
  NECK,
  TORSO,
  pair(UPPER_ARM),
  pair(FOREARM),
  pair(HAND),
  pair(THIGH),
  pair(SHIN),
  pair(FOOT),
].join('')

// ── Músculos ────────────────────────────────────────────────

const DELT_SIDE: Pt[] = [
  [52, 74],
  [58, 71],
  [57, 86],
  [53, 101],
  [46, 102],
  [44, 90],
  [46, 80],
]
const ARM_FRONT_BACK: Pt[] = [
  [52, 106],
  [61, 104],
  [63, 122],
  [59, 142],
  [51, 146],
  [45, 136],
  [45, 118],
]
const FOREARMS: Pt[] = [
  [47, 155],
  [58, 155],
  [56, 178],
  [50, 202],
  [43, 204],
  [40, 184],
  [42, 166],
]

export type BodyView = 'front' | 'back'

export const MUSCLE_PATHS: Record<BodyView, Record<string, string>> = {
  front: {
    delt_side: pair(DELT_SIDE),
    delt_front: pair([
      [60, 71],
      [71, 65],
      [81, 67],
      [77, 79],
      [67, 93],
      [58, 99],
      [59, 85],
    ]),
    chest: pair([
      [82, 70],
      [98, 72],
      [98, 104],
      [88, 111],
      [75, 107],
      [69, 97],
      [73, 81],
    ]),
    biceps: pair(ARM_FRONT_BACK),
    forearms: pair(FOREARMS),
    core:
      smoothClosedPath([
        [86, 116],
        [100, 114],
        [114, 116],
        [116, 152],
        [112, 190],
        [100, 202],
        [88, 190],
        [84, 152],
      ]) +
      pair([
        [71, 118],
        [80, 118],
        [82, 152],
        [80, 184],
        [73, 190],
        [70, 158],
        [68, 132],
      ]),
    quads: pair([
      [70, 216],
      [86, 218],
      [90, 238],
      [90, 272],
      [86, 296],
      [76, 298],
      [68, 280],
      [65, 248],
    ]),
    adductors: pair([
      [91, 219],
      [99, 221],
      [99, 252],
      [95, 268],
      [90, 244],
    ]),
  },
  back: {
    delt_side: pair(DELT_SIDE),
    delt_rear: pair([
      [60, 71],
      [71, 66],
      [80, 69],
      [75, 81],
      [66, 94],
      [58, 99],
      [59, 85],
    ]),
    upper_back: smoothClosedPath([
      [100, 50],
      [110, 58],
      [124, 65],
      [131, 72],
      [118, 80],
      [109, 100],
      [104, 124],
      [100, 130],
      [96, 124],
      [91, 100],
      [82, 80],
      [69, 72],
      [76, 65],
      [90, 58],
    ]),
    lats: pair([
      [72, 88],
      [81, 84],
      [89, 102],
      [94, 132],
      [88, 152],
      [77, 160],
      [70, 138],
      [66, 108],
    ]),
    lower_back: smoothClosedPath([
      [92, 146],
      [100, 140],
      [108, 146],
      [114, 180],
      [106, 196],
      [94, 196],
      [86, 180],
    ]),
    triceps: pair(ARM_FRONT_BACK),
    forearms: pair(FOREARMS),
    glutes: pair([
      [70, 202],
      [86, 204],
      [99, 208],
      [99, 234],
      [89, 248],
      [74, 246],
      [66, 226],
    ]),
    hamstrings: pair([
      [68, 254],
      [84, 254],
      [96, 256],
      [94, 282],
      [88, 300],
      [76, 302],
      [68, 286],
      [64, 266],
    ]),
    calves: pair([
      [71, 314],
      [86, 314],
      [92, 332],
      [88, 356],
      [80, 370],
      [72, 360],
      [68, 334],
    ]),
  },
}
