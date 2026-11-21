import type { InstrumentId } from "@/lib/score/model";

/** 화면에 보이는 악기 이름. */
export const INSTRUMENT_LABEL: Record<InstrumentId, string> = {
  piano: "피아노",
  guitar: "기타",
  bass: "베이스",
  drums: "드럼",
};

/** 트랙 헤더 점 색. Tailwind가 찾도록 클래스 전체를 적는다. */
export const INSTRUMENT_DOT: Record<InstrumentId, string> = {
  piano: "bg-indigo-500",
  guitar: "bg-emerald-500",
  bass: "bg-amber-500",
  drums: "bg-rose-500",
};
