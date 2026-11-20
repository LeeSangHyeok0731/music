/**
 * 곡 하나가 수백 클립이라 스냅샷 자체는 싸지만, 무한히 쌓을 이유도 없다.
 */
export const HISTORY_LIMIT = 50;

export type History<T> = {
  readonly past: readonly T[];
  readonly present: T;
};

export function createHistory<T>(present: T): History<T> {
  return { past: [], present };
}

/** 뒤에 쌓고 상한을 넘으면 앞에서 버린다. 원본 배열은 건드리지 않는다. */
export function pushHistory<T>(
  past: readonly T[],
  item: T,
  limit: number = HISTORY_LIMIT,
): T[] {
  const next = [...past, item];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * 현재 값에 updater를 적용해 교체하고, 이전 값을 과거에 쌓는다.
 * updater가 같은 참조를 돌려주면(제자리 편집) 아무것도 기록하지 않는다.
 */
export function commit<T>(
  history: History<T>,
  updater: (value: T) => T,
): History<T> {
  const next = updater(history.present);
  if (next === history.present) return history;
  return { past: pushHistory(history.past, history.present), present: next };
}

/**
 * 히스토리에 쌓지 않고 값을 교체하며, 이미 쌓인 과거에도 같은 updater를
 * 적용한다.
 *
 * 템포처럼 **곡 전체에 적용되는 설정**에서만 맞다. 그 값은 어느 스냅샷을
 * 봐도 "당시의 값"이 아니라 "지금의 값"이어야 하기 때문이다. 클립 추가·삭제
 * 같은 **구조적 편집**에는 절대 쓰면 안 된다 — 과거의 구성까지 지금 값으로
 * 덮으면 "그 시점으로 되돌아간다"는 실행취소의 의미가 사라진다.
 */
export function replaceWithoutHistory<T>(
  history: History<T>,
  updater: (value: T) => T,
): History<T> {
  const next = updater(history.present);
  if (next === history.present) return history;
  return { past: history.past.map(updater), present: next };
}

/** 되돌린 히스토리를 돌려준다. 되돌릴 게 없으면 null. */
export function undo<T>(history: History<T>): History<T> | null {
  if (history.past.length === 0) return null;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}
