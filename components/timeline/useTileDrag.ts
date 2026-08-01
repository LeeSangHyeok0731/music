"use client";

import { useCallback, useRef } from "react";

import { pxToTick } from "./layout";

export type DragKind = "move" | "resize";

type DragState = {
  kind: DragKind;
  tileId: string;
  startTick: number;
  lengthTick: number;
  originX: number;
  /** 드래그 시작 시점의 폭. offsetWidth를 매번 읽으면 값이 누적된다. */
  originWidth: number;
  /**
   * 드래그 시작 시점에 React가 써 둔 style.width 문자열.
   *
   * 미리보기를 되돌릴 때 ""로 지우면 안 된다. width는 React가 소유하는데,
   * 지워도 React의 스타일 기록에는 여전히 이전 값이 남아 있다. 다음 렌더에서
   * 값이 같다고 판단해 다시 쓰지 않으므로 폭이 비어 있는 채로 굳는다 —
   * 타일이 글자 크기로 쪼그라들고 영구히 안 돌아온다. 원래 문자열을 그대로
   * 되돌려 놓는다. offsetWidth로 되돌리면 안 되는데, 그건 정수로 반올림된
   * 값이라 tickToPx가 만드는 소수 픽셀과 어긋나 조금씩 밀린다.
   */
  originWidthStyle: string;
  element: HTMLElement;
};

/**
 * 타일 드래그. 드래그 중에는 곡 데이터를 건드리지 않고 DOM만 옮긴다.
 *
 * 매 pointermove마다 setSong을 부르면 곡 전체가 교체되고 실행취소
 * 히스토리에 수십 개가 쌓인다. 커밋은 pointerup에서 한 번뿐이다.
 */
export function useTileDrag({
  perBar,
  onCommitMove,
  onCommitResize,
}: {
  perBar: number;
  onCommitMove: (tileId: string, startTicks: number) => void;
  onCommitResize: (tileId: string, lengthTicks: number) => void;
}) {
  const drag = useRef<DragState | null>(null);

  /** DOM 미리보기를 시작 상태로 되돌린다. */
  const revert = useCallback((state: DragState) => {
    // transform은 React가 쓰지 않으므로 지워도 된다.
    state.element.style.transform = "";
    // width는 React가 소유한다. 원래 문자열을 그대로 되돌린다.
    if (state.kind === "resize") {
      state.element.style.width = state.originWidthStyle;
    }
  }, []);

  const onPointerDown = useCallback(
    (
      event: React.PointerEvent<HTMLElement>,
      kind: DragKind,
      tileId: string,
      startTick: number,
      lengthTick: number,
    ) => {
      const element = event.currentTarget;
      // 포인터가 요소 밖으로 나가도 추적이 끊기지 않게 한다
      element.setPointerCapture(event.pointerId);
      drag.current = {
        kind,
        tileId,
        startTick,
        lengthTick,
        originX: event.clientX,
        originWidth: element.offsetWidth,
        originWidthStyle: element.style.width,
        element,
      };
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = drag.current;
      if (!state) return;

      const deltaPx = event.clientX - state.originX;

      if (state.kind === "move") {
        // transform만 바꾼다 — 레이아웃이 다시 계산되지 않는다
        state.element.style.transform = `translateX(${deltaPx}px)`;
      } else {
        // 시작 시점의 폭에서 계산한다. offsetWidth를 매번 읽으면 방금 쓴
        // 값을 다시 읽어 폭이 누적되며 폭주한다.
        state.element.style.width = `${Math.max(4, state.originWidth + deltaPx)}px`;
      }
    },
    [],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = drag.current;
      if (!state) return;
      drag.current = null;

      const deltaTick = pxToTick(event.clientX - state.originX, perBar);

      // 미리보기를 되돌린다. 커밋된 곡이 새로 렌더되면서 제자리를 잡는다.
      revert(state);

      if (state.kind === "move") {
        onCommitMove(state.tileId, state.startTick + deltaTick);
      } else {
        onCommitResize(state.tileId, state.lengthTick + deltaTick);
      }
    },
    [perBar, onCommitMove, onCommitResize, revert],
  );

  /**
   * 드래그가 끝나지 못하고 끊긴 경우. 커밋 없이 미리보기만 되돌린다.
   *
   * 없으면 두 경우에 타일이 어긋난 채로 굳는다. 하나는 터치 — 가로 스크롤이
   * 가능한 스테이지 위에서 가로로 끌면 브라우저가 패닝으로 가져가며
   * pointercancel을 쏜다. 다른 하나는 우클릭 삭제 — 요소가 언마운트되면
   * pointerup이 그 노드에 도달하지 못해 드래그 상태가 남는다.
   */
  const onPointerCancel = useCallback(() => {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    revert(state);
  }, [revert]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
