import { useEffect, useLayoutEffect, useRef } from "react";
import { latestAngle } from "./tilt.ts";

/**
 * 毎フレーム、いまの傾きが変わっていれば draw を呼ぶ。傾きは毎秒30回以上変わるので、
 * React の state を通さず、draw の中で DOM を直接書き換える。角度が読めていなければ undefined
 */
export function useTiltFrame(draw: (angle: number | undefined) => void): void {
  const drawRef = useRef(draw);
  useLayoutEffect(() => {
    drawRef.current = draw;
  });

  useEffect(() => {
    let frame = 0;
    /** 最後に描いた角度。null は、まだ1回も描いていない */
    let drawn: number | undefined | null = null;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const angle = latestAngle();
      if (angle === drawn) return;
      drawn = angle;
      drawRef.current(angle);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);
}
