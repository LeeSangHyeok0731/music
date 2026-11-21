"use client";

import type { SampleStatus as Status } from "@/lib/audio/samples/bank";
import { INSTRUMENT_IDS } from "@/lib/score/model";
import { useStudio } from "@/state/useStudio";

import { INSTRUMENT_LABEL } from "./instruments";

const STATUS_LABEL: Record<Status, string> = {
  idle: "대기",
  loading: "불러오는 중",
  downloaded: "받음 (재생 때 마무리)",
  ready: "준비됨",
  error: "실패",
};

/** 악기별 샘플 준비 상태. 실패한 악기에는 다시 받기 버튼이 붙는다. */
export function SampleStatus() {
  const { sampleStatuses, retrySamples } = useStudio();
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {INSTRUMENT_IDS.map((id) => (
        <li key={id} className="flex items-center gap-1.5">
          <span className="text-zinc-200">{INSTRUMENT_LABEL[id]}</span>
          <span className="text-zinc-400">{STATUS_LABEL[sampleStatuses[id]]}</span>
          {sampleStatuses[id] === "error" && (
            <button
              type="button"
              aria-label={`${INSTRUMENT_LABEL[id]} 다시 시도`}
              onClick={() => retrySamples(id)}
              className="rounded border border-white/20 px-1.5 py-0.5 text-zinc-200 hover:bg-white/10"
            >
              다시 시도
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
