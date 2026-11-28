import { expect, it } from "vite-plus/test";
import { NEUTRAL_INPUTS } from "./body.ts";
import { UncleExpression } from "./expression.ts";

const strong = { leftHip: 0.05, rightHip: 0.55, leftKnee: 0.4, rightKnee: 0.5 };

it("4つの関節の中立からの離れの合計が1.4以上になると力む", () => {
  const face = new UncleExpression();
  expect(face.update({ ...strong, rightKnee: 0.49 }, 0)).toBe("normal");
  expect(face.update(strong, 16)).toBe("strain");
});

it("しきい値を下回ってから0.5秒は力んだ顔を保つ", () => {
  const face = new UncleExpression();
  expect(face.update(strong, 0)).toBe("strain");
  expect(face.update(NEUTRAL_INPUTS, 100)).toBe("strain");
  expect(face.update(NEUTRAL_INPUTS, 599)).toBe("strain");
  expect(face.update(strong, 600)).toBe("strain");
  expect(face.update(NEUTRAL_INPUTS, 700)).toBe("strain");
  expect(face.update(NEUTRAL_INPUTS, 1199)).toBe("strain");
  expect(face.update(NEUTRAL_INPUTS, 1200)).toBe("normal");
});

it("転倒とゴールの結果は力んだ顔より優先する", () => {
  const face = new UncleExpression();
  expect(face.update(strong, 0)).toBe("strain");
  expect(face.update(NEUTRAL_INPUTS, 100, "fell")).toBe("fell");
  expect(face.update(strong, 200, "goal")).toBe("goal");
});
