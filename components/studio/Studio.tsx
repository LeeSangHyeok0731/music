"use client";

import { songLengthTicks } from "@/lib/score/time";
import { useStudio } from "@/state/useStudio";

import { BARS_CONTROL_WIDTH, BarsControl } from "./BarsControl";
import { BeatGrid } from "./BeatGrid";
import { ChordLane } from "./ChordLane";
import { Playhead } from "./Playhead";
import { Ruler } from "./Ruler";
import { TopBar } from "./TopBar";
import { TrackLane } from "./TrackLane";
import { PX_PER_BAR } from "./geometry";
import { INSTRUMENT_DOT, INSTRUMENT_LABEL } from "./instruments";
import {
  CHORD_LANE_HEIGHT,
  HEADER_WIDTH,
  ROW_DIVIDER,
  RULER_HEIGHT,
  TRACK_LANE_HEIGHT,
} from "./layout";
import { useShortcuts } from "./useShortcuts";

/**
 * 편집 화면의 최상위. `StudioProvider` 안에서 쓴다(Provider는 만들지 않는다).
 *
 * 좌측 헤더 열(고정 폭)과 가로 스크롤되는 타임라인(`data-testid="timeline"`)이
 * 같은 행 높이 상수(`layout.ts`)를 쓴다. 타임라인 안에서 스테이지 오른쪽에 `BarsControl`이 눈금자 행
 * 높이로 붙어 함께 스크롤된다. 코드 레인은 `ChordLane`, 트랙 레인(`track-lane-<id>`)은
 * `TrackLane`이 그린다.
 */
export function Studio() {
  const { song, playing, getEngine } = useStudio();
  useShortcuts();

  return (
    <div className="flex h-dvh flex-col bg-[#0b0c0f] text-zinc-200">
      <TopBar />
      {/* 세로 스크롤 소유자는 이 래퍼 하나다. 두 열은 body-columns 안에서 함께 늘어난다. */}
      <div
        data-testid="body-scroll"
        className="timeline-scroll min-h-0 flex-1 overflow-y-auto"
      >
        <div data-testid="body-columns" className="flex min-h-full">
          <div
            data-testid="track-headers"
            className="shrink-0 border-r border-white/10 bg-[#141519] text-sm"
            style={{ width: HEADER_WIDTH }}
          >
            <div
              data-testid="ruler-spacer"
              style={{ height: RULER_HEIGHT, boxShadow: ROW_DIVIDER }}
            />
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
            className="timeline-scroll flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
          >
            <div
              data-testid="stage"
              className="relative min-h-full shrink-0"
              style={{
                width: song.bars * PX_PER_BAR,
                // 짧은 곡이어도 마디 컨트롤이 화면 안에 들어오게 그 폭만큼 비운다.
                minWidth: `calc(100% - ${BARS_CONTROL_WIDTH}px)`,
              }}
            >
              <BeatGrid bars={song.bars} beatsPerBar={song.timeSignature[0]} />
              <div className="relative z-10">
                <Ruler bars={song.bars} />
                <ChordLane />
                {song.tracks.map((track) => (
                  <TrackLane key={track.id} trackId={track.id} />
                ))}
              </div>
              <Playhead
                engine={getEngine()}
                playing={playing}
                lengthTicks={songLengthTicks(song)}
              />
            </div>
            <BarsControl />
          </div>
        </div>
      </div>
    </div>
  );
}
