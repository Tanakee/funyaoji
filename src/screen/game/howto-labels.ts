import { Container, Graphics, type Text } from "pixi.js";
import { JOINT_DISPLAY, SEATS } from "../../shared/joints.ts";
import type { Joint } from "../../shared/messages.ts";
import type { SeatView } from "./types.ts";

const HEIGHT = 36;
const PADDING = 12;
const PART_GAP = 40;
const LABEL_GAP = 6;
export const NAME_HOLD_SEC = 1.5;
export const NAME_FADE_SEC = 0.3;

type Point = { x: number; y: number };
type Palette = { seatOutline: number; seatPaper: number };
type MakeText = (text: string, color: number) => Text;

/** 最後に光り方が1だったフレームから、名前を出す時間を数える */
export function nameLabelFrame(remainingSec: number, glow: number, dtSec: number) {
  const remaining = glow === 1 ? NAME_HOLD_SEC + NAME_FADE_SEC : Math.max(0, remainingSec - dtSec);
  return { remainingSec: remaining, alpha: Math.min(1, remaining / NAME_FADE_SEC) };
}

export function labelPositions(joint: Joint, part: Point, nameWidth: number, okWidth: number) {
  const side = joint === "leftHip" || joint === "leftKnee" ? -1 : 1;
  const edge = part.x + side * PART_GAP;
  return {
    nameX: edge + side * (nameWidth / 2),
    okX: edge + side * ((nameWidth > 0 ? nameWidth + LABEL_GAP : 0) + okWidth / 2),
    y: part.y,
  };
}

function luminance(color: number): number {
  const channel = (shift: number) => {
    const value = ((color >> shift) & 0xff) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

export function nameTextColor(color: number, { seatOutline, seatPaper }: Palette): number {
  const base = luminance(color);
  const contrast = (text: number) => {
    const light = luminance(text);
    return (Math.max(light, base) + 0.05) / (Math.min(light, base) + 0.05);
  };
  return contrast(seatOutline) >= contrast(seatPaper) ? seatOutline : seatPaper;
}

function createLabel(makeText: () => Text, draw: (shape: Graphics, width: number) => void) {
  const node = new Container();
  const shape = new Graphics();
  let text = makeText();
  let width = 0;
  node.addChild(shape, text);
  node.visible = false;
  const redraw = () => {
    width = Math.ceil(text.width) + 2 * PADDING;
    text.anchor.set(0.5);
    draw(shape.clear(), width);
  };
  redraw();
  return {
    node,
    get visibleWidth() {
      return node.visible ? width : 0;
    },
    rebuildText() {
      text.destroy();
      text = makeText();
      node.addChild(text);
      redraw();
    },
  };
}

export function createHowtoLabels(parent: Container, palette: Palette, makeText: MakeText) {
  const { seatOutline, seatPaper } = palette;
  const layer = new Container();
  parent.addChild(layer);
  const labels = new Map(
    SEATS.map((joint) => {
      const { name, color: hex } = JOINT_DISPLAY[joint];
      const color = Number.parseInt(hex.slice(1), 16);
      const nameColor = nameTextColor(color, palette);
      const nameLabel = createLabel(
        () => makeText(name, nameColor),
        (shape, width) =>
          shape
            .roundRect(-width / 2, -HEIGHT / 2, width, HEIGHT, HEIGHT / 2)
            .fill(color)
            .stroke({ width: 2, color: seatOutline }),
      );
      const okLabel = createLabel(
        () => makeText("OK!", seatOutline),
        (shape, width) =>
          shape
            .roundRect(-width / 2, -HEIGHT / 2, width, HEIGHT, HEIGHT / 2)
            .fill(seatPaper)
            .stroke({ width: 5, color: seatOutline })
            .roundRect(-width / 2, -HEIGHT / 2, width, HEIGHT, HEIGHT / 2)
            .stroke({ width: 3, color }),
      );
      const row = new Container();
      row.addChild(nameLabel.node, okLabel.node);
      layer.addChild(row);
      return [joint, { row, nameLabel, okLabel, remainingSec: 0 }];
    }),
  );

  function separate(hip: Joint, knee: Joint): void {
    const upper = labels.get(hip);
    const lower = labels.get(knee);
    if (!upper?.row.visible || !lower?.row.visible) return;
    // 脚を深く曲げて札が重なるときだけ、ひざの札を下へずらす
    const gap = HEIGHT + LABEL_GAP;
    const dy = lower.row.y - upper.row.y;
    if (Math.abs(dy) >= gap) return;
    const overlaps = [upper.nameLabel, upper.okLabel].some((a) =>
      [lower.nameLabel, lower.okLabel].some(
        (b) =>
          a.node.visible &&
          b.node.visible &&
          Math.abs(a.node.x - b.node.x) < (a.visibleWidth + b.visibleWidth) / 2 + LABEL_GAP,
      ),
    );
    if (overlaps) lower.row.y = upper.row.y + gap;
  }

  return {
    update(joint: Joint, seat: SeatView | undefined, part: Point, glow: number, dtSec: number) {
      const entry = labels.get(joint);
      if (!entry) return;
      const { row, nameLabel, okLabel } = entry;
      const frame =
        seat?.moveName && seat.state.kind === "joined"
          ? nameLabelFrame(entry.remainingSec, glow, dtSec)
          : { remainingSec: 0, alpha: 0 };
      entry.remainingSec = frame.remainingSec;
      nameLabel.node.alpha = frame.alpha;
      nameLabel.node.visible = frame.alpha > 0;
      okLabel.node.visible = seat?.ready === true;
      row.visible = nameLabel.node.visible || okLabel.node.visible;
      if (!row.visible) return;
      const positions = labelPositions(joint, part, nameLabel.visibleWidth, okLabel.visibleWidth);
      nameLabel.node.x = positions.nameX;
      okLabel.node.x = positions.okX;
      row.y = positions.y;
    },
    finishFrame() {
      separate("leftHip", "leftKnee");
      separate("rightHip", "rightKnee");
    },
    rebuildTexts() {
      for (const { nameLabel, okLabel } of labels.values()) {
        nameLabel.rebuildText();
        okLabel.rebuildText();
      }
    },
    destroy() {
      layer.destroy({ children: true });
    },
  };
}
