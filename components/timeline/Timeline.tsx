"use client";

import { useEffect, useRef } from "react";

import { ticksPerBar } from "@/lib/score/time";

import { useStudio } from "@/state/StudioProvider";
import { BarLines } from "./BarLines";
import { DrumGrid } from "./DrumGrid";
import { LineHeaders } from "./LineHeaders";
import { Playflag } from "./Playflag";
import { Ruler } from "./Ruler";
import { TileLine } from "./TileLine";
import { TilePopover } from "./TilePopover";
import { tickToPx } from "./layout";

export function Timeline() {
  const { song, selection, select, edit, editable, undo } = useStudio();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const perBar = ticksPerBar(song.timeSignature);
  const stageWidth = tickToPx(song.lengthTicks, perBar);
  const bars = Math.ceil(song.lengthTicks / perBar);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // 입력 필드에 포커스가 있으면 가로채지 않는다. 팝오버의 슬라이더와
      // 드롭다운이 여기 해당한다 — Backspace를 삼키면 값을 못 지운다.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }

      if (!editable) return;

      if (event.key === "Escape") {
        select(null);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selection) return;
        // 브라우저 뒤로가기를 막는다
        event.preventDefault();
        edit.remove(selection.lineId, selection.tileId);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editable, selection, select, edit, undo]);

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
              <DrumGrid
                key={line.id}
                line={line}
                perBar={perBar}
                editable={editable}
                edit={edit}
              />
            ) : (
              <TileLine
                key={line.id}
                line={line}
                perBar={perBar}
                editable={editable}
                selectedTileId={
                  selection && selection.lineId === line.id
                    ? selection.tileId
                    : null
                }
                edit={edit}
                // select를 그대로 넘긴다. 여기서 lineId를 감싼 클로저를
                // 만들면 매 렌더마다 새 함수가 되어 memo가 항상 풀린다 —
                // 재생 중 context가 10Hz로 바뀌므로 타일 전체가 그만큼
                // 재조정된다. TileLine이 이미 line.id를 알고 있다.
                onSelect={select}
              />
            ),
          )}
          <Playflag scrollerRef={scrollerRef} perBar={perBar} />
          {/*
            선택이 바뀌면 새로 마운트시킨다. 팝오버는 닫혀도 null만 반환할 뿐
            언마운트되지 않아서, 음 추가 드롭다운을 연 채로 Esc를 누르면 그
            상태가 남는다. 다음 타일이 입력 모드로 열리고 autoFocus가 포커스를
            가져간다. key를 바꿔 상태를 초기화한다.
          */}
          <TilePopover
            key={selection ? `${selection.lineId}:${selection.tileId}` : "none"}
            perBar={perBar}
          />
        </div>
      </div>
    </div>
  );
}
