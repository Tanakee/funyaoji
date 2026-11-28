import { useRef } from "react";
import type { InputMethod } from "../shared/messages.ts";
import { MAX_ANGLE } from "./tilt.ts";
import { useTiltFrame } from "./useTiltFrame.ts";

/** いまの傾き（カメラなら指の曲げ）のバー。スクリーンの返事を待たずに動かす。色は親の --joint */
export function Gauge({ input }: { input: InputMethod }) {
  const camera = input === "camera";
  const root = useRef<HTMLDivElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const drawnPercent = useRef(0);

  useTiltFrame((angle) => {
    root.current!.toggleAttribute("data-empty", angle === undefined);
    const ratio = (angle ?? 0) / MAX_ANGLE;
    fill.current!.style.transform = `scaleX(${ratio})`;
    const percent = Math.round(ratio * 100);
    if (percent !== drawnPercent.current) {
      meter.current!.setAttribute("aria-valuenow", String(percent));
      drawnPercent.current = percent;
    }
  });

  return (
    <div className="gauge" ref={root} data-empty="">
      <div className="gauge-scale">
        <span>{camera ? "伸ばす" : "寝かせる"}</span>
        <span>{camera ? "曲げる" : "立てる"}</span>
      </div>
      <div
        className="gauge-track"
        ref={meter}
        role="meter"
        aria-label={camera ? "いまの指の曲げ" : "いまの傾き"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
      >
        <div className="gauge-fill" ref={fill} />
      </div>
      <p className="gauge-empty">
        {camera ? "指が読み取れていません" : "傾きが読み取れていません"}
      </p>
    </div>
  );
}
