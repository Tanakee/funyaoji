import { describe, expect, it } from "vite-plus/test";
import { imagePointInPart, type ArtSlot, type PartImage } from "./art.ts";
import { PART_SHAPES, type Pose, type ShapeSpec } from "./body.ts";
import { PLACEHOLDER_ART } from "./uncle-art/placeholder/placeholder.ts";

function bounds(shapes: ShapeSpec[]) {
  const extent = (shape: ShapeSpec) =>
    shape.kind === "box" ? { x: shape.hw, y: shape.hh } : { x: shape.r, y: shape.r };
  return {
    left: Math.min(...shapes.map((s) => s.ox - extent(s).x)),
    right: Math.max(...shapes.map((s) => s.ox + extent(s).x)),
    top: Math.max(...shapes.map((s) => s.oy + extent(s).y)),
    bottom: Math.min(...shapes.map((s) => s.oy - extent(s).y)),
  };
}

function toWorld({ x, y }: { x: number; y: number }, pose: Pose) {
  return {
    x: pose.x + x * Math.cos(pose.rot) - y * Math.sin(pose.rot),
    y: pose.y + x * Math.sin(pose.rot) + y * Math.cos(pose.rot),
  };
}

const pose = { x: 2.3, y: 1.4, rot: -0.73 };
const corners = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const;

function expectCorners(
  image: PartImage | undefined,
  slot: ArtSlot,
  width: number,
  height: number,
  expectedCorners: { x: number; y: number }[],
) {
  if (!image) throw new Error(`Missing test image for ${slot}`);
  corners.forEach(([u, v], i) => {
    const actual = toWorld(imagePointInPart(image, { width, height }, slot, u, v), pose);
    const expected = toWorld(expectedCorners[i], pose);
    expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(1e-9);
  });
}

describe("部位画像と物理形状の位置合わせ", () => {
  const { thigh, shin, torso, head } = PLACEHOLDER_ART;
  const bodyShapes = PART_SHAPES.torso.filter((s) => s.tag === "torso");
  const headShapes = PART_SHAPES.torso.filter((s) => s.tag === "head");
  it.each([
    { slot: "thigh", image: thigh, width: 70, height: 241, shapes: PART_SHAPES.rightThigh },
    { slot: "shin", image: shin, width: 220, height: 234, shapes: PART_SHAPES.rightShin },
    { slot: "torso", image: torso, width: 240, height: 373, shapes: bodyShapes },
    { slot: "head", image: head?.normal, width: 120, height: 120, shapes: headShapes },
    { slot: "head", image: head?.fell, width: 120, height: 120, shapes: headShapes },
  ] as const)("$slot の画像の四隅が物理形状の外接矩形と重なる", (test) => {
    const { left, right, top, bottom } = bounds(test.shapes);
    expectCorners(test.image, test.slot, test.width, test.height, [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ]);
  });

  it("画像の回転と基準点を指定しても、ももの四隅を合わせられる", () => {
    const { left, right, top, bottom } = bounds(PART_SHAPES.rightThigh);
    const image: PartImage = {
      src: "thigh.png",
      width: top - bottom,
      height: right - left,
      rotation: Math.PI / 2,
      anchor: { x: 0, y: 1 },
      at: { x: right, y: bottom },
    };
    expectCorners(image, "thigh", 100, 100, [
      { x: left, y: bottom },
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
    ]);
  });
});
