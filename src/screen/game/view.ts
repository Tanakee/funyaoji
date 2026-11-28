// PixiJS の描画。SimState と関節の入力を読んで描くだけで、物理にも Rapier にも触れない
import {
  Application,
  BitmapFont,
  BitmapText,
  Container,
  Graphics,
  Text,
  type ColorSource,
} from "pixi.js";
import { JOINT_DISPLAY, SEATS } from "../../shared/joints.ts";
import {
  INITIAL_POSES,
  PART_NAMES,
  PART_SHAPES,
  STRING_ANCHORS,
  TORSO_SIZE,
  type PartName,
  type ShapeSpec,
} from "./body.ts";
import { formatDistance, formatTime } from "./format.ts";
import { GOAL_M, type SimState } from "./sim.ts";
import { mixRgb, quadraticBezierPoint, stringLook, TiltGlow, type StringLook } from "./strings.ts";
import type { JointInputs, Seats, SeatState } from "./types.ts";

/** 色はここに集める。見た目は、あとで人が決める。部位ごとの色は shared/joints.ts */
const COLORS = {
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
  emptyLimb: 0xa6a6a1,
  seatOutline: 0x2b2b28,
  emptySeatOutline: 0x6b6b67,
  seatPaper: 0xfafaf7,
  seatText: 0x4a4a47,
};

const SEAT_OFFSETS = [-238, -174, -10, 54];
const TAG_BOTTOM = 34;
const LABEL_LINE = 28;

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
  setSeats(seats: Seats): void;
  render(state: SimState, inputs: JointInputs, dtSec: number): void;
  destroy(): void;
}

/** 部位の形を描く。m のまま描くと曲線が粗くなるので、cm で描いて 0.01 倍にする */
const CM = 100;

function drawShape(g: Graphics, shape: ShapeSpec): Graphics {
  if (shape.kind === "box") {
    return g.roundRect(
      (shape.ox - shape.hw) * CM,
      (shape.oy - shape.hh) * CM,
      shape.hw * 2 * CM,
      shape.hh * 2 * CM,
      Math.min(shape.hw, shape.hh) * 0.5 * CM,
    );
  }
  return g.circle(shape.ox * CM, shape.oy * CM, shape.r * CM);
}

function drawPart(g: Graphics, name: PartName, limbColor: ColorSource = COLORS.emptyLimb): void {
  g.clear();
  for (const shape of PART_SHAPES[name]) {
    const color =
      shape.tag === "foot"
        ? COLORS.foot
        : shape.tag === "head"
          ? COLORS.head
          : name === "torso"
            ? COLORS.torso
            : limbColor;
    drawShape(g, shape).fill(color).stroke({ width: 1.4, color: COLORS.outline });
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
}

function label(text: string, size: number, color: ColorSource, bold = false): Text {
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

function drawTag(tag: Graphics, color?: ColorSource): void {
  tag
    .clear()
    .roundRect(-20, -14, 40, 48, 10)
    .fill(color ?? COLORS.seatPaper);
  if (color !== undefined) {
    tag.stroke({ width: 2.5, color: COLORS.seatOutline });
    return;
  }

  // 画面内に見える輪郭を左から右へたどり、5px 描いて 4px 空ける
  const side = 28;
  const corner = (10 * Math.PI) / 2;
  const bottom = 20;
  const length = 2 * (side + corner) + bottom;
  const pointAt = (d: number): [number, number] => {
    if (d < side) return [-20, 24 - side + d];
    d -= side;
    if (d < corner) return [-10 - 10 * Math.cos(d / 10), 24 + 10 * Math.sin(d / 10)];
    d -= corner;
    if (d < bottom) return [-10 + d, TAG_BOTTOM];
    d -= bottom;
    if (d < corner) return [10 + 10 * Math.sin(d / 10), 24 + 10 * Math.cos(d / 10)];
    return [20, 24 - (d - corner)];
  };
  for (let start = 0; start < length; start += 9) {
    const end = Math.min(start + 5, length);
    tag.moveTo(...pointAt(start)).lineTo(...pointAt(end));
  }
  tag.stroke({ width: 2.5, color: COLORS.emptySeatOutline });
}

function drawString(
  line: Graphics,
  cx: number,
  x: number,
  y: number,
  color: number,
  glowColor: number,
  look: StringLook,
  glow: number,
): void {
  const control = {
    x: (cx + x) / 2 + look.slack * (x < cx ? 84 : -84),
    y: (TAG_BOTTOM + y) / 2 + look.slack * 68,
  };
  const stroke = (width: number, color: number, alpha: number) => {
    line.moveTo(cx, TAG_BOTTOM).quadraticCurveTo(control.x, control.y, x, y).stroke({
      width,
      color,
      alpha,
      cap: "round",
    });
  };
  const glowAlpha = 0.55 * glow;
  if (glow > 0) stroke(look.coreWidth + 10, glowColor, glowAlpha);
  stroke(look.outlineWidth, COLORS.seatOutline, look.alpha);
  stroke(look.coreWidth, mixRgb(color, COLORS.sky, look.skyBlend), look.alpha);

  const knot = quadraticBezierPoint({ x: cx, y: TAG_BOTTOM }, control, { x, y }, look.knotPosition);
  if (glow > 0) {
    line.circle(knot.x, knot.y, look.knotRadius + 6).fill({ color: glowColor, alpha: glowAlpha });
  }
  line
    .circle(knot.x, knot.y, look.knotRadius)
    .fill({ color, alpha: look.alpha })
    .stroke({ width: 2, color: COLORS.seatOutline, alpha: look.alpha });
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

  // 重なりの順：ルーラー（地面と目盛り）→ おじさん → 糸と札 → HUD
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
    const g = new Graphics();
    g.scale.set(1 / CM);
    drawPart(g, name);
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

  const seatLayer = new Container();
  const strings = new Container();
  const markers = new Container();
  const tags = new Container();
  seatLayer.addChild(strings, markers, tags);
  const tiltGlow = new TiltGlow();
  const seatGraphics = SEATS.map((joint) => {
    const { color: hexColor, name } = JOINT_DISPLAY[joint];
    const color = Number.parseInt(hexColor.slice(1), 16);
    const glowColor = mixRgb(color, 0xffffff, 0.5);
    const { part } = STRING_ANCHORS[joint];
    const partGlow = new Graphics();
    partGlow.scale.set(1 / CM);
    partGlow.visible = false;
    for (const shape of PART_SHAPES[part]) {
      if (shape.tag === "limb") drawShape(partGlow, shape).stroke({ width: 12, color: glowColor });
    }
    world.addChildAt(partGlow, world.getChildIndex(partGraphics[part]));
    const line = new Graphics();
    const marker = new Graphics()
      .circle(0, 0, 14)
      .fill(COLORS.seatOutline)
      .circle(0, 0, 12)
      .fill(color)
      .stroke({ width: 3, color: 0xffffff });
    marker.visible = false;
    const tag = new Graphics();
    drawTag(tag);
    const captions = new Container();
    const nameText = label(name, 20, COLORS.seatText, true);
    const detail = label("", 20, COLORS.seatText, true);
    for (const text of [nameText, detail]) {
      text.anchor.set(0.5, 0);
      text.visible = false;
    }
    const keyBox = new Graphics()
      .roundRect(-15, -2, 30, LABEL_LINE, 5)
      .fill(COLORS.seatPaper)
      .stroke({ width: 1, color: COLORS.emptySeatOutline });
    keyBox.visible = false;
    captions.addChild(nameText, keyBox, detail);
    strings.addChild(line);
    markers.addChild(marker);
    tags.addChild(tag, captions);
    const state = { kind: "empty" } as SeatState;
    return {
      line,
      marker,
      tag,
      captions,
      nameText,
      detail,
      keyBox,
      state,
      color,
      glowColor,
      partGlow,
    };
  });

  app.stage.addChild(ruler, labelLayer, world, seatLayer, hud);

  function setSeats(seats: Seats): void {
    SEATS.forEach((joint, i) => {
      const { state, showName, key } = seats[joint];
      const graphics = seatGraphics[i];
      const occupied = state.kind !== "empty";
      if (occupied !== (graphics.state.kind !== "empty")) {
        const color = occupied ? graphics.color : undefined;
        const { part } = STRING_ANCHORS[joint];
        drawPart(partGraphics[part], part, color);
        drawTag(graphics.tag, color);
      }
      graphics.state = state;
      const idle = state.kind === "joined" && !state.active;
      graphics.tag.alpha = idle ? 0.4 : 1;
      graphics.line.alpha = state.kind === "reserved" ? 0.5 : graphics.tag.alpha;
      graphics.marker.alpha = graphics.line.alpha;
      graphics.marker.visible = occupied;

      const detail = state.kind === "reserved" ? `あと${state.remainingSec}秒` : (key ?? "");
      graphics.nameText.visible = showName;
      graphics.detail.visible = detail !== "";
      if (graphics.detail.text !== detail) graphics.detail.text = detail;
      // 隣の席のラベルを1行挟み、同じ席の2行目が重ならないようにする
      graphics.detail.y = showName ? 2 * LABEL_LINE : 0;
      graphics.keyBox.y = graphics.detail.y;
      graphics.keyBox.visible = key !== undefined;
    });
  }

  function render(state: SimState, inputs: JointInputs, dtSec: number): void {
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

    seatLayer.scale.set(ui);
    seatLayer.x = w / 2;
    SEATS.forEach((joint, i) => {
      const {
        state: seat,
        line,
        marker,
        tag,
        captions,
        color,
        glowColor,
        partGlow,
      } = seatGraphics[i];
      const cx = SEAT_OFFSETS[i];
      tag.x = cx;
      captions.position.set(cx, TAG_BOTTOM + 6 + (i % 2) * LABEL_LINE);
      line.clear();

      const anchor = STRING_ANCHORS[joint];
      const pose = state.poses[anchor.part];
      const input = seat.kind === "joined" ? inputs[joint] : undefined;
      const glow = tiltGlow.update(joint, input, dtSec);
      partGlow.position.set(pose.x, pose.y);
      partGlow.rotation = pose.rot;
      partGlow.visible = glow > 0;
      partGlow.alpha = glow * line.alpha;

      if (seat.kind === "empty") return;
      const cos = Math.cos(pose.rot);
      const sin = Math.sin(pose.rot);
      const wx = pose.x + anchor.x * cos - anchor.y * sin;
      const wy = pose.y + anchor.x * sin + anchor.y * cos;
      const x = (screenX(wx) - seatLayer.x) / ui;
      const y = (groundY - wy * pxPerM) / ui;
      drawString(line, cx, x, y, color, glowColor, stringLook(input ?? 0), glow);
      marker.position.set(x, y);
    });

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
  }

  return {
    onFrame(callback) {
      app.ticker.add((ticker) => callback(ticker.deltaMS / 1000));
    },
    render,
    setSeats,
    destroy() {
      observer.disconnect();
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
