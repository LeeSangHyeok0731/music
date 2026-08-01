"use client";

import { useCallback, useRef, useState } from "react";

import type { Song } from "@/lib/score/types";

/**
 * 곡 하나가 수백 타일이라 스냅샷 자체는 싸지만, 무한히 쌓을 이유도 없다.
 */
export const HISTORY_LIMIT = 50;

/** 뒤에 쌓고 상한을 넘으면 앞에서 버린다. 원본 배열은 건드리지 않는다. */
export function pushHistory(
  past: Song[],
  song: Song,
  limit: number = HISTORY_LIMIT,
): Song[] {
  const next = [...past, song];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export type SongHistory = {
  song: Song;
  /**
   * 현재 곡에 updater를 적용해 교체하고, 이전 곡을 히스토리에 쌓는다.
   *
   * 곡을 인자로 받지 않고 updater를 받는 이유: 호출부가 현재 곡을 클로저에
   * 담으면 편집마다 핸들러의 정체성이 바뀌고, 그러면 타임라인의 memo가
   * 매번 풀려 한 라인만 고쳐도 모든 라인이 다시 그려진다.
   */
  commitWith: (updater: (song: Song) => Song) => void;
  /** 되돌린 곡을 반환한다. 되돌릴 게 없으면 null. */
  undo: () => Song | null;
  canUndo: boolean;
};

export function useSongHistory(initial: Song): SongHistory {
  const [song, setSong] = useState(initial);
  const [past, setPast] = useState<Song[]>([]);

  // 상태를 ref로 미러링한다. setState 업데이터 안에서 값을 꺼내 반환하면
  // StrictMode에서 업데이터가 두 번 돌고 배치 때문에 시점도 보장되지 않는다.
  // ref로 읽으면 결정적이고, 콜백 의존성도 비어 정체성이 안정적이다.
  const songRef = useRef(song);
  const pastRef = useRef<Song[]>([]);

  const commitWith = useCallback((updater: (song: Song) => Song) => {
    const next = updater(songRef.current);
    if (next === songRef.current) return; // 편집 함수가 곡을 그대로 돌려준 경우

    pastRef.current = pushHistory(pastRef.current, songRef.current);
    songRef.current = next;
    setPast(pastRef.current);
    setSong(next);
  }, []);

  const undo = useCallback((): Song | null => {
    const prev = pastRef.current;
    if (prev.length === 0) return null;

    const restored = prev[prev.length - 1];
    pastRef.current = prev.slice(0, -1);
    songRef.current = restored;
    setPast(pastRef.current);
    setSong(restored);
    return restored;
  }, []);

  return { song, commitWith, undo, canUndo: past.length > 0 };
}
