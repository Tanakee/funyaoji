import { Container, Graphics, GraphicsPath, Text } from "pixi.js";
import { BACKDROP_COLORS } from "./backdrop.ts";
import { SCREEN_LAYOUT } from "./layout.ts";
import { placeBubble, SPEECH, type BubbleStyle } from "./speech.ts";

export const DISPLAY_FONT_FAMILY = "'Zen Old Mincho', 'Hiragino Mincho ProN', 'Yu Mincho', serif";

type Point = { x: number; y: number };
type BubbleFrame = {
  headX: number;
  headY: number;
  headRadius: number;
  width: number;
  height: number;
  ui: number;
  nowMs: number;
};

function tagPath(w: number, h: number, tip: Point): GraphicsPath {
  const { radius, tailHalfWidth: half } = SPEECH.tag;
  const corners: (Point & { radius?: number })[] = [
    { x: 0, y: 0, radius },
    { x: w, y: 0, radius },
    { x: w, y: h, radius },
    { x: 0, y: h, radius },
  ];
  const tailCenter = (at: number, length: number) =>
    Math.max(radius + half, Math.min(at, length - radius - half));
  // 頭が札の斜め下にあるときは下の辺を優先する。上端で札が下にずれたら横か上の辺から出す
  if (tip.y > h) {
    const x = tailCenter(tip.x, w);
    corners.splice(3, 0, { x: x + half, y: h }, tip, { x: x - half, y: h });
  } else if (tip.x < 0 || tip.x > w) {
    const right = tip.x > w;
    const x = right ? w : 0;
    const y = tailCenter(tip.y, h);
    const direction = right ? 1 : -1;
    corners.splice(right ? 2 : 4, 0, { x, y: y - half * direction }, tip, {
      x,
      y: y + half * direction,
    });
  } else if (tip.y < 0) {
    const x = tailCenter(tip.x, w);
    corners.splice(1, 0, { x: x - half, y: 0 }, tip, { x: x + half, y: 0 });
  }
  return new GraphicsPath().roundShape(corners, 0, true);
}

function roundPath(style: "b" | "c", w: number, h: number, tip: Point): GraphicsPath {
  const rx = w / 2;
  const ry = h / 2;
  const dx = (tip.x - rx) / rx;
  const dy = (tip.y - ry) / ry;
  const angle = Math.atan2(dy, dx);
  const hasTail = Math.hypot(dx, dy) > 1;
  const pointAt = (a: number, radius = 1): Point => ({
    x: rx * (1 + Math.cos(a) * radius),
    y: ry * (1 + Math.sin(a) * radius),
  });
  const path = new GraphicsPath();
  if (style === "c") {
    const { points, innerRatio } = SPEECH.burst;
    const outline = Array.from({ length: points }, (_, i) =>
      pointAt(angle + (i * 2 * Math.PI) / points, i % 2 === 0 ? 1 : innerRatio),
    );
    if (hasTail) outline[0] = tip;
    return path.poly(outline, true);
  }
  if (!hasTail) return path.ellipse(rx, ry, rx, ry);

  const start = pointAt(angle - SPEECH.ellipseTailHalfAngle);
  const end = pointAt(angle + SPEECH.ellipseTailHalfAngle);
  const center = pointAt(angle);
  return path
    .moveTo(end.x, end.y)
    .arcToSvg(rx, ry, 0, 1, 1, start.x, start.y)
    .quadraticCurveTo(center.x, center.y, tip.x, tip.y)
    .quadraticCurveTo(center.x, center.y, end.x, end.y)
    .closePath();
}

export function createSpeechBubble(style: BubbleStyle) {
  const container = new Container({ visible: false, eventMode: "none" });
  const face = new Graphics();
  const shadow = style === "a" ? new Graphics() : undefined;
  if (shadow) {
    shadow.position.set(SPEECH.shadow.offset);
    container.addChild(shadow);
  }
  container.addChild(face);

  let label: Text | undefined;
  let startedAt = 0;
  let bubbleWidth = 0;
  let bubbleHeight = 0;
  let lastTip: Point | undefined;

  function say(text: string | undefined, nowMs: number): void {
    label?.destroy({ style: true });
    label = undefined;
    lastTip = undefined;
    container.visible = false;
    if (text === undefined) return;

    startedAt = nowMs;
    label = new Text({
      text,
      anchor: 0.5,
      resolution: SCREEN_LAYOUT.scaleRange[1] * (window.devicePixelRatio || 1),
      style: {
        fontFamily: DISPLAY_FONT_FAMILY,
        fontSize: SPEECH.fontSize,
        fontWeight: "900",
        fill: BACKDROP_COLORS.ink,
        align: "center",
        lineHeight: SPEECH.fontSize * SPEECH.lineHeightRatio,
      },
    });
    // 文字の箱が楕円に内接するよう √2 倍し、叫びは輪郭の谷より内側に収まるようさらに広げる
    const { points, innerRatio } = SPEECH.burst;
    const ellipseFit = style === "a" ? 1 : Math.SQRT2;
    const burstFit = style === "c" ? 1 / (innerRatio * Math.cos(Math.PI / points)) : 1;
    bubbleWidth = (label.width + SPEECH.padding.x * 2) * ellipseFit * burstFit;
    bubbleHeight = (label.height + SPEECH.padding.y * 2) * ellipseFit * burstFit;
    label.position.set(bubbleWidth / 2, bubbleHeight / 2);
    container.addChild(label);
  }

  function update({ headX, headY, headRadius, width, height, ui, nowMs }: BubbleFrame): void {
    if (!label) return;
    const elapsed = nowMs - startedAt;
    if (SPEECH.durationMs !== null && elapsed >= SPEECH.durationMs) {
      say(undefined, nowMs);
      return;
    }
    // 縁取りと版ズレも画面の余白や地面の帯にはみ出さないようにする
    const extra = (SPEECH.strokeWidth / 2 + (shadow ? SPEECH.shadow.offset : 0)) * ui;
    const { x, y, tailTip, fit } = placeBubble({
      headX,
      headY,
      headRadius,
      bubbleWidth: bubbleWidth * ui,
      bubbleHeight: bubbleHeight * ui,
      width,
      height,
      insets: {
        left: SCREEN_LAYOUT.safeX * ui + extra,
        right: SCREEN_LAYOUT.safeX * ui + extra,
        top: SCREEN_LAYOUT.safeY * ui + extra,
        bottom: SCREEN_LAYOUT.bandHeight * ui + extra,
      },
      side: SPEECH.side,
    });
    container.visible = fit > 0;
    if (!container.visible) return;
    const scale = ui * fit;
    const tip = { x: (tailTip.x - x) / scale, y: (tailTip.y - y) / scale };
    if (lastTip?.x !== tip.x || lastTip.y !== tip.y) {
      const path =
        style === "a"
          ? tagPath(bubbleWidth, bubbleHeight, tip)
          : roundPath(style, bubbleWidth, bubbleHeight, tip);
      face.clear().path(path).fill(BACKDROP_COLORS.face).stroke({
        width: SPEECH.strokeWidth,
        color: BACKDROP_COLORS.ink,
        join: "round",
      });
      shadow?.clear().path(path).fill({ color: BACKDROP_COLORS.ink, alpha: SPEECH.shadow.alpha });
      lastTip = tip;
    }

    const progress = Math.min(1, Math.max(0, elapsed / SPEECH.popMs));
    const pop = 1 - (1 - SPEECH.popStartScale) * (1 - progress) ** 3;
    container.pivot.set(tip.x, tip.y);
    container.position.set(tailTip.x, tailTip.y);
    container.scale.set(scale * pop);
  }

  return {
    container,
    get text() {
      return container.visible ? label?.text : undefined;
    },
    say,
    update,
    destroy() {
      say(undefined, 0);
      container.destroy({ children: true, context: true });
    },
  };
}
