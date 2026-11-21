"use client";

import { useEffect, useRef } from "react";

import type { StudioEngine } from "@/state/types";

import { tickToX } from "./geometry";

interface PlayheadProps {
  engine: Pick<StudioEngine, "currentTick">;
  playing: boolean;
  lengthTicks: number;
}

/**
 * 재생 위치 세로선. 노트·클립과 분리된 레이어라 프레임마다 DOM `transform`만 쓰고
 * 리렌더를 일으키지 않는다(`useState` 없음). `transform`을 `style` prop으로 두지
 * 않는다 — React가 소유한 값을 rAF가 덮으면 정지 때 되돌리는 쓰기를 React가
 * 같다고 보고 건너뛴다. 모든 쓰기는 이 effect가 한다.
 */
export function Playhead({ engine, playing, lengthTicks }: PlayheadProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!playing) {
      el.style.transform = "translateX(0px)";
      return;
    }
    const lastTick = lengthTicks - 1;
    let frame = 0;
    const draw = () => {
      const raw = engine.currentTick();
      const tick = Number.isFinite(raw) ? raw : 0;
      // 곡 끝 뒤 릴리즈 꼬리 동안 엔진 틱은 곡 길이를 넘는다. 마지막 틱에서 멈춘다.
      const clamped = Math.max(0, Math.min(tick, lastTick));
      el.style.transform = `translateX(${tickToX(clamped)}px)`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [engine, playing, lengthTicks]);

  return (
    <div
      ref={ref}
      data-testid="playhead"
      className="pointer-events-none absolute top-0 bottom-0 left-0 z-20 w-px bg-red-500"
    />
  );
}
