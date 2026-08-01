import { describe, expect, it } from "vitest";

import { createInstrument } from "@/lib/audio/instruments";
import {
  FakeAudioContext,
  FakeAudioNode,
  asAudioContext,
  asAudioNode,
} from "@/lib/audio/testing/fake-audio";
import { DRUM_KICK, type InstrumentId } from "@/lib/score/types";
import { VoicePool } from "@/lib/audio/voices";

/**
 * 악기 하나를 진짜 VoicePool에 물려 만든다. 풀까지 진짜를 쓰는 이유는,
 * 여기서 보려는 것이 "악기가 만든 노드가 결국 회수되는가"이고 그 경로에
 * 풀이 끼어 있기 때문이다.
 */
function setup(id: InstrumentId) {
  const ctx = new FakeAudioContext();
  const out = new FakeAudioNode("master");
  const pool = new VoicePool(asAudioContext(ctx), asAudioNode(out));
  const instrument = createInstrument(id, asAudioContext(ctx), pool);
  return { ctx, instrument };
}

function nodesOfKind(ctx: FakeAudioContext, kind: string): FakeAudioNode[] {
  return ctx.created.filter((node) => node.kind === kind);
}

describe("악기 노드 회수", () => {
  // 노드 누수는 이 프로젝트가 최상위 실패 모드로 지목한 항목이다
  // (.claude/rules/audio-engine.md). 긴 곡에서 수천 개가 쌓이면 메모리와
  // CPU가 새고, 증상은 "처음엔 괜찮은데 몇 분 지나면 이상해짐"으로 나타나
  // 원인을 찾기 어렵다.
  const cases: InstrumentId[] = ["piano", "guitar", "bass", "drums"];

  for (const id of cases) {
    it(`${id}: 소리가 끝나면 만든 노드를 전부 회수한다`, () => {
      const { ctx, instrument } = setup(id);

      instrument.play(id === "drums" ? DRUM_KICK : 60, 0, 0.5, 0.7);

      const created = ctx.created.filter((node) => node.kind !== "gain");
      expect(created.length).toBeGreaterThan(0);

      // 엔벨로프와 stop 예약이 모두 지나도록 넉넉히 굴린다
      ctx.advanceTo(10);

      for (const node of created) {
        expect(
          node.isDisconnected,
          `${id}의 ${node.kind} 노드가 회수되지 않았다`,
        ).toBe(true);
      }
    });
  }
});

describe("기타의 공유 필터", () => {
  it("두 오실레이터가 모두 끝난 뒤에 필터를 끊는다", () => {
    // 기타는 디튠된 오실레이터 두 개가 필터 하나를 공유한다. 각 오실레이터의
    // onended에서 곧바로 필터를 끊으면, 먼저 끝난 쪽이 아직 울리는 다른
    // 오실레이터의 출력 경로까지 잘라 소리가 중간에 사라진다.
    const { ctx, instrument } = setup("guitar");

    instrument.play(60, 0, 0.5, 0.7);

    const oscillators = nodesOfKind(ctx, "oscillator");
    const filters = nodesOfKind(ctx, "biquadFilter");

    expect(oscillators).toHaveLength(2);
    expect(filters).toHaveLength(1);
    const filter = filters[0];

    // 한쪽만 끝난 상태를 만든다
    (
      oscillators[0] as unknown as { onended: (() => void) | null }
    ).onended?.();

    expect(
      filter.isDisconnected,
      "오실레이터 하나가 아직 울리는데 공유 필터를 끊었다",
    ).toBe(false);

    // 나머지 하나까지 끝나면 그때 끊는다
    (
      oscillators[1] as unknown as { onended: (() => void) | null }
    ).onended?.();

    expect(filter.disconnectCount).toBe(1);
  });
});
