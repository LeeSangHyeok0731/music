import type { InstrumentId } from "@/lib/score/model";

import type {
  Decoder,
  SampleHit,
  SamplePort,
  SampleReadiness,
} from "../samples/bank";

/**
 * 엔진 테스트용 뱅크. 네트워크도 디코드도 없이 "준비됨/실패/아직"만 조절한다.
 *
 * - `failing`에 든 악기는 ensureReady가 실패로 돌려준다.
 * - `gate`를 세우면 ensureReady가 그 약속이 풀릴 때까지 기다린다. 샘플을
 *   기다리는 창 안에서 stop()이 끼어드는 레이스를 손으로 재현하는 데 쓴다.
 */
export class FakeSampleBank implements SamplePort {
  readonly prefetched: InstrumentId[][] = [];
  readonly readyCalls: InstrumentId[][] = [];
  readonly failing = new Set<InstrumentId>();
  gate: Promise<void> | null = null;

  prefetch(instruments: readonly InstrumentId[]): void {
    this.prefetched.push([...instruments]);
  }

  async ensureReady(
    _ctx: Decoder,
    instruments: readonly InstrumentId[],
  ): Promise<SampleReadiness> {
    this.readyCalls.push([...instruments]);
    if (this.gate) await this.gate;
    const failed = instruments.filter((i) => this.failing.has(i));
    return failed.length === 0 ? { ok: true } : { ok: false, failed };
  }

  zoneFor(): SampleHit {
    // 샘플 길이는 0.5초로 고정한다. 드럼 한 번 치기의 여운 계산에 쓰인다.
    return { buffer: { duration: 0.5 } as unknown as AudioBuffer, rate: 1 };
  }
}
