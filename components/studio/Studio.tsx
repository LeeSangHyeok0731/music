"use client";

import { songLengthTicks } from "@/lib/score/time";
import { useStudio } from "@/state/useStudio";

import { BeatGrid } from "./BeatGrid";
import { Playhead } from "./Playhead";
import { Ruler } from "./Ruler";
import { TopBar } from "./TopBar";
import { PX_PER_BAR } from "./geometry";
import { INSTRUMENT_DOT, INSTRUMENT_LABEL } from "./instruments";
import {
  CHORD_LANE_HEIGHT,
  HEADER_WIDTH,
  ROW_DIVIDER,
  RULER_HEIGHT,
  TRACK_LANE_HEIGHT,
} from "./layout";

/**
 * 편집 화면의 최상위. `StudioProvider` 안에서 쓴다(Provider는 만들지 않는다).
 *
 * 좌측 헤더 열(고정 폭)과 가로 스크롤되는 타임라인(`data-testid="timeline"`)이
 * 같은 행 높이 상수(`layout.ts`)를 쓴다. 레인 자리(`chord-lane`, `track-lane-<id>`)는
 * 비어 있다 — 코드 레인·트랙 레인은 이후 Task가 이 컨테이너 안을 채운다.
 */
export function Studio() {
  const { song, playing, getEngine } = useStudio();

  return (
    <div className="flex h-dvh flex-col bg-[#0b0c0f] text-zinc-200">
      <TopBar />
      <div className="timeline-scroll flex min-h-0 flex-1 overflow-y-auto">
        <div
          data-testid="track-headers"
          className="shrink-0 border-r border-white/10 bg-[#141519] text-sm"
          style={{ width: HEADER_WIDTH }}
        >
          <div style={{ height: RULER_HEIGHT, boxShadow: ROW_DIVIDER }} />
          <div
            data-testid="chord-lane-header"
            className="flex items-center px-3 text-zinc-400"
            style={{ height: CHORD_LANE_HEIGHT, boxShadow: ROW_DIVIDER }}
          >
            코드
          </div>
          {song.tracks.map((track) => (
            <div
              key={track.id}
              data-testid={`track-header-${track.id}`}
              className="flex items-center gap-2 px-3 text-zinc-200"
              style={{ height: TRACK_LANE_HEIGHT, boxShadow: ROW_DIVIDER }}
            >
              <span
                aria-hidden
                className={`size-2 shrink-0 rounded-full ${INSTRUMENT_DOT[track.instrument]}`}
              />
              {INSTRUMENT_LABEL[track.instrument]}
            </div>
          ))}
        </div>

        <div
          data-testid="timeline"
          className="timeline-scroll min-w-0 flex-1 overflow-x-auto"
        >
          <div
            data-testid="stage"
            className="relative min-h-full"
            style={{ width: song.bars * PX_PER_BAR, minWidth: "100%" }}
          >
            <BeatGrid bars={song.bars} beatsPerBar={song.timeSignature[0]} />
            <div className="relative z-10">
              <Ruler bars={song.bars} />
              <div
                data-testid="chord-lane"
                style={{ height: CHORD_LANE_HEIGHT, boxShadow: ROW_DIVIDER }}
              />
              {song.tracks.map((track) => (
                <div
                  key={track.id}
                  data-testid={`track-lane-${track.id}`}
                  style={{ height: TRACK_LANE_HEIGHT, boxShadow: ROW_DIVIDER }}
                />
              ))}
            </div>
            <Playhead
              engine={getEngine()}
              playing={playing}
              lengthTicks={songLengthTicks(song)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
