/**
 * 지금 진행 중인 포인터 제스처(클립 이동·길이, 코드 경계 드래그) 수. 드래그 훅이 제스처가 시작될 때
 * `beginGesture()`로 올리고, **끝나는 모든 경로**(놓기·취소·Esc·편집 불가·언마운트)에서 돌려받은
 * 해제 함수를 부른다. 단축키(`useShortcuts`)가 실행취소를 막는 데 읽는다 — 드래그 중에 곡이
 * 바뀌면 놓을 때의 커밋이 낡은 스냅샷에서 계산되기 때문이다.
 *
 * 모듈 수준 카운터라 `popover.ts`의 `openPopoverCount`와 같은 이유로 훅이 소유한 해제 함수로만
 * 줄인다(해제 함수는 여러 번 불러도 한 번만 줄인다).
 */
let activeGestureCount = 0;

/** 제스처 하나를 센다. 돌려주는 함수가 그 제스처를 센 것을 거둔다(멱등). */
export function beginGesture(): () => void {
  activeGestureCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeGestureCount--;
  };
}

/** 어느 훅이든 포인터 제스처가 진행 중인가(누르고 있는 중 포함). */
export function hasActiveGesture(): boolean {
  return activeGestureCount > 0;
}
