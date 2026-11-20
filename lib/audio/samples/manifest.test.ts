import { describe, expect, it } from "vitest";

import {
  findZone,
  parseManifest,
  playbackRateFor,
  type SampleZone,
} from "@/lib/audio/samples/manifest";

const ZONES: SampleZone[] = [
  { file: "low.wav", centerPitch: 48, loPitch: 40, hiPitch: 55 },
  { file: "high.wav", centerPitch: 72, loPitch: 65, hiPitch: 79 },
];

describe("parseManifest", () => {
  it("올바른 매니페스트를 받는다", () => {
    const m = parseManifest({ instrument: "piano", zones: ZONES }, "piano");
    expect(m.zones).toHaveLength(2);
  });

  it("기대한 악기와 다르면 던진다", () => {
    expect(() =>
      parseManifest({ instrument: "bass", zones: ZONES }, "piano"),
    ).toThrow("piano");
  });

  it("존이 없으면 던진다", () => {
    expect(() => parseManifest({ instrument: "piano", zones: [] }, "piano")).toThrow();
  });

  it("lo <= center <= hi가 아니면 던진다", () => {
    expect(() =>
      parseManifest(
        {
          instrument: "piano",
          zones: [{ file: "a.wav", centerPitch: 60, loPitch: 61, hiPitch: 70 }],
        },
        "piano",
      ),
    ).toThrow();
  });

  it("구조가 틀리면 던진다", () => {
    expect(() => parseManifest("nope", "piano")).toThrow();
    expect(() => parseManifest({ instrument: "piano" }, "piano")).toThrow();
  });
});

describe("findZone", () => {
  it("pitch를 덮는 존을 고른다", () => {
    expect(findZone(ZONES, 50).file).toBe("low.wav");
    expect(findZone(ZONES, 70).file).toBe("high.wav");
    expect(findZone(ZONES, 55).file).toBe("low.wav"); // 경계 포함
    expect(findZone(ZONES, 65).file).toBe("high.wav");
  });

  it("어느 존도 덮지 않는 pitch는 범위가 가장 가까운 존을 고른다(무음으로 떨어지지 않는다)", () => {
    expect(findZone(ZONES, 10).file).toBe("low.wav"); // 아래쪽 바깥
    expect(findZone(ZONES, 120).file).toBe("high.wav"); // 위쪽 바깥
    expect(findZone(ZONES, 57).file).toBe("low.wav"); // 틈: low와 2, high와 8
    expect(findZone(ZONES, 63).file).toBe("high.wav"); // 틈: low와 8, high와 2
  });
});

describe("playbackRateFor", () => {
  it("같은 음이면 1, 한 옥타브 위면 2, 아래면 0.5다", () => {
    expect(playbackRateFor(60, 60)).toBe(1);
    expect(playbackRateFor(72, 60)).toBeCloseTo(2, 12);
    expect(playbackRateFor(48, 60)).toBeCloseTo(0.5, 12);
  });

  it("반음은 2의 12제곱근이다", () => {
    expect(playbackRateFor(61, 60)).toBeCloseTo(2 ** (1 / 12), 12);
  });
});
