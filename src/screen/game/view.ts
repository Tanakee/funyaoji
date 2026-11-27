// PixiJS の描画。SimState を読んで描くだけで、物理にも Rapier にも触れない
import { Application, BitmapFont, BitmapText, Container, Graphics, Text } from "pixi.js";
import { JOINTS, type Joint } from "../../shared/messages.ts";
import { INITIAL_POSES, PART_NAMES, PART_SHAPES, TORSO_SIZE, type PartName } from "./body.ts";
import { formatDistance, formatTime } from "./format.ts";
import { GOAL_M, type SimState } from "./sim.ts";

/** 色はここに集める。見た目は、あとで人が決める */
export const COLORS = {
  sky: 0xf6f1e7,
  ground: 0xd9cfbd,
  groundEdge: 0x8a7f68,
  tick: 0x6b6252,
  text: 0x2b2b2b,
  outline: 0x2b2b2b,
  start: 0x2e86ab,
  goal: 0xc0392b,
  goalCheckerLight: 0xffffff,
  goalCheckerDark: 0x2b2b2b,
  torso: 0xe9d8b4,
  head: 0xf3e2c3,
  foot: 0x3a3a3a,
  face: 0x2b2b2b,
  /** 関節ごとの色。ももは股関節の色、すねはひざの色。4人が自分の脚を見つけるための色分け */
  joint: {
    rightHip: 0xe4572e,
    leftHip: 0x2e86ab,
    rightKnee: 0xf3a712,
    leftKnee: 0x4caf7d,
  } satisfies Record<Joint, number>,
};

const JOINT_LABELS: Record<Joint, string> = {
  rightHip: "右もも",
  leftHip: "左もも",
  rightKnee: "右ひざ",
  leftKnee: "左ひざ",
};

// 部位を動かす関節（色分けに使う）
const PART_JOINT: Record<Exclude<PartName, "torso">, Joint> = {
  rightThigh: "rightHip",
  rightShin: "rightKnee",
  leftThigh: "leftHip",
  leftShin: "leftKnee",
};

// 左の脚を奥に、右の脚を手前に描く
const DRAW_ORDER: PartName[] = ["leftThigh", "leftShin", "torso", "rightThigh", "rightShin"];

const LAYOUT = {
  /** 地面の位置（画面の高さに対する割合） */
  groundY: 0.78,
  /** 胴を置く横の位置（画面の幅に対する割合）。ゴールが見えるよう、少し左に寄せる */
  cameraX: 0.4,
  /** 画面の幅に入れたい長さ（m）。高さが足りないときは縮む */
  visibleWidthM: 9,
  /** 地面から画面の上までに入れたい高さ（m） */
  visibleHeightM: 3.6,
  /** 1280 x 720 を 1 としたときの、文字や線の大きさの下限・上限 */
  uiScale: [0.6, 2.2],
  fontFamily: "system-ui, 'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', sans-serif",
};

const HUD_FONT = "funyaoji-hud";
let hudFontInstalled = false;
/** HUD の数字の字形を作る。画面が再作成されても残し、1 回だけ作る */
function installHudFont(): void {
  if (hudFontInstalled) return;
  hudFontInstalled = true;
  BitmapFont.install({
    name: HUD_FONT,
    chars: "0123456789.- m秒",
    resolution: Math.min(2, window.devicePixelRatio || 1),
    style: { fontFamily: LAYOUT.fontFamily, fontSize: 64, fontWeight: "bold", fill: 0xffffff },
  });
}

export interface View {
  /** 描画のたびに呼ばれる。dtSec は前のフレームからの実時間 */
  onFrame(callback: (dtSec: number) => void): void;
  render(state: SimState): void;
  destroy(): void;
}

/** 部位の形を描く。m のまま描くと曲線が粗くなるので、cm で描いて 0.01 倍にする */
const CM = 100;

function drawPart(name: PartName): Graphics {
  const g = new Graphics();
  g.scale.set(1 / CM);
  for (const shape of PART_SHAPES[name]) {
    const color =
      shape.tag === "foot"
        ? COLORS.foot
        : shape.tag === "head"
          ? COLORS.head
          : name === "torso"
            ? COLORS.torso
            : COLORS.joint[PART_JOINT[name]];
    if (shape.kind === "box") {
      g.roundRect(
        (shape.ox - shape.hw) * CM,
        (shape.oy - shape.hh) * CM,
        shape.hw * 2 * CM,
        shape.hh * 2 * CM,
        Math.min(shape.hw, shape.hh) * 0.5 * CM,
      );
    } else {
      g.circle(shape.ox * CM, shape.oy * CM, shape.r * CM);
    }
    g.fill(color).stroke({ width: 1.4, color: COLORS.outline });
  }
  if (name === "torso") {
    // 顔。進む向き（右）を向いている
    const headY = (TORSO_SIZE.hh + TORSO_SIZE.headR) * CM;
    g.circle(5, headY + 3, 1.6).fill(COLORS.face);
    g.moveTo(9, headY - 1)
      .lineTo(14, headY - 4)
      .lineTo(9, headY - 6)
      .stroke({ width: 1.4, color: COLORS.face });
  }
  return g;
}

function label(text: string, size: number, color: number, bold = false): Text {
  return new Text({
    text,
    style: {
      fontFamily: LAYOUT.fontFamily,
      fontSize: size,
      fontWeight: bold ? "bold" : "normal",
      fill: color,
    },
  });
}

export async function createView(container: HTMLElement): Promise<View> {
  const app = new Application();
  await app.init({
    resizeTo: container,
    background: COLORS.sky,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });
  installHudFont();
  app.canvas.style.display = "block";
  container.appendChild(app.canvas);
  // 要素の大きさだけが変わっても追従する（window の resize だけでは足りない）
  const observer = new ResizeObserver(() => app.queueResize());
  observer.observe(container);

  // 重なりの順：ルーラー（地面と目盛り）→ おじさん → HUD
  const ruler = new Graphics();
  const labelLayer = new Container();
  const rulerLabels = new Map<string, Text>();
  const rulerLabel = (key: string, text: string, size: number, color: number, bold = false) => {
    let t = rulerLabels.get(key);
    if (!t) {
      t = label(text, size, color, bold);
      t.anchor.set(0.5, 0);
      labelLayer.addChild(t);
      rulerLabels.set(key, t);
    }
    return t;
  };

  // 世界の座標（m、上が +y）で動かす。原点の位置と拡大は、描くたびに決める
  const world = new Container();
  const partGraphics = {} as Record<PartName, Graphics>;
  for (const name of DRAW_ORDER) {
    const g = drawPart(name);
    g.position.set(INITIAL_POSES[name].x, INITIAL_POSES[name].y);
    partGraphics[name] = g;
    world.addChild(g);
  }

  const hud = new Container();
  const distanceText = new BitmapText({
    text: "",
    style: { fontFamily: HUD_FONT, fontSize: 64, fill: COLORS.text },
  });
  const timeText = new BitmapText({
    text: "",
    style: { fontFamily: HUD_FONT, fontSize: 40, fill: COLORS.text },
  });
  timeText.y = 78;
  hud.addChild(distanceText, timeText);

  // 凡例。担当の関節の色と名前
  const legend = new Container();
  JOINTS.forEach((joint, i) => {
    const chip = new Graphics()
      .roundRect(0, 0, 150, 40, 8)
      .fill(COLORS.joint[joint])
      .stroke({ width: 2, color: COLORS.outline });
    const name = label(JOINT_LABELS[joint], 24, 0xffffff, true);
    name.anchor.set(0.5);
    name.position.set(75, 20);
    name.style.stroke = { color: COLORS.outline, width: 4 };
    const item = new Container();
    item.addChild(chip, name);
    item.y = i * 48;
    legend.addChild(item);
  });

  app.stage.addChild(ruler, labelLayer, world, hud, legend);

  function render(state: SimState): void {
    const { width: w, height: h } = app.screen;
    const groundY = h * LAYOUT.groundY;
    const pxPerM = Math.min(w / LAYOUT.visibleWidthM, groundY / LAYOUT.visibleHeightM);
    const ui = Math.min(
      LAYOUT.uiScale[1],
      Math.max(LAYOUT.uiScale[0], Math.min(w / 1280, h / 720)),
    );
    const originX = w * LAYOUT.cameraX;
    const camX = state.poses.torso.x;
    const screenX = (m: number) => originX + (m - camX) * pxPerM;

    world.position.set(originX - camX * pxPerM, groundY);
    world.scale.set(pxPerM, -pxPerM);
    for (const name of PART_NAMES) {
      const pose = state.poses[name];
      partGraphics[name].position.set(pose.x, pose.y);
      partGraphics[name].rotation = pose.rot;
    }

    // 地面（スタートの後ろにも続く）、1m ごとの目盛り、スタートとゴール
    ruler.clear();
    ruler.rect(0, groundY, w, h - groundY).fill(COLORS.ground);
    ruler
      .moveTo(0, groundY)
      .lineTo(w, groundY)
      .stroke({ width: 4 * ui, color: COLORS.groundEdge });
    const first = Math.floor(camX - originX / pxPerM) - 1;
    const last = Math.ceil(camX + (w - originX) / pxPerM) + 1;
    for (const t of rulerLabels.values()) t.visible = false;
    for (let m = first; m <= last; m++) {
      const x = screenX(m);
      const major = m % 5 === 0;
      ruler
        .moveTo(x, groundY)
        .lineTo(x, groundY + (major ? 26 : 16) * ui)
        .stroke({ width: (major ? 3 : 2) * ui, color: COLORS.tick });
      const num = rulerLabel(`m${m}`, `${m}`, 22, COLORS.tick, major);
      num.visible = true;
      num.scale.set(ui);
      num.position.set(x, groundY + 30 * ui);
    }

    // スタートライン。胴の上までの高さ
    const startX = screenX(0);
    ruler
      .rect(startX - 3 * ui, groundY - pxPerM * 2.2, 6 * ui, pxPerM * 2.2)
      .fill({ color: COLORS.start, alpha: 0.7 });
    const startLabel = rulerLabel("start", "スタート", 30, COLORS.start, true);
    startLabel.visible = true;
    startLabel.scale.set(ui);
    startLabel.position.set(startX, groundY - pxPerM * 2.6);

    // ゴールライン。市松模様の太い帯を、画面の上から地面まで立てる
    const goalX = screenX(GOAL_M);
    const cell = Math.max(10, pxPerM * 0.2);
    const rows = Math.ceil(groundY / cell);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < 2; col++) {
        const dark = (row + col) % 2 === 0;
        ruler
          .rect(goalX - cell + col * cell, groundY - (row + 1) * cell, cell, cell)
          .fill(dark ? COLORS.goalCheckerDark : COLORS.goalCheckerLight);
      }
    }
    ruler.rect(goalX - cell, 0, cell * 2, groundY).stroke({ width: 3 * ui, color: COLORS.goal });
    const goalLabel = rulerLabel("goal", `ゴール ${GOAL_M}m`, 36, COLORS.goal, true);
    goalLabel.visible = true;
    goalLabel.scale.set(ui);
    goalLabel.position.set(goalX, groundY - pxPerM * 2.6);
    // 市松模様の上でも読めるように、白い下地を敷く
    const pad = 8 * ui;
    ruler
      .roundRect(
        goalX - goalLabel.width / 2 - pad,
        goalLabel.y - pad / 2,
        goalLabel.width + pad * 2,
        goalLabel.height + pad,
        8 * ui,
      )
      .fill(COLORS.goalCheckerLight)
      .stroke({ width: 3 * ui, color: COLORS.goal });

    hud.scale.set(ui);
    hud.position.set(24 * ui, 16 * ui);
    distanceText.text = `${formatDistance(state.distanceM)} m`;
    timeText.text = `${formatTime(state.elapsedMs)} 秒`;
    legend.scale.set(ui);
    legend.position.set(w - 24 * ui - 150 * ui, 16 * ui);
  }

  return {
    onFrame(callback) {
      app.ticker.add((ticker) => callback(ticker.deltaMS / 1000));
    },
    render,
    destroy() {
      observer.disconnect();
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
