import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseManifest } from "@/lib/audio/samples/manifest";
import { INSTRUMENT_IDS, type InstrumentId } from "@/lib/score/model";

const ROOT = fileURLToPath(new URL("../../../public/samples", import.meta.url));

/** 첫 재생에 필요한 샘플 총량 상한(모바일 링크 열기를 염두에 둔 값). */
const TOTAL_BUDGET_BYTES = 5 * 1024 * 1024;
/** 악기 하나의 상한. 한 악기가 예산을 독점하지 않게 한다. */
const PER_INSTRUMENT_BUDGET_BYTES = 1.5 * 1024 * 1024;

function loadManifest(instrument: InstrumentId) {
  const file = path.join(ROOT, instrument, "manifest.json");
  return {
    dir: path.join(ROOT, instrument),
    manifest: parseManifest(JSON.parse(readFileSync(file, "utf8")), instrument),
  };
}

function bytesOf(instrument: InstrumentId): number {
  const { dir, manifest } = loadManifest(instrument);
  const files = new Set(manifest.zones.map((z) => z.file));
  return [...files].reduce((sum, f) => sum + statSync(path.join(dir, f)).size, 0);
}

const readLicenses = () => readFileSync(path.join(ROOT, "LICENSES.md"), "utf8");

describe("샘플 팩", () => {
  for (const instrument of INSTRUMENT_IDS) {
    it(`${instrument}: 매니페스트가 올바르고 가리키는 파일이 모두 있다`, () => {
      const { dir, manifest } = loadManifest(instrument);
      for (const zone of manifest.zones) {
        expect(existsSync(path.join(dir, zone.file)), `${instrument}/${zone.file}`).toBe(
          true,
        );
      }
    });

    it(`${instrument}: 매니페스트에 없는 파일이 폴더에 남아 있지 않다`, () => {
      const { dir, manifest } = loadManifest(instrument);
      const expected = new Set(["manifest.json", ...manifest.zones.map((z) => z.file)]);
      expect(readdirSync(dir).filter((f) => !expected.has(f))).toEqual([]);
    });

    it(`${instrument}: 파일이 16비트 PCM 모노 22050Hz WAV다`, () => {
      const { dir, manifest } = loadManifest(instrument);
      for (const zone of manifest.zones) {
        const bytes = readFileSync(path.join(dir, zone.file));
        const label = `${instrument}/${zone.file}`;
        expect(bytes.toString("ascii", 0, 4), label).toBe("RIFF");
        expect(bytes.toString("ascii", 8, 12), label).toBe("WAVE");
        expect(bytes.toString("ascii", 12, 16), label).toBe("fmt ");
        expect(bytes.readUInt16LE(20), `${label} PCM`).toBe(1);
        expect(bytes.readUInt16LE(22), `${label} 채널`).toBe(1);
        expect(bytes.readUInt32LE(24), `${label} 샘플레이트`).toBe(22050);
        expect(bytes.readUInt16LE(34), `${label} 비트`).toBe(16);
        expect(bytes.toString("ascii", 36, 40), label).toBe("data");
        expect(44 + bytes.readUInt32LE(40), `${label} data 길이`).toBe(bytes.length);
      }
    });

    it(`${instrument}: 악기당 상한 안이다`, () => {
      expect(bytesOf(instrument)).toBeLessThanOrEqual(PER_INSTRUMENT_BUDGET_BYTES);
    });

    it(`${instrument}: LICENSES.md에 출처가 적혀 있다`, () => {
      expect(readLicenses()).toMatch(new RegExp(`^## ${instrument}\\s*$`, "m"));
    });
  }

  for (const instrument of INSTRUMENT_IDS.filter((i) => i !== "drums")) {
    it(`${instrument}: 존이 0..127을 빈틈·겹침 없이 덮는다`, () => {
      const zones = [...loadManifest(instrument).manifest.zones].sort(
        (a, b) => a.loPitch - b.loPitch,
      );
      expect(zones[0].loPitch).toBe(0);
      expect(zones[zones.length - 1].hiPitch).toBe(127);
      for (let i = 1; i < zones.length; i++) {
        expect(zones[i].loPitch, zones[i].file).toBe(zones[i - 1].hiPitch + 1);
      }
    });
  }

  it("drums: GM 킥·스네어·닫힌 하이햇이 한 음씩이다", () => {
    const zones = loadManifest("drums").manifest.zones;
    expect(zones.map((z) => [z.centerPitch, z.loPitch, z.hiPitch])).toEqual([
      [36, 36, 36],
      [38, 38, 38],
      [42, 42, 42],
    ]);
  });

  it("첫 재생에 필요한 총량이 예산 안이다", () => {
    const total = INSTRUMENT_IDS.reduce((sum, i) => sum + bytesOf(i), 0);
    expect(total).toBeLessThanOrEqual(TOTAL_BUDGET_BYTES);
  });

  it("LICENSES.md의 모든 라이선스 줄이 CC0 또는 퍼블릭 도메인이다", () => {
    const lines = readLicenses()
      .split(/\r?\n/)
      .filter((l) => /^- 라이선스:/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(INSTRUMENT_IDS.length);
    for (const line of lines) {
      expect(line).toMatch(/CC0|퍼블릭 도메인|Public Domain/i);
    }
  });
});
