// 試作（あとで捨てる）：機械的な入力。お手本の再生と、難しさの計測で同じものを使う
import { JOINTS, type JointName } from "./sim.ts";

/** 脚を交互に振る歩き方。T: 周期（秒）、h0: ももの中心、A: ももの振り幅、K: ひざの曲げ、kp: ひざのタイミング */
export interface Gait {
  T: number;
  h0: number;
  A: number;
  K: number;
  kp: number;
}

/** 関節ごとの、タイミングのずれ（秒）と、動かす幅の倍率。息の合わない4人の代わり */
export type Noise = Record<JointName, { delay: number; scale: number }>;

export const NO_NOISE: Noise = {
  rightHip: { delay: 0, scale: 1 },
  leftHip: { delay: 0, scale: 1 },
  rightKnee: { delay: 0, scale: 1 },
  leftKnee: { delay: 0, scale: 1 },
};

const clamp = (x: number) => Math.min(1, Math.max(0, x));

export function gaitInput(g: Gait, time: number, noise: Noise = NO_NOISE): Record<JointName, number> {
  const out = {} as Record<JointName, number>;
  for (const j of JOINTS) {
    const n = noise[j];
    const ph = ((time - n.delay) / g.T) * Math.PI * 2 + (j.startsWith("left") ? Math.PI : 0);
    out[j] = j.endsWith("Hip")
      ? clamp(g.h0 + g.A * n.scale * Math.sin(ph))
      : clamp(g.K * n.scale * Math.max(0, Math.sin(ph + g.kp)));
  }
  return out;
}

/** 乱数の種から、ずれを作る。delaySd: タイミングのずれの大きさ（秒）、scaleSd: 幅のずれの大きさ */
export function makeNoise(seed: number, delaySd: number, scaleSd: number): Noise {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const out = {} as Noise;
  for (const j of JOINTS) out[j] = { delay: gauss() * delaySd, scale: Math.max(0.3, 1 + gauss() * scaleSd) };
  return out;
}
