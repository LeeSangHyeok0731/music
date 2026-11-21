"use client";

import { useEffect, useRef } from "react";

import type { StudioEngine } from "@/state/types";

import { tickToX } from "./geometry";

interface PlayheadProps {
  engine: Pick<StudioEngine, "currentTick">;
  playing: boolean;
  /** 그리는 구간의 길이(틱). 기본은 곡 전체, 피아노롤에서는 클립 길이다. */
  lengthTicks: number;
  /** 구간의 시작(곡 기준 틱). 엔진 틱에서 빼서 구간 안의 상대 틱으로 그린다. 기본 0. */
  offsetTick?: number;
  /** 구간 안의 틱 → x(px). 기본은 타임라인 좌표(`tickToX`). 안정된(모듈 수준) 함수를 넘긴다. */
  toX?: (tick: number) => number;
}

/**
 * 재생 위치 세로선. 노트·클립과 분리된 레이어라 프레임마다 DOM `transform`만 쓰고
 * 리렌더를 일으키지 않는다(`useState` 없음). `transform`을 `style` prop으로 두지
 * 않는다 — React가 소유한 값을 rAF가 덮으면 정지 때 되돌리는 쓰기를 React가
 * 같다고 보고 건너뛴다. 모든 쓰기는 이 effect가 한다.
 */
export function Playhead({
  engine,
  playing,
  lengthTicks,
  offsetTick = 0,
  toX = tickToX,
}: PlayheadProps) {
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
      // 비유한 값은 구간 시작이다. 구간 밖(곡 끝 뒤 릴리즈 꼬리, 클립 앞뒤)은 양 끝에서 멈춘다.
      const tick = Number.isFinite(raw) ? raw - offsetTick : 0;
      const clamped = Math.max(0, Math.min(tick, lastTick));
      el.style.transform = `translateX(${toX(clamped)}px)`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [engine, playing, lengthTicks, offsetTick, toX]);

  return (
    <div
      ref={ref}
      data-testid="playhead"
      className="pointer-events-none absolute top-0 bottom-0 left-0 z-20 w-px bg-red-500"
    />
  );
}
