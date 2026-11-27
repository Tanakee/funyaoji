import { useEffect, useRef } from "react";
import { latestAngle, MAX_ANGLE } from "./tilt.ts";

/**
 * いまの傾き（0〜90度を 0〜100%）。tilt は毎秒30回以上届くので、React の state は使わず、
 * 毎フレーム DOM を直接書き換える
 */
export function Gauge() {
  const root = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const percent = useRef<HTMLSpanElement>(null);
  const degrees = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame = 0;
    /** 最後に書いた角度。null は、まだ何も書いていない */
    let drawn: number | undefined | null = null;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const angle = latestAngle();
      if (angle === drawn) return;
      drawn = angle;
      const ratio = angle === undefined ? 0 : angle / MAX_ANGLE;
      root.current!.dataset.empty = String(angle === undefined);
      fill.current!.style.transform = `scaleX(${ratio})`;
      percent.current!.textContent = angle === undefined ? "--" : String(Math.round(ratio * 100));
      degrees.current!.textContent = angle === undefined ? "--" : String(Math.round(angle));
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="gauge" ref={root} data-empty="true">
      <div className="gauge-readout">
        <span className="gauge-percent">
          <span ref={percent}>--</span>%
        </span>
        <span className="gauge-degrees">
          <span ref={degrees}>--</span>°
        </span>
      </div>
      <div className="gauge-track">
        <div className="gauge-fill" ref={fill} />
      </div>
      <div className="gauge-scale">
        <span>寝かせる 0°</span>
        <span>立てる 90°</span>
      </div>
      <p className="gauge-empty">傾きが読み取れていません</p>
    </div>
  );
}
