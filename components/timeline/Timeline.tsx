"use client";

import { useRef } from "react";

import { ticksPerBar } from "@/lib/score/time";

import { useStudio } from "@/state/StudioProvider";
import { BarLines } from "./BarLines";
import { DrumGrid } from "./DrumGrid";
import { LineHeaders } from "./LineHeaders";
import { Playflag } from "./Playflag";
import { TileLine } from "./TileLine";
import { tickToPx } from "./layout";

export function Timeline() {
  const { song } = useStudio();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const perBar = ticksPerBar(song.timeSignature);
  const stageWidth = tickToPx(song.lengthTicks, perBar);

  return (
    <div className="flex overflow-hidden rounded-lg border border-white/15 bg-zinc-900">
      <LineHeaders lines={song.lines} />
      <div ref={scrollerRef} className="flex-1 overflow-x-auto">
        <div className="relative" style={{ width: stageWidth }}>
          <BarLines width={stageWidth} />
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
