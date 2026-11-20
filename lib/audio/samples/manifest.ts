import { z } from "zod";

import { INSTRUMENT_IDS, type InstrumentId } from "@/lib/score/model";

/**
 * 악기 하나의 샘플 목록. `public/samples/<instrument>/manifest.json`이 이
 * 모양이다. 건반마다 샘플을 두지 않고 몇 음 간격으로만 두고, 사이 음은
 * 재생 속도로 음높이를 보정한다.
 */
export type SampleZone = {
  /** manifest.json 기준 상대 경로. */
  file: string;
  /** 샘플이 녹음된 음(MIDI). 이 음에서는 재생 속도가 1이다. */
  centerPitch: number;
  loPitch: number;
  hiPitch: number;
};

export type SampleManifest = {
  instrument: InstrumentId;
  zones: SampleZone[];
};

const midi = z.number().int().min(0).max(127);

const zoneSchema = z
  .object({
    file: z.string().min(1),
    centerPitch: midi,
    loPitch: midi,
    hiPitch: midi,
  })
  .refine((z) => z.loPitch <= z.centerPitch && z.centerPitch <= z.hiPitch, {
    message: "loPitch <= centerPitch <= hiPitch 여야 합니다",
  });

const manifestSchema = z.object({
  instrument: z.enum(INSTRUMENT_IDS),
  zones: z.array(zoneSchema).min(1),
});

export function parseManifest(
  input: unknown,
  expected: InstrumentId,
): SampleManifest {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `${expected} 매니페스트가 올바르지 않습니다: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  if (parsed.data.instrument !== expected) {
    throw new Error(
      `매니페스트의 악기(${parsed.data.instrument})가 요청한 악기(${expected})와 다릅니다`,
    );
  }
  return parsed.data;
}

/**
 * pitch를 덮는 존을 고른다. 어느 존도 덮지 않으면 존의 범위까지 거리가
 * 가장 가까운 존을 돌려준다 — 범위 밖의 음이 조용히 무음이 되는 일이 없게
 * 한다. 거리가 같으면 목록에서 앞선 존이다.
 */
export function findZone(
  zones: readonly SampleZone[],
  pitch: number,
): SampleZone {
  let best = zones[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const zone of zones) {
    const distance =
      pitch < zone.loPitch
        ? zone.loPitch - pitch
        : pitch > zone.hiPitch
          ? pitch - zone.hiPitch
          : 0;
    if (distance < bestDistance) {
      best = zone;
      bestDistance = distance;
    }
  }
  return best;
}

export function playbackRateFor(pitch: number, centerPitch: number): number {
  return 2 ** ((pitch - centerPitch) / 12);
}
