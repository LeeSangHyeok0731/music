import { describe, expect, it } from "vitest";

import {
  HISTORY_LIMIT,
  canUndo,
  commit,
  createHistory,
  pushHistory,
  replaceWithoutHistory,
  undo,
} from "@/lib/score/history";

type Doc = { tempo: number; edits: string[] };
const doc = (tempo: number, edits: string[] = []): Doc => ({ tempo, edits });

describe("pushHistory", () => {
  it("뒤에 쌓는다", () => {
    const past = pushHistory(pushHistory([], 1), 2);
    expect(past).toEqual([1, 2]);
  });

  it("상한을 넘으면 오래된 것부터 버린다", () => {
    let past: number[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) past = pushHistory(past, i);
    expect(past).toHaveLength(HISTORY_LIMIT);
    expect(past[0]).toBe(10);
    expect(past.at(-1)).toBe(HISTORY_LIMIT + 9);
  });

  it("원본 배열을 변형하지 않는다", () => {
    const past: number[] = [];
    pushHistory(past, 1);
    expect(past).toHaveLength(0);
  });

  it("상한은 50이다", () => {
    expect(HISTORY_LIMIT).toBe(50);
  });
});

describe("commit", () => {
  it("이전 값을 쌓고 새 값을 현재로 만든다", () => {
    const h = commit(createHistory(doc(120)), (d) => ({ ...d, edits: ["a"] }));
    expect(h.present.edits).toEqual(["a"]);
    expect(h.past).toEqual([doc(120)]);
  });

  it("updater가 같은 참조를 돌려주면 히스토리에 빈 항목을 쌓지 않는다", () => {
    // 타일을 끌었다 제자리에 놓으면 편집 함수가 곡을 그대로 돌려준다.
    // 여기서 기록하면 Ctrl+Z가 아무것도 바꾸지 않는 칸을 소비한다.
    const start = createHistory(doc(120));
    const h = commit(start, (d) => d);
    expect(h).toBe(start);
    expect(canUndo(h)).toBe(false);
  });
});

describe("replaceWithoutHistory", () => {
  it("새 항목을 쌓지 않는다", () => {
    const h = replaceWithoutHistory(createHistory(doc(120)), (d) => ({
      ...d,
      tempo: 90,
    }));
    expect(h.present.tempo).toBe(90);
    expect(h.past).toHaveLength(0);
  });

  it("이미 쌓인 과거 스냅샷에도 같은 updater를 적용한다", () => {
    // 곡 전체 설정(템포)은 어느 스냅샷을 봐도 '지금 값'이어야 한다.
    // 안 그러면 편집을 되돌릴 때마다 템포가 옛 값으로 슬쩍 돌아간다.
    let h = createHistory(doc(120));
    h = commit(h, (d) => ({ ...d, edits: ["a"] }));
    h = commit(h, (d) => ({ ...d, edits: ["a", "b"] }));
    h = replaceWithoutHistory(h, (d) => ({ ...d, tempo: 90 }));

    expect(h.past.map((d) => d.tempo)).toEqual([90, 90]);
    const back = undo(h)!;
    expect(back.present.tempo).toBe(90);
    expect(back.present.edits).toEqual(["a"]);
  });

  it("원본 과거 배열을 변형하지 않는다", () => {
    let h = createHistory(doc(120));
    h = commit(h, (d) => ({ ...d, edits: ["a"] }));
    const before = h.past;
    replaceWithoutHistory(h, (d) => ({ ...d, tempo: 90 }));
    expect(before[0].tempo).toBe(120);
  });

  it("updater가 같은 참조를 돌려주면 아무것도 바꾸지 않는다", () => {
    const start = createHistory(doc(120));
    expect(replaceWithoutHistory(start, (d) => d)).toBe(start);
  });
});

describe("undo", () => {
  it("되돌릴 게 없으면 null이다", () => {
    expect(undo(createHistory(doc(120)))).toBeNull();
  });

  it("마지막 항목으로 되돌린다", () => {
    let h = createHistory(doc(120));
    h = commit(h, (d) => ({ ...d, edits: ["a"] }));
    h = commit(h, (d) => ({ ...d, edits: ["a", "b"] }));
    const back = undo(h)!;
    expect(back.present.edits).toEqual(["a"]);
    expect(canUndo(back)).toBe(true);
    expect(canUndo(undo(back)!)).toBe(false);
  });
});
