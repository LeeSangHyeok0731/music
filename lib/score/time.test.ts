import { describe, expect, it } from "vitest";

import { PPQ } from "@/lib/score/model";
import {
  secondsToTicks,
  songLengthTicks,
  ticksPerBar,
  ticksPerBeat,
  ticksToBarBeat,
  ticksToSeconds,
} from "@/lib/score/time";

describe("ticksToSeconds", () => {
  it("120BPM에서 4분음표 한 개는 0.5초다", () => {
    expect(ticksToSeconds(PPQ, 120)).toBe(0.5);
  });

  it("템포가 두 배면 시간은 절반이다", () => {
    expect(ticksToSeconds(PPQ, 240)).toBe(0.25);
  });

  it("0틱은 0초다", () => {
    expect(ticksToSeconds(0, 120)).toBe(0);
  });
});

describe("secondsToTicks", () => {
  it("ticksToSeconds의 역함수다", () => {
    expect(secondsToTicks(0.5, 120)).toBe(PPQ);
  });
});

describe("ticksPerBar", () => {
  it("4/4 한 마디는 4분음표 4개다", () => {
    expect(ticksPerBar([4, 4])).toBe(PPQ * 4);
  });

  it("3/4 한 마디는 4분음표 3개다", () => {
    expect(ticksPerBar([3, 4])).toBe(PPQ * 3);
  });

  it("6/8 한 마디는 8분음표 6개다", () => {
    expect(ticksPerBar([6, 8])).toBe(PPQ * 3);
  });
});

describe("ticksPerBeat", () => {
  it("4/4에서 한 박은 4분음표 1개다", () => {
    expect(ticksPerBeat([4, 4])).toBe(PPQ);
  });

  it("3/4에서 한 박은 4분음표 1개다", () => {
    expect(ticksPerBeat([3, 4])).toBe(PPQ);
  });

  it("6/8에서 한 박은 8분음표 1개다", () => {
    expect(ticksPerBeat([6, 8])).toBe(PPQ / 2);
  });
});

describe("ticksToBarBeat", () => {
  it("0틱은 1마디 1박이다", () => {
    expect(ticksToBarBeat(0, [4, 4])).toEqual({ bar: 1, beat: 1 });
  });

  it("1920틱은 2마디 1박이다", () => {
    expect(ticksToBarBeat(1920, [4, 4])).toEqual({ bar: 2, beat: 1 });
  });

  it("2400틱은 2마디 2박이다", () => {
    expect(ticksToBarBeat(2400, [4, 4])).toEqual({ bar: 2, beat: 2 });
  });
});

describe("누적 오차", () => {
  it("정수 틱에서 계산하면 몇 번을 불러도 같은 값이 나온다", () => {
    // 스케줄러가 앵커에서 매번 다시 계산하는 근거
    expect(ticksToSeconds(10_000, 137)).toBe(ticksToSeconds(10_000, 137));
  });

  it("한 틱씩 더해 나가는 방식과 결과가 갈린다", () => {
    let accumulated = 0;
    for (let i = 0; i < 10_000; i++) {
      accumulated += ticksToSeconds(1, 137);
    }
    const direct = ticksToSeconds(10_000, 137);
    // 10,000번 정도로는 차이가 미세하지만, 재생이 길어질수록 벌어진다.
    // 그래서 pos += delta 로 굴리지 않는다.
    expect(Math.abs(accumulated - direct)).toBeLessThan(1e-6);
  });
});

describe("songLengthTicks", () => {
  it("bars × ticksPerBar다", () => {
    expect(songLengthTicks({ bars: 8, timeSignature: [4, 4] })).toBe(8 * 1920);
    expect(songLengthTicks({ bars: 4, timeSignature: [3, 4] })).toBe(4 * 1440);
    expect(songLengthTicks({ bars: 2, timeSignature: [6, 8] })).toBe(2 * 1440);
  });
});
