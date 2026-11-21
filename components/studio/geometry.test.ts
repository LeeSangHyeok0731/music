import { describe, expect, it } from "vitest";

import {
  BAR_TICKS,
  PX_PER_BAR,
  barLabels,
  clipRect,
  deltaTicks,
  pointerToTick,
  tickToX,
  xToTick,
} from "@/components/studio/geometry";
import { mulberry32 } from "@/lib/score/testing/random";
import { ticksPerBar } from "@/lib/score/time";

// 이 파일의 기본 비율: 한 마디 = 1920틱 = 160px, 즉 1px = 12틱, 1틱 = 1/12px.

describe("상수", () => {
  it("한 마디는 160px, 1920틱이다", () => {
    expect(PX_PER_BAR).toBe(160);
    expect(BAR_TICKS).toBe(1920);
  });

  it("BAR_TICKS는 4/4 한 마디의 틱 수와 같다", () => {
    expect(BAR_TICKS).toBe(ticksPerBar([4, 4]));
  });
});

describe("tickToX", () => {
  it("한 마디(1920틱) = 160px", () => {
    expect(tickToX(1920)).toBe(160);
  });

  it("반마디(960틱) = 80px", () => {
    // 960 / 1920 * 160 = 0.5 * 160 = 80
    expect(tickToX(960)).toBe(80);
  });

  it("0틱 = 0px, 8마디(15360틱) = 1280px", () => {
    expect(tickToX(0)).toBe(0);
    // 15360 / 1920 = 8, 8 * 160 = 1280
    expect(tickToX(15360)).toBe(1280);
  });

  it("12틱 = 1px", () => {
    // 12 / 1920 * 160 = 0.00625 * 160 = 1
    expect(tickToX(12)).toBeCloseTo(1, 10);
  });
});

describe("xToTick", () => {
  it("160px = 1920틱(한 마디)", () => {
    expect(xToTick(160)).toBe(1920);
  });

  it("80px = 960틱(반마디)", () => {
    // 80 / 160 * 1920 = 0.5 * 1920 = 960
    expect(xToTick(80)).toBe(960);
  });

  it("반올림 경계: 0.5px = 6틱", () => {
    // 0.5 / 160 * 1920 = 0.003125 * 1920 = 6 → 정확히 정수
    expect(xToTick(0.5)).toBe(6);
  });

  it("틱 단위로 반올림한다: 1px = 12틱이므로 0.05px는 1틱, 0.04px는 0틱", () => {
    // 0.05 * 12 = 0.6 → round → 1
    expect(xToTick(0.05)).toBe(1);
    // 0.04 * 12 = 0.48 → round → 0
    expect(xToTick(0.04)).toBe(0);
    // 0.09 * 12 = 1.08 → 1, 0.11 * 12 = 1.32 → 1, 0.13 * 12 = 1.56 → 2
    expect(xToTick(0.09)).toBe(1);
    expect(xToTick(0.13)).toBe(2);
  });

  it("음수도 변환한다: -80px = -960틱", () => {
    expect(xToTick(-80)).toBe(-960);
  });

  it("-0을 돌려주지 않는다", () => {
    // -0.04 * 12 = -0.48 → Math.round → -0 이 되는 입력
    expect(Object.is(xToTick(-0.04), 0)).toBe(true);
    expect(Object.is(xToTick(-0), 0)).toBe(true);
  });

  it("결과는 항상 정수다", () => {
    for (const x of [0.01, 0.37, 1.234, 77.7, 159.99, 1234.567]) {
      expect(Number.isInteger(xToTick(x))).toBe(true);
    }
  });
});

describe("tickToX ↔ xToTick 왕복", () => {
  it("960의 배수는 정확히 돌아온다", () => {
    for (let t = 0; t <= 960 * 1000; t += 960) {
      expect(xToTick(tickToX(t))).toBe(t);
    }
  });

  it("임의 정수 틱도 돌아온다(0 ~ 500마디)", () => {
    const rand = mulberry32(20261121);
    const max = 500 * BAR_TICKS;
    for (let i = 0; i < 5000; i++) {
      const t = Math.floor(rand() * max);
      expect(xToTick(tickToX(t))).toBe(t);
    }
  });

  it("경계값도 돌아온다", () => {
    for (const t of [0, 1, 2, 11, 12, 13, 959, 960, 961, 1919, 1920, 1921, 500 * 1920]) {
      expect(xToTick(tickToX(t))).toBe(t);
    }
  });
});

describe("pointerToTick", () => {
  it("레인 왼쪽 가장자리에서 0틱", () => {
    expect(pointerToTick(100, 100)).toBe(0);
  });

  it("레인 왼쪽을 기준으로 잰다", () => {
    // clientX 260, laneLeft 100 → 160px → 한 마디
    expect(pointerToTick(260, 100)).toBe(1920);
    // clientX 300, laneLeft 100 → 200px → 200 * 12 = 2400
    expect(pointerToTick(300, 100)).toBe(2400);
  });

  it("scrollLeft를 보정한다(스크롤한 만큼 더 오른쪽 틱)", () => {
    // clientX 300, laneLeft 100, scrollLeft 160 → 300 - 100 + 160 = 360px → 360 * 12 = 4320
    expect(pointerToTick(300, 100, 160)).toBe(4320);
    // 같은 화면 위치라도 스크롤 0이면 2400 — 보정이 실제로 더해진다
    expect(pointerToTick(300, 100, 160)).not.toBe(pointerToTick(300, 100, 0));
  });

  it("scrollLeft를 생략하면 0이다", () => {
    expect(pointerToTick(300, 100)).toBe(pointerToTick(300, 100, 0));
  });

  it("레인 왼쪽보다 왼쪽이면 0으로 자른다(음수 틱 없음)", () => {
    // 50 - 100 = -50px → -600틱 → 0
    expect(pointerToTick(50, 100)).toBe(0);
    expect(pointerToTick(50, 100, 0)).toBe(0);
  });

  it("스크롤하면 레인 왼쪽 밖이어도 양수가 될 수 있다", () => {
    // 50 - 100 + 60 = 10px → 120틱
    expect(pointerToTick(50, 100, 60)).toBe(120);
    // 50 - 100 + 20 = -30px → 0
    expect(pointerToTick(50, 100, 20)).toBe(0);
  });

  it("-0을 돌려주지 않는다", () => {
    // 99.99 - 100 = -0.01px → -0.12틱 → Math.round → -0 → 0으로 정규화
    expect(Object.is(pointerToTick(99.99, 100), 0)).toBe(true);
    expect(Object.is(pointerToTick(50, 100), 0)).toBe(true);
    expect(Object.is(pointerToTick(100, 100), 0)).toBe(true);
  });

  it("정수 틱을 돌려준다", () => {
    expect(Number.isInteger(pointerToTick(123.456, 10.1, 7.77))).toBe(true);
  });
});

describe("clipRect", () => {
  it("clipRect(960, 1920) = {left: 80, width: 160}", () => {
    // left = 960 / 1920 * 160 = 80, width = 1920 / 1920 * 160 = 160
    expect(clipRect(960, 1920)).toEqual({ left: 80, width: 160 });
  });

  it("0에서 시작하는 한 마디 클립", () => {
    expect(clipRect(0, 1920)).toEqual({ left: 0, width: 160 });
  });

  it("반마디 길이 클립", () => {
    // 3840 / 1920 * 160 = 320, 960 / 1920 * 160 = 80
    expect(clipRect(3840, 960)).toEqual({ left: 320, width: 80 });
  });
});

describe("deltaTicks", () => {
  it("오른쪽으로 끌면 양수: 160px = 1920틱", () => {
    expect(deltaTicks(100, 260)).toBe(1920);
  });

  it("왼쪽으로 끌면 음수: -160px = -1920틱", () => {
    expect(deltaTicks(260, 100)).toBe(-1920);
  });

  it("반마디: 80px = 960틱", () => {
    expect(deltaTicks(100, 180)).toBe(960);
    expect(deltaTicks(180, 100)).toBe(-960);
  });

  it("움직이지 않으면 0(-0 아님)", () => {
    expect(Object.is(deltaTicks(100, 100), 0)).toBe(true);
    // -0.04px → -0.48틱 → -0 이 되는 입력
    expect(Object.is(deltaTicks(100.04, 100), 0)).toBe(true);
  });

  it("scrollLeft와 무관하다(두 점의 차이만 본다)", () => {
    expect(deltaTicks(1000, 1160)).toBe(deltaTicks(0, 160));
  });
});

describe("barLabels", () => {
  it("1부터 bars까지", () => {
    expect(barLabels(1)).toEqual([1]);
    expect(barLabels(3)).toEqual([1, 2, 3]);
    expect(barLabels(8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("0 이하는 빈 배열", () => {
    expect(barLabels(0)).toEqual([]);
    expect(barLabels(-2)).toEqual([]);
  });

  it("500마디까지 만든다", () => {
    const labels = barLabels(500);
    expect(labels).toHaveLength(500);
    expect(labels[0]).toBe(1);
    expect(labels[499]).toBe(500);
  });
});
