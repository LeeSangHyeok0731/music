"use client";

import { useEffect, useRef } from "react";

import { useStudio } from "@/state/StudioProvider";
import { tickToPx } from "./layout";

/** 플래그가 이 비율을 넘어가면 스크롤이 따라간다. */
const FOLLOW_THRESHOLD = 0.75;

export function Playflag({
  scrollerRef,
  perBar,
}: {
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  perBar: number;
}) {
  const { isPlaying, currentTick } = useStudio();
  const flagRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPlaying) {
      // 정지하면 처음으로 되돌린다
      if (flagRef.current) {
        flagRef.current.style.transform = "translateX(0px)";
      }
      return;
    }

    let raf = 0;

    const frame = () => {
      const px = tickToPx(currentTick(), perBar);

      if (flagRef.current) {
        // transform만 바꾼다 — 레이아웃이 다시 계산되지 않는다
        flagRef.current.style.transform = `translateX(${px}px)`;
      }

      const scroller = scrollerRef.current;
      if (
        scroller &&
        px - scroller.scrollLeft > scroller.clientWidth * FOLLOW_THRESHOLD
      ) {
        scroller.scrollLeft = px - scroller.clientWidth * 0.5;
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, currentTick, perBar, scrollerRef]);

  return (
    <div
      ref={flagRef}
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-0 z-10 w-px bg-red-500 will-change-transform"
    >
      {/* 눈금자 위에 얹히는 머리. 플래그가 어디에 있는지 멀리서도 보인다. */}
      <div className="absolute -top-px -left-[3.5px] h-2 w-2 rotate-45 rounded-[1px] bg-red-500" />
    </div>
  );
}
