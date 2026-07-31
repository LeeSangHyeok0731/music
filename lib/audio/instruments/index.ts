"use client";

import type { InstrumentId } from "@/lib/score/types";

import type { Instrument } from "../types";
import type { VoicePool } from "../voices";
import { createBass } from "./bass";
import { createDrums } from "./drums";
import { createGuitar } from "./guitar";
import { createPiano } from "./piano";

export function createInstrument(
  id: InstrumentId,
  ctx: AudioContext,
  pool: VoicePool,
): Instrument {
  switch (id) {
    case "piano":
      return createPiano(ctx, pool);
    case "guitar":
      return createGuitar(ctx, pool);
    case "bass":
      return createBass(ctx, pool);
    case "drums":
      return createDrums(ctx, pool);
  }
}
