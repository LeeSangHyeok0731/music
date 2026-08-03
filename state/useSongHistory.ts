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
  /**
   * 히스토리에 쌓지 않고 곡을 교체하며, 이미 쌓인 스냅샷에도 같은 updater를
   * 적용한다.
   *
   * 템포 슬라이더처럼 드래그 한 번에 수십 번 불리는 조작을 위한 것이다.
   * commitWith로 처리하면 Ctrl+Z 50칸이 전부 템포로 채워져 실제 편집을
   * 되돌릴 수 없게 된다.
   *
   * 새 항목을 쌓지 않는 것만으로는 부족하다 — 과거 스냅샷은 각자 그 시점의
   * 옛 템포를 그대로 들고 있으므로, 손대지 않으면 타일을 편집하고 되돌릴
   * 때마다 템포가 그 스냅샷이 저장됐던 시점의 값으로 슬쩍 되돌아간다.
   * 그래서 `pastRef`의 모든 항목에도 같은 updater를 적용해(새 배열을 만들어)
   * "지금 템포"가 과거 스냅샷 전체에서 일관되게 유지되도록 다시 쓴다.
   *
   * 이 방식은 템포처럼 **곡 전체에 적용되는 설정**에서만 맞다 — 그 값은
   * 어느 스냅샷을 봐도 "당시의 값"이 아니라 "지금의 값"이어야 하기 때문이다.
   * 타일 추가/삭제 같은 **구조적 편집**에는 절대 쓰면 안 된다. 과거 스냅샷의
   * 타일 구성까지 지금 값으로 덮어쓰면 그 시점으로 되돌아간다는 Ctrl+Z의
   * 의미 자체가 사라진다.
   */
  replaceWithoutHistory: (updater: (song: Song) => Song) => void;
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

  const replaceWithoutHistory = useCallback((updater: (song: Song) => Song) => {
    const next = updater(songRef.current);
    if (next === songRef.current) return;

    // 새 항목을 쌓지 않는 것 — 이게 commitWith와의 첫 번째 차이다.
    songRef.current = next;
    setSong(next);

    // 이미 쌓인 스냅샷에도 같은 updater를 적용한다 — 두 번째 차이이자
    // 이 함수의 핵심이다. 원본 배열을 변형하지 않고 새 배열을 만든다.
    // updater가 각 스냅샷을 그대로 돌려주면(참조 동일) 그 자리도 참조가
    // 유지된다 — updater 자신의 계약이지 여기서 따로 보존할 것은 없다.
    pastRef.current = pastRef.current.map(updater);
    setPast(pastRef.current);
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

  return {
    song,
    commitWith,
    replaceWithoutHistory,
    undo,
    canUndo: past.length > 0,
  };
}
