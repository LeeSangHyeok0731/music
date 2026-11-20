import { describe, expect, it } from "vitest";

import {
  cropFromOnset,
  decodeWav16,
  encodeWav16,
  estimatePitch,
  fadeOut,
  midiToFreq,
  resample,
} from "./dsp.mjs";
import { assertCc0LicenseText, assertCc0Spdx } from "./license.mjs";

const CC0_HEAD = "Creative Commons Legal Code\n\nCC0 1.0 Universal\n\n    CREATIVE COMMONS CORPORATION IS NOT A LAW FIRM";

describe("라이선스 확인", () => {
  it("CC0 1.0 Universal 본문은 통과한다(LF·CRLF·BOM)", () => {
    expect(() => assertCc0LicenseText(CC0_HEAD, "x")).not.toThrow();
    expect(() =>
      assertCc0LicenseText(`﻿${CC0_HEAD.replace(/\n/g, "\r\n")}`, "x"),
    ).not.toThrow();
  });

  it("다른 라이선스 본문이면 빌드를 멈춘다", () => {
    expect(() =>
      assertCc0LicenseText("MIT License\n\nCopyright (c) 2020", "owner/repo"),
    ).toThrow(/owner\/repo: LICENSE가 CC0 1.0 Universal이 아닙니다/);
    expect(() =>
      assertCc0LicenseText(
        "Creative Commons Legal Code\n\nAttribution 4.0 International",
        "x",
      ),
    ).toThrow(/CC0 1.0 Universal이 아닙니다/);
    expect(() => assertCc0LicenseText("", "x")).toThrow();
  });

  it("SPDX가 CC0-1.0이 아니면 멈춘다", () => {
    expect(() => assertCc0Spdx("CC0-1.0\n", "x")).not.toThrow();
    expect(() => assertCc0Spdx("CC-BY-4.0", "x")).toThrow(/SPDX가 CC0-1.0이 아닙니다/);
    expect(() => assertCc0Spdx("NOASSERTION", "x")).toThrow();
  });
});

function sine(freq: number, rate: number, seconds: number, amp = 0.5) {
  const n = Math.round(rate * seconds);
  return Float64Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));
}

function rmsOf(x: ArrayLike<number>, from: number, to: number) {
  let sq = 0;
  for (let i = from; i < to; i++) sq += x[i] * x[i];
  return Math.sqrt(sq / (to - from));
}

describe("재샘플링", () => {
  for (const inRate of [44100, 48000]) {
    it(`${inRate}Hz → 22050Hz: 통과대역은 보존하고 나이퀴스트 위는 걸러 낸다`, () => {
      const pass = resample(sine(1000, inRate, 0.5), inRate, 22050);
      // 13kHz는 22050Hz에서 9.05kHz로 접혀 들어온다(에일리어싱) — 걸러져야 한다.
      const alias = resample(sine(13000, inRate, 0.5), inRate, 22050);
      const mid = [2000, pass.length - 2000] as const;
      expect(pass.length).toBe(11025);
      expect(rmsOf(pass, ...mid)).toBeCloseTo(0.5 / Math.SQRT2, 2);
      expect(rmsOf(alias, ...mid)).toBeLessThan(0.5 / Math.SQRT2 / 1000); // -60dB 이하
    });
  }

  it("음높이를 바꾸지 않는다", () => {
    const out = resample(sine(midiToFreq(57), 48000, 1), 48000, 22050);
    const { median } = estimatePitch(out, 22050, 57);
    expect(Math.abs(median.cents)).toBeLessThan(2);
  });
});

describe("자르기·페이드·WAV", () => {
  it("온셋 5ms 앞에서 시작하고 끝은 정확히 0으로 줄인다", () => {
    const rate = 1000;
    const x = new Float64Array(2000);
    for (let i = 300; i < 2000; i++) x[i] = 1;
    const { samples, start } = cropFromOnset(x, rate, 1);
    expect(start).toBe(295);
    expect(samples[4]).toBe(0);
    expect(samples[5]).toBe(1);
    fadeOut(samples, rate, 100);
    expect(samples[samples.length - 1]).toBe(0);
    expect(samples[samples.length - 101]).toBe(1);
  });

  it("16비트 PCM 모노 WAV로 쓰고 다시 읽는다", () => {
    const wav = decodeWav16(encodeWav16([0, 0.5, -0.5, 1, -1], 22050));
    expect(wav).toMatchObject({ format: 1, channels: 1, rate: 22050, bits: 16 });
    expect(Array.from(wav.ints)).toEqual([0, 16384, -16383, 32767, -32767]);
  });
});
