import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseManifest } from "@/lib/audio/samples/manifest";
import { INSTRUMENT_IDS, type InstrumentId } from "@/lib/score/model";
import { decodeWav16, estimatePitch, measure } from "@/scripts/sample-pack/dsp.mjs";

/**
 * 커밋된 샘플 팩의 객관 지표(귀 대신). 소리가 좋은지는 증명하지 않는다 — 파일
 * 오매핑(옥타브·샵/플랫 혼동), 잘림·클리핑·끝 클릭 같은 가공 실수를 잡는다.
 */
const ROOT = fileURLToPath(new URL("../../../public/samples", import.meta.url));
const RATE = 22050;
const PITCH_TOLERANCE_CENTS = 50;

function zonesOf(instrument: InstrumentId) {
  const dir = path.join(ROOT, instrument);
  const manifest = parseManifest(
    JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")),
    instrument,
  );
  return manifest.zones.map((zone) => ({
    zone,
    wav: decodeWav16(readFileSync(path.join(dir, zone.file))),
  }));
}

describe("샘플 팩 내용", () => {
  for (const instrument of INSTRUMENT_IDS) {
    for (const { zone, wav } of zonesOf(instrument)) {
      const label = `${instrument}/${zone.file}`;

      it(`${label}: 길이·피크·클리핑·직류·온셋·끝 페이드`, () => {
        const m = measure(wav.samples, wav.ints, RATE);
        expect(m.seconds).toBeGreaterThanOrEqual(0.25);
        expect(m.seconds).toBeLessThanOrEqual(3);
        expect(m.clipped).toBe(0);
        expect(m.peak).toBeLessThanOrEqual(0.86);
        expect(Math.abs(m.dc)).toBeLessThan(1e-3);
        // 온셋 정렬: 소리가 파일 시작 10ms 안에서 시작한다(앞 무음이 박자를 늦추지 않는다).
        expect(m.firstMs).toBeLessThan(10);
        // 끝 페이드: 마지막 10ms가 거의 0이고 마지막 샘플은 0이다.
        expect(m.tailMean).toBeLessThan(1e-3);
        expect(wav.ints[wav.ints.length - 1]).toBe(0);
        if (instrument !== "drums") expect(m.peak).toBeGreaterThanOrEqual(0.84);
      });

      if (instrument === "drums") continue;

      // 존 중심 음에서 ±50센트. 세 창(첫 유효 샘플 뒤 0.15·0.3·0.5s)의 중앙값으로
      // 판정한다. 허용 규칙: 창 하나가 YIN의 흔한 옥타브 오류(±1200센트)를 내는 것은
      // 받아들인다(피아노 C2가 실제로 그렇다) — 나머지 둘은 ±50센트 안이어야 한다.
      it(`${label}: 기본 주파수가 centerPitch(${zone.centerPitch})와 ±${PITCH_TOLERANCE_CENTS}센트 안이다`, () => {
        const { median, estimates } = estimatePitch(wav.samples, RATE, zone.centerPitch);
        expect(Math.abs(median.cents), `중앙값 ${median.cents.toFixed(1)}c`).toBeLessThanOrEqual(
          PITCH_TOLERANCE_CENTS,
        );
        const inTune = estimates.filter((e) => Math.abs(e.cents) <= PITCH_TOLERANCE_CENTS);
        const octaveSlips = estimates.filter(
          (e) => Math.abs(Math.abs(e.cents) - 1200) <= PITCH_TOLERANCE_CENTS,
        );
        expect(inTune.length + octaveSlips.length, "창별 추정").toBe(estimates.length);
        expect(octaveSlips.length).toBeLessThanOrEqual(1);
      });
    }
  }

  it("drums: 세 소리에 같은 게인을 써서 가장 큰 피크가 0.85다", () => {
    const peaks = zonesOf("drums").map(({ wav }) => measure(wav.samples, wav.ints, RATE).peak);
    expect(Math.max(...peaks)).toBeGreaterThanOrEqual(0.84);
    expect(Math.max(...peaks)).toBeLessThanOrEqual(0.86);
    for (const peak of peaks) expect(peak).toBeGreaterThan(0.05);
  });
});
