"use client";

import type { InstrumentId } from "@/lib/score/model";

import type { SamplePort } from "../samples/bank";
import type { Instrument } from "../types";
import type { VoicePool } from "../voices";
import { createSampler } from "./sampler";

export function createInstrument(
  id: InstrumentId,
  ctx: AudioContext,
  pool: VoicePool,
  bank: SamplePort,
): Instrument {
  return createSampler(id, ctx, pool, bank);
}
