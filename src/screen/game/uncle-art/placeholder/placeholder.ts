import type { UncleArt } from "../../art.ts";

export const PLACEHOLDER_ART: UncleArt = {
  head: {
    normal: { src: new URL("./head-normal.svg", import.meta.url).href, width: 0.24 },
    fell: { src: new URL("./head-fell.svg", import.meta.url).href, width: 0.24 },
  },
  torso: { src: new URL("./torso.svg", import.meta.url).href, width: 0.48 },
  thigh: { src: new URL("./thigh.svg", import.meta.url).href, width: 0.14 },
  shin: {
    src: new URL("./shin.svg", import.meta.url).href,
    width: 0.44,
    anchor: { x: 0.32 / 0.44, y: 0.194 / 0.468 },
  },
};
