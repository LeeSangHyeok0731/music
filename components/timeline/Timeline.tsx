"use client";

import { useRef } from "react";

import { ticksPerBar } from "@/lib/score/time";

import { useStudio } from "@/state/StudioProvider";
import { BarLines } from "./BarLines";
import { DrumGrid } from "./DrumGrid";
import { LineHeaders } from "./LineHeaders";
import { Playflag } from "./Playflag";
import { Ruler } from "./Ruler";
import { TileLine } from "./TileLine";
import { tickToPx } from "./layout";

export function Timeline() {
  const { song } = useStudio();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const perBar = ticksPerBar(song.timeSignature);
  const stageWidth = tickToPx(song.lengthTicks, perBar);
  const bars = Math.ceil(song.lengthTicks / perBar);

  return (
    <div className="flex h-full">
      <LineHeaders lines={song.lines} />

      <div
        ref={scrollerRef}
        className="timeline-scroll min-w-0 flex-1 overflow-auto"
      >
        {/*
          minWidth 100%는 뷰포트가 곡보다 넓을 때를 위한 것이다. 없으면
          스테이지가 곡 길이에서 끝나 오른쪽이 빈 배경으로 남는다.
          minHeight 100%는 라인 아래 남는 공간까지 마디선이 이어지게 해서
          "트랙이 더 들어갈 자리"로 읽히게 한다.
        */}
        <div
          className="relative min-h-full"
          style={{ width: stageWidth, minWidth: "100%" }}
        >
          <BarLines width={stageWidth} />
          <Ruler bars={bars} />
          {song.lines.map((line) =>
            line.kind === "drum" ? (
              <DrumGrid key={line.id} line={line} perBar={perBar} />
            ) : (
              <TileLine key={line.id} line={line} perBar={perBar} />
            ),
          )}
          <Playflag scrollerRef={scrollerRef} perBar={perBar} />
        </div>
      </div>
    </div>
  );
}
