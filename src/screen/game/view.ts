// PixiJS の描画。SimState と関節の入力を読んで描くだけで、物理にも Rapier にも触れない
import {
  Application,
  BitmapFont,
  BitmapText,
  CanvasTextMetrics,
  Container,
  Graphics,
  Sprite,
  Text,
  type ColorSource,
} from "pixi.js";
import { JOINT_DISPLAY, SEATS } from "../../shared/joints.ts";
import { loadUncleArt, type LoadedImage } from "./art-load.ts";
import { imageTransform, type ArtSlot, type Expression, type UncleArt } from "./art.ts";
import { BACKDROP_COLORS, createBackdrop } from "./backdrop.ts";
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
import { CAMERA, Camera, type Scene } from "./camera.ts";
import { SCREEN_LAYOUT, screenScale } from "./layout.ts";
import { GOAL_M, type SimState } from "./sim.ts";
import { mixRgb, quadraticBezierPoint, stringLook, TiltGlow, type StringLook } from "./strings.ts";
import type { JointInputs, Seats, SeatState } from "./types.ts";

/** 色の決まりは docs/screens.md の「色・フォント・刷り」。部位ごとの色は shared/joints.ts */
const COLORS = {
  sky: 0xf6f1e7,
  tick: 0x1f3a68,
  text: 0x1f3a68,
  outline: 0x1f3a68,
  start: 0x1f3a68,
  goal: 0xa8282e,
  goalLabelBackground: 0xfbf8f0,
  torso: 0xc2a682,
  head: 0xf2cfae,
  foot: 0xf4efe3,
  face: 0x1f3a68,
  emptyLimb: 0xa2a7ad,
  seatOutline: 0x1f3a68,
  emptySeatOutline: 0x3f5275,
  seatPaper: 0xfbf8f0,
  seatText: 0x3f5275,
};

const SEAT_OFFSETS = [-238, -174, -10, 54];
const TAG_BOTTOM = 34;
const LABEL_LINE = 28;

// 左の脚を奥に、右の脚を手前に描く
const DRAW_ORDER: PartName[] = ["leftThigh", "leftShin", "torso", "rightThigh", "rightShin"];
const PART_ART_SLOTS: Record<PartName, Exclude<ArtSlot, "head">> = {
  torso: "torso",
  leftThigh: "thigh",
  rightThigh: "thigh",
  leftShin: "shin",
  rightShin: "shin",
};

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
  /** 画面に合わせて、カメラと、距離・タイムを出すかを変える */
  setScene(scene: Scene): void;
  /** 描画のたびに呼ばれる。dtSec は前のフレームからの実時間 */
  onFrame(callback: (dtSec: number) => void): void;
  setSeats(seats: Seats): void;
  setExpression(expression: Expression): void;
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
    if (shape.tag === "head") continue;
    const color = shape.tag === "foot" ? COLORS.foot : name === "torso" ? COLORS.torso : limbColor;
    drawShape(g, shape).fill(color).stroke({ width: 1.4, color: COLORS.outline });
  }
}

function drawHead(g: Graphics): void {
  for (const shape of PART_SHAPES.torso) {
    if (shape.tag === "head") {
      drawShape(g, shape).fill(COLORS.head).stroke({ width: 1.4, color: COLORS.outline });
    }
  }
  // 顔。進む向き（右）を向いている
  const headY = (TORSO_SIZE.hh + TORSO_SIZE.headR) * CM;
  g.circle(5, headY + 3, 1.6).fill(COLORS.face);
  g.moveTo(9, headY - 1)
    .lineTo(14, headY - 4)
    .lineTo(9, headY - 6)
    .stroke({ width: 1.4, color: COLORS.face });
}

function placeImage(sprite: Sprite, { image, texture }: LoadedImage, slot: ArtSlot): void {
  const t = imageTransform(image, texture, slot);
  sprite.anchor.set(t.anchorX, t.anchorY);
  sprite.position.set(t.x, t.y);
  sprite.scale.set(t.scaleX, t.scaleY);
  sprite.rotation = t.rotation;
}

function createPartNode(image: LoadedImage | undefined, slot: ArtSlot): Graphics | Sprite {
  if (image) {
    const sprite = new Sprite(image.texture);
    placeImage(sprite, image, slot);
    return sprite;
  }
  const graphics = new Graphics();
  graphics.scale.set(1 / CM);
  return graphics;
}

function paintPart(node: Graphics | Sprite, name: PartName, color = COLORS.emptyLimb): void {
  if (node instanceof Graphics) drawPart(node, name, color);
  else if (name !== "torso") node.tint = color;
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

export async function createView(container: HTMLElement, art: UncleArt = {}): Promise<View> {
  const loaded = await loadUncleArt(art);
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

  const backdrop = createBackdrop(app.renderer);
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
  const parts = {} as Record<PartName, { node: Container; body: Graphics | Sprite }>;
  for (const name of DRAW_ORDER) {
    const node = new Container();
    const slot = PART_ART_SLOTS[name];
    const body = createPartNode(loaded[slot], slot);
    paintPart(body, name);
    node.position.set(INITIAL_POSES[name].x, INITIAL_POSES[name].y);
    node.addChild(body);
    parts[name] = { node, body };
    world.addChild(node);
  }
  const head = createPartNode(loaded.head?.normal, "head");
  if (head instanceof Graphics) drawHead(head);
  parts.torso.node.addChild(head);

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

  const seatLayer = new Container();
  const strings = new Container();
  const markers = new Container();
  const tags = new Container();
  seatLayer.addChild(strings, markers, tags);
  const tiltGlow = new TiltGlow();
  const seatCaption = (text: string) => {
    const caption = label(text, 20, COLORS.seatText, true);
    caption.anchor.set(0.5, 0);
    caption.visible = false;
    return caption;
  };
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
    world.addChildAt(partGlow, world.getChildIndex(parts[part].node));
    const line = new Graphics();
    const marker = new Graphics()
      .circle(0, 0, 14)
      .fill(COLORS.seatOutline)
      .circle(0, 0, 12)
      .fill(color)
      .stroke({ width: 3, color: COLORS.seatPaper });
    marker.visible = false;
    const tag = new Graphics();
    drawTag(tag);
    const captions = new Container();
    const nameText = seatCaption(name);
    const detail = seatCaption("");
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

  app.stage.addChild(backdrop.back, backdrop.ground, ruler, labelLayer, world, seatLayer, hud);

  let currentSeats: Seats | undefined;
  function setSeats(seats: Seats): void {
    currentSeats = seats;
    SEATS.forEach((joint, i) => {
      const { state, showName, key } = seats[joint];
      const graphics = seatGraphics[i];
      const occupied = state.kind !== "empty";
      if (occupied !== (graphics.state.kind !== "empty")) {
        const color = occupied ? graphics.color : undefined;
        const { part } = STRING_ANCHORS[joint];
        paintPart(parts[part].body, part, color);
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

  function rebuildTextsWithLoadedFont(): void {
    const loadedHudFont = hudFontName("loaded");
    distanceText.style.fontFamily = loadedHudFont;
    timeText.style.fontFamily = loadedHudFont;
    for (const label of rulerLabels.values()) label.destroy();
    rulerLabels.clear();
    SEATS.forEach((joint, i) => {
      const graphics = seatGraphics[i];
      graphics.nameText.destroy();
      graphics.detail.destroy();
      graphics.nameText = seatCaption(JOINT_DISPLAY[joint].name);
      graphics.detail = seatCaption("");
      graphics.captions.addChildAt(graphics.nameText, 0);
      graphics.captions.addChild(graphics.detail);
    });
    if (currentSeats) setSeats(currentSeats);
  }
  if (fontState === "timeout") {
    void fontsLoaded.then((loaded) => {
      if (loaded && !seatLayer.destroyed) rebuildTextsWithLoadedFont();
    });
  }

  const camera = new Camera();
  function setScene(scene: Scene): void {
    hud.visible = scene === "playing";
    backdrop.setBuntingVisible(scene === "countdown" || scene === "playing");
    camera.setScene(scene, performance.now());
  }
  setScene("lobby");

  function render(state: SimState, inputs: JointInputs, dtSec: number): void {
    const { width: w, height: h } = app.screen;
    const ui = screenScale(w, h);
    const groundY = h - SCREEN_LAYOUT.bandHeight * ui;
    const pxPerM = Math.min(w / LAYOUT.visibleWidthM, groundY / LAYOUT.visibleHeightM);
    // 一時的に描画領域が潰れたときは、目盛りの範囲を計算できない
    if (pxPerM <= 0) return;
    const originX = w * CAMERA.followX;
    const camX = camera.centerM(state.poses.torso.x, w, pxPerM, performance.now());
    const worldOriginX = originX - camX * pxPerM;
    const screenX = (m: number) => worldOriginX + m * pxPerM;
    backdrop.update({ width: w, height: h, ui, groundY, pxPerM, worldOriginX });

    world.position.set(worldOriginX, groundY);
    world.scale.set(pxPerM, -pxPerM);
    for (const name of PART_NAMES) {
      const pose = state.poses[name];
      parts[name].node.position.set(pose.x, pose.y);
      parts[name].node.rotation = pose.rot;
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

    ruler.clear();
    const first = Math.floor(-worldOriginX / pxPerM) - 1;
    const last = Math.ceil((w - worldOriginX) / pxPerM) + 1;
    for (const t of rulerLabels.values()) t.visible = false;
    for (let m = first; m <= last; m++) {
      const x = screenX(m);
      const major = m % 5 === 0;
      const num = rulerLabel(`m${m}`, `${m}`, 22, COLORS.tick, major);
      num.visible = true;
      num.scale.set(ui);
      num.position.set(x, groundY + 30 * ui);
      ruler
        .roundRect(
          x - num.width / 2 - 5 * ui,
          num.y - ui,
          num.width + 10 * ui,
          num.height + 2 * ui,
          4 * ui,
        )
        .fill(BACKDROP_COLORS.face);
    }

    const startX = screenX(0);
    const startLabel = rulerLabel("start", "スタート", 30, COLORS.start, true);
    startLabel.visible = true;
    startLabel.scale.set(ui);
    startLabel.position.set(startX, groundY - pxPerM * 2.6);

    const goalX = screenX(GOAL_M);
    const goalLabel = rulerLabel("goal", `ゴール ${GOAL_M}m`, 36, COLORS.text, true);
    goalLabel.visible = true;
    goalLabel.scale.set(ui);
    goalLabel.position.set(goalX, groundY - pxPerM * 2.6);
    const pad = 8 * ui;
    ruler
      .roundRect(
        goalX - goalLabel.width / 2 - pad,
        goalLabel.y - pad / 2,
        goalLabel.width + pad * 2,
        goalLabel.height + pad,
        8 * ui,
      )
      .fill(COLORS.goalLabelBackground)
      .stroke({ width: 3 * ui, color: COLORS.goal });

    hud.scale.set(ui);
    hud.position.set(SCREEN_LAYOUT.safeX * ui, SCREEN_LAYOUT.safeY * ui);
    distanceText.text = `${formatDistance(state.distanceM)} m`;
    timeText.text = `${formatTime(state.elapsedMs)} 秒`;
  }

  return {
    setScene,
    onFrame(callback) {
      app.ticker.add((ticker) => callback(ticker.deltaMS / 1000));
    },
    render,
    setSeats,
    setExpression(expression) {
      if (head instanceof Sprite && loaded.head) {
        const image = loaded.head[expression];
        head.texture = image.texture;
        placeImage(head, image, "head");
      }
    },
    destroy() {
      observer.disconnect();
      backdrop.destroy();
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
