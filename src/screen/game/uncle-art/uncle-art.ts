import type { UncleArt } from "../art.ts";

// どれも右向きで、512 px/m で書き出した。ももとすねの src は、担当の人の色を掛けるので、色を出す所を白で描いてある
const headPlacement = { width: 237 / 512, anchor: { x: 125.4 / 237, y: 114.5 / 243 } };

export const UNCLE_ART = {
  head: {
    normal: { ...headPlacement, src: new URL("./head-normal.png", import.meta.url).href },
    strain: { ...headPlacement, src: new URL("./head-strain.png", import.meta.url).href },
    goal: { ...headPlacement, src: new URL("./head-goal.png", import.meta.url).href },
    fell: { ...headPlacement, src: new URL("./head-fell.png", import.meta.url).href },
  },
  torso: {
    src: new URL("./torso.png", import.meta.url).href,
    width: 270 / 512,
    anchor: { x: 135.1 / 270, y: 195.9 / 444 },
  },
  thigh: {
    src: new URL("./thigh.png", import.meta.url).href,
    lines: new URL("./thigh-lines.png", import.meta.url).href,
    width: 140 / 512,
    anchor: { x: 74.5 / 140, y: 199.7 / 376 },
  },
  shin: {
    src: new URL("./shin.png", import.meta.url).href,
    lines: new URL("./shin-lines.png", import.meta.url).href,
    width: 173 / 512,
    anchor: { x: 51.0 / 173, y: 143.6 / 293 },
    stringAt: { x: -0.0624, y: -0.2491 },
  },
} satisfies UncleArt;
