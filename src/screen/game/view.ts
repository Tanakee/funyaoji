// PixiJS の描画。SimState を読んで描くだけで、物理にも Rapier にも触れない
import {
  Application,
  BitmapFont,
  BitmapText,
  CanvasTextMetrics,
  Container,
  Graphics,
  Text,
  type ColorSource,
} from "pixi.js";
import { JOINT_DISPLAY } from "../../shared/joints.ts";
import { JOINTS, type Joint } from "../../shared/messages.ts";
import { INITIAL_POSES, PART_NAMES, PART_SHAPES, TORSO_SIZE, type PartName } from "./body.ts";
import { formatDistance, formatTime } from "./format.ts";
import { CAMERA, Camera, type Scene } from "./camera.ts";
import { SCREEN_LAYOUT, screenScale } from "./layout.ts";
import { GOAL_M, type SimState } from "./sim.ts";

/** 色の決まりは docs/screens.md の「色・フォント・刷り」。部位ごとの色は shared/joints.ts */
const COLORS = {
  sky: 0xf6f1e7,
  ground: 0xd9cfbd,
  groundEdge: 0x8a7f68,
  tick: 0x1f3a68,
  text: 0x1f3a68,
  outline: 0x1f3a68,
  start: 0x1f3a68,
  goal: 0xa8282e,
  goalCheckerLight: 0xfbf8f0,
  goalCheckerDark: 0x1f3a68,
  torso: 0xc2a682,
  head: 0xf2cfae,
  foot: 0xf4efe3,
  face: 0x1f3a68,
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
  /** 画面の幅に入れたい長さ（m）。高さが足りないときは縮む */
  visibleWidthM: 9,
  /** 地面から画面の上までに入れたい高さ（m） */
  visibleHeightM: 3.6,
  fontFamily:
    "'Zen Kaku Gothic New', system-ui, 'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', sans-serif",
};

const DISPLAY_FONT_FAMILY = "'Zen Old Mincho', 'Hiragino Mincho ProN', 'Yu Mincho', serif";
type FontState = "loaded" | "fallback";
const HUD_FONT_NAME: Record<FontState, string> = {
  loaded: "funyaoji-hud",
  fallback: "funyaoji-hud-fallback",
};
const installedHudFonts = new Set<FontState>();

function hudFontName(state: FontState): string {
  const name = HUD_FONT_NAME[state];
  if (installedHudFonts.has(state)) return name;
  // 以前の画面で代替フォントを計測していても、新しい字形の幅を使う
  if (state === "loaded") CanvasTextMetrics.clearMetrics();
  BitmapFont.install({
    name,
    chars: "0123456789.- m秒",
    resolution: Math.min(2, window.devicePixelRatio || 1),
    style: { fontFamily: DISPLAY_FONT_FAMILY, fontSize: 64, fontWeight: "900", fill: 0xffffff },
  });
  installedHudFonts.add(state);
  return name;
}

async function loadViewFonts(): Promise<boolean> {
  try {
    const faces = await Promise.all([
      document.fonts.load('900 64px "Zen Old Mincho"', "0123456789.m秒"),
      document.fonts.load('700 24px "Zen Kaku Gothic New"', "スタートゴール左右ひざもも"),
      document.fonts.load('900 24px "Zen Kaku Gothic New"', "スタートゴール左右ひざもも"),
    ]);
    return faces.every((face) => face.length > 0);
  } catch {
    return false;
  }
}

export interface View {
  /** 画面に合わせて、カメラと、距離・タイム・凡例を出すかを変える */
  setScene(scene: Scene): void;
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
            : JOINT_DISPLAY[PART_JOINT[name]].color;
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

function label(text: string, size: number, color: ColorSource, bold = false): Text {
  return new Text({
    text,
    style: {
      fontFamily: LAYOUT.fontFamily,
      fontSize: size,
      fontWeight: bold ? "900" : "700",
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
  // PixiJS の Text と BitmapFont は作った時点のフォントで字形を描き、あとでフォントが届いても描き直さない
  const fontsLoaded = loadViewFonts();
  let timeout = 0;
  const loadTimeout = new Promise<"timeout">((resolve) => {
    timeout = window.setTimeout(() => resolve("timeout"), 3000);
  });
  const fontState = await Promise.race([fontsLoaded, loadTimeout]);
  window.clearTimeout(timeout);
  const hudFont = hudFontName(fontState === true ? "loaded" : "fallback");
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
    style: { fontFamily: hudFont, fontSize: 64, fill: COLORS.text },
  });
  const timeText = new BitmapText({
    text: "",
    style: { fontFamily: hudFont, fontSize: 40, fill: COLORS.text },
  });
  timeText.y = 78;
  hud.addChild(distanceText, timeText);

  // 凡例。担当の関節の色と名前
  const legend = new Container();
  const addLegendName = (item: Container, joint: Joint) => {
    const name = label(JOINT_DISPLAY[joint].name, 24, JOINT_DISPLAY[joint].textOnColor, true);
    name.anchor.set(0.5);
    name.position.set(75, 20);
    item.addChild(name);
  };
  JOINTS.forEach((joint, i) => {
    const chip = new Graphics()
      .roundRect(0, 0, 150, 40, 8)
      .fill(JOINT_DISPLAY[joint].color)
      .stroke({ width: 2, color: COLORS.outline });
    const item = new Container();
    item.addChild(chip);
    addLegendName(item, joint);
    item.y = i * 48;
    legend.addChild(item);
  });

  app.stage.addChild(ruler, labelLayer, world, hud, legend);

  function rebuildTextsWithLoadedFont(): void {
    const loadedHudFont = hudFontName("loaded");
    distanceText.style.fontFamily = loadedHudFont;
    timeText.style.fontFamily = loadedHudFont;
    for (const label of rulerLabels.values()) label.destroy();
    rulerLabels.clear();
    JOINTS.forEach((joint, i) => {
      const item = legend.getChildAt(i);
      item.getChildAt(1).destroy();
      addLegendName(item, joint);
    });
  }
  if (fontState === "timeout") {
    void fontsLoaded.then((loaded) => {
      if (loaded && !legend.destroyed) rebuildTextsWithLoadedFont();
    });
  }

  const camera = new Camera();
  function setScene(scene: Scene): void {
    hud.visible = scene === "playing";
    legend.visible = scene === "countdown" || scene === "playing";
    camera.setScene(scene, performance.now());
  }
  setScene("lobby");

  function render(state: SimState): void {
    const { width: w, height: h } = app.screen;
    const ui = screenScale(w, h);
    const groundY = h - SCREEN_LAYOUT.bandHeight * ui;
    const pxPerM = Math.min(w / LAYOUT.visibleWidthM, groundY / LAYOUT.visibleHeightM);
    // 一時的に描画領域が潰れたときは、目盛りの範囲を計算できない
    if (pxPerM <= 0) return;
    const originX = w * CAMERA.followX;
    const camX = camera.centerM(state.poses.torso.x, w, pxPerM, performance.now());
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
    const goalLabel = rulerLabel("goal", `ゴール ${GOAL_M}m`, 36, COLORS.text, true);
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
    hud.position.set(SCREEN_LAYOUT.safeX * ui, SCREEN_LAYOUT.safeY * ui);
    distanceText.text = `${formatDistance(state.distanceM)} m`;
    timeText.text = `${formatTime(state.elapsedMs)} 秒`;
    legend.scale.set(ui);
    legend.position.set(w - 24 * ui - 150 * ui, 16 * ui);
  }

  return {
    setScene,
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
