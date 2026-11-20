import { describe, expect, it } from "vitest";

import { SampleBank, type SampleReadiness } from "@/lib/audio/samples/bank";
import {
  FakeAudioContext,
  asAudioContext,
  type DecodedInput,
} from "@/lib/audio/testing/fake-audio";

const enc = (text: string): ArrayBuffer =>
  new TextEncoder().encode(text).buffer as ArrayBuffer;

type ZoneJson = {
  file: string;
  centerPitch: number;
  loPitch: number;
  hiPitch: number;
};

const DEFAULT_ZONES: ZoneJson[] = [
  { file: "c4.wav", centerPitch: 60, loPitch: 55, hiPitch: 64 },
  { file: "c5.wav", centerPitch: 72, loPitch: 65, hiPitch: 79 },
];

const manifestFor = (instrument: string, zones: ZoneJson[] = DEFAULT_ZONES) =>
  JSON.stringify({ instrument, zones });

/**
 * 실제 네트워크 없이 url → 바이트를 돌려주는 fetch. failing에 든 url은 실패한다.
 * 부를 때마다 새 ArrayBuffer를 만들고, url마다 마지막으로 내준 것을 `served`에 둔다.
 */
function makeBank(failingUrls: string[] = [], zones: ZoneJson[] = DEFAULT_ZONES) {
  const calls: string[] = [];
  const served = new Map<string, ArrayBuffer>();
  const failing = new Set(failingUrls);
  const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
    calls.push(url);
    if (failing.has(url)) throw new Error(`404 ${url}`);
    const match = /^\/samples\/([a-z]+)\/(.+)$/.exec(url)!;
    const bytes =
      match[2] === "manifest.json"
        ? enc(manifestFor(match[1], zones))
        : enc(`bytes:${url}`);
    served.set(url, bytes);
    return bytes;
  };
  return {
    bank: new SampleBank({ baseUrl: "/samples", fetchBytes }),
    calls,
    served,
    failing,
  };
}

/** 가짜 디코더가 받은 바이트를 글자로 — 무엇을 디코드했는지 본다. */
const decodedText = (inputs: readonly DecodedInput[]) =>
  inputs.map((d) => new TextDecoder().decode(d.bytes));

/** 이미 끝난 약속들이 마저 정리되도록 한 번 양보한다. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * 뱅크 테스트가 기대는 가짜의 성질. 가짜가 실제보다 관대하면 뱅크 테스트가
 * 브라우저에서 깨질 구현을 통과시킨다.
 */
describe("테스트 가짜(FakeAudioContext)의 충실도", () => {
  it("decodeAudioData는 받은 바이트를 분리하고, 같은 바이트를 다시 받으면 거부한다", async () => {
    const ctx = new FakeAudioContext();
    const bytes = enc("abc");

    await ctx.decodeAudioData(bytes);

    expect(bytes.byteLength).toBe(0); // 분리됐다
    expect(ctx.decoded[0].byteLength).toBe(3); // 분리 전 크기는 남는다
    await expect(ctx.decodeAudioData(bytes)).rejects.toThrow("분리");
    expect(ctx.decoded).toHaveLength(1);
  });

  it("decodeAudioData가 실패해도 바이트는 분리된다(실제 브라우저처럼)", async () => {
    const ctx = new FakeAudioContext();
    ctx.failDecode = true;
    const bytes = enc("abc");

    await expect(ctx.decodeAudioData(bytes)).rejects.toThrow("decode 실패");
    expect(bytes.byteLength).toBe(0);
  });

  // 샘플러 테스트(이후 Task)가 기대는 성질. 가짜 전용 테스트 파일이 없어 여기 둔다.
  it("버퍼 소스의 playbackRate는 실제 노드처럼 1에서 시작한다", () => {
    const ctx = new FakeAudioContext();
    expect(ctx.createBufferSource().playbackRate.value).toBe(1);
  });
});

describe("SampleBank — 컨텍스트 없는 fetch", () => {
  it("prefetch는 컨텍스트 없이 매니페스트와 모든 존 파일을 받는다", async () => {
    const { bank, calls } = makeBank();
    bank.prefetch(["piano"]);

    expect(bank.status("piano")).toBe("loading");
    await settle();

    expect(calls).toEqual([
      "/samples/piano/manifest.json",
      "/samples/piano/c4.wav",
      "/samples/piano/c5.wav",
    ]);
    // 컨텍스트가 없어 디코드는 못 했다 — 받았다는 사실만 알린다
    expect(bank.status("piano")).toBe("downloaded");
  });

  it("같은 악기를 두 번 prefetch해도 한 번만 받는다", async () => {
    const { bank, calls } = makeBank();
    bank.prefetch(["piano"]);
    bank.prefetch(["piano"]);
    await settle();
    expect(calls.filter((u) => u.endsWith("manifest.json"))).toHaveLength(1);
  });

  it("enabled: false면 prefetch는 아무것도 받지 않고 상태도 바꾸지 않는다 (서버 렌더링)", async () => {
    const calls: string[] = [];
    const bank = new SampleBank({
      baseUrl: "/samples",
      fetchBytes: async (url) => {
        calls.push(url);
        return enc("x");
      },
      enabled: false,
    });

    bank.prefetch(["piano", "drums"]);
    await settle();

    expect(calls).toEqual([]);
    expect(bank.status("piano")).toBe("idle");
  });

  it("enabled: false여도 ensureReady는 받는다 (클라이언트의 재생 시점)", async () => {
    const calls: string[] = [];
    const bank = new SampleBank({
      baseUrl: "/samples",
      fetchBytes: async (url) => {
        calls.push(url);
        const m = /^\/samples\/([a-z]+)\/(.+)$/.exec(url)!;
        return m[2] === "manifest.json" ? enc(manifestFor(m[1])) : enc("x");
      },
      enabled: false,
    });

    const result = await bank.ensureReady(
      asAudioContext(new FakeAudioContext()),
      ["piano"],
    );

    expect(result).toEqual({ ok: true });
    expect(calls.length).toBeGreaterThan(0);
  });

  it("받기 전에는 zoneFor가 null이다", async () => {
    const { bank } = makeBank();
    expect(bank.zoneFor("piano", 60)).toBeNull();
    bank.prefetch(["piano"]);
    await settle();
    expect(bank.zoneFor("piano", 60)).toBeNull(); // downloaded는 아직 소리를 못 낸다
  });
});

describe("SampleBank — decode와 준비", () => {
  it("ensureReady가 존 파일마다 한 번씩 디코드하고 ready가 된다", async () => {
    const { bank } = makeBank();
    const ctx = new FakeAudioContext();

    const result = await bank.ensureReady(asAudioContext(ctx), ["piano"]);

    expect(result).toEqual({ ok: true });
    expect(ctx.decoded).toHaveLength(2);
    expect(bank.status("piano")).toBe("ready");
  });

  it("prefetch 없이 ensureReady만 불러도 받고 디코드한다", async () => {
    const { bank, calls } = makeBank();
    const ctx = new FakeAudioContext();
    await bank.ensureReady(asAudioContext(ctx), ["drums"]);
    expect(calls[0]).toBe("/samples/drums/manifest.json");
    expect(bank.status("drums")).toBe("ready");
  });

  it("zoneFor가 존을 고르고 재생 속도를 계산한다", async () => {
    const { bank } = makeBank();
    await bank.ensureReady(asAudioContext(new FakeAudioContext()), ["piano"]);

    expect(bank.zoneFor("piano", 60)?.rate).toBe(1);
    expect(bank.zoneFor("piano", 72)?.rate).toBe(1);
    // 66은 c5 존(65~79) — 중심 72에서 6반음 아래
    expect(bank.zoneFor("piano", 66)?.rate).toBeCloseTo(2 ** (-6 / 12), 12);
    expect(bank.zoneFor("piano", 60)?.buffer).toBeDefined();
  });

  it("동시에 두 번 불러도 디코드는 한 번만 하고, 둘 다 디코드가 끝난 뒤에 풀린다", async () => {
    const { bank } = makeBank();
    const ctx = new FakeAudioContext();
    const dec = asAudioContext(ctx);

    const first = bank.ensureReady(dec, ["piano"]);
    const second = bank.ensureReady(dec, ["piano"]).then((result) => ({
      result,
      status: bank.status("piano"),
      decodedSoFar: ctx.decoded.length,
    }));
    const [a, b] = await Promise.all([first, second]);

    expect(a).toEqual({ ok: true });
    expect(b.result).toEqual({ ok: true });
    // 두 번째 호출은 진행 중인 디코드에 합류했다 — 그게 끝나기 전에 풀리지 않는다
    expect(b.status).toBe("ready");
    expect(b.decodedSoFar).toBe(2);

    expect(await bank.ensureReady(dec, ["piano"])).toEqual({ ok: true }); // 이미 ready
    expect(decodedText(ctx.decoded)).toEqual([
      "bytes:/samples/piano/c4.wav",
      "bytes:/samples/piano/c5.wav",
    ]);
  });

  it("prefetch로 받아 둔 바이트를 ensureReady가 다시 받지 않고 그대로 디코드한다", async () => {
    const { bank, calls, served } = makeBank();
    bank.prefetch(["piano"]);
    await settle();
    expect(bank.status("piano")).toBe("downloaded");
    const callsAfterPrefetch = [...calls];

    const ctx = new FakeAudioContext();
    expect(await bank.ensureReady(asAudioContext(ctx), ["piano"])).toEqual({
      ok: true,
    });

    expect(calls).toEqual(callsAfterPrefetch); // 추가 다운로드 없음
    expect(ctx.decoded).toHaveLength(2);
    expect(ctx.decoded[0].buffer).toBe(served.get("/samples/piano/c4.wav"));
    expect(ctx.decoded[1].buffer).toBe(served.get("/samples/piano/c5.wav"));
    expect(bank.status("piano")).toBe("ready");
  });

  it("매니페스트가 같은 파일을 두 존에 적어도 한 번만 받고 디코드하며, 두 존 다 소리를 낸다", async () => {
    const { bank, calls } = makeBank([], [
      { file: "shared.wav", centerPitch: 60, loPitch: 55, hiPitch: 64 },
      { file: "shared.wav", centerPitch: 72, loPitch: 65, hiPitch: 79 },
    ]);
    const ctx = new FakeAudioContext();

    expect(await bank.ensureReady(asAudioContext(ctx), ["piano"])).toEqual({
      ok: true,
    });

    expect(calls.filter((u) => u.endsWith("/shared.wav"))).toHaveLength(1);
    expect(ctx.decoded).toHaveLength(1);
    const low = bank.zoneFor("piano", 60);
    const high = bank.zoneFor("piano", 72);
    expect(low?.rate).toBe(1);
    expect(high?.rate).toBe(1);
    expect(low?.buffer).toBeDefined();
    expect(high?.buffer).toBe(low?.buffer);
  });
});

describe("SampleBank — 재진입", () => {
  it("loading 알림 안에서 구독자가 다시 prefetch·ensureReady를 불러도 한 번만 받고 한 번만 디코드한다", async () => {
    const { bank, calls } = makeBank();
    const ctx = new FakeAudioContext();
    const dec = asAudioContext(ctx);

    let inner: Promise<SampleReadiness> | null = null;
    bank.subscribe(() => {
      // 첫 loading 알림에서 한 번만, 동기로 뱅크를 다시 부른다
      if (inner === null && bank.getSnapshot().piano === "loading") {
        bank.prefetch(["piano"]);
        inner = bank.ensureReady(dec, ["piano"]);
      }
    });

    const outer = await bank.ensureReady(dec, ["piano"]);
    await settle();

    expect(inner).not.toBeNull();
    expect(outer).toEqual({ ok: true });
    expect(await inner).toEqual({ ok: true });
    expect(calls.filter((u) => u.endsWith("manifest.json"))).toHaveLength(1);
    expect(decodedText(ctx.decoded)).toEqual([
      "bytes:/samples/piano/c4.wav",
      "bytes:/samples/piano/c5.wav",
    ]);
    expect(bank.status("piano")).toBe("ready");
    expect(bank.zoneFor("piano", 60)).not.toBeNull();
  });

  it("디코드 error 알림 안에서 구독자가 ensureReady를 부르면 죽어 가는 디코드에 합류하지 않고 새로 재시도한다", async () => {
    const { bank, calls } = makeBank();
    const ctx = new FakeAudioContext();
    const dec = asAudioContext(ctx);
    ctx.failDecode = true;

    let retry: Promise<SampleReadiness> | null = null;
    bank.subscribe(() => {
      // 첫 error 알림에서 한 번만, 동기로 다시 부른다. 이 순간 실패한 디코드의
      // 약속은 아직 항목에 걸려 있다(finally 전) — 거기 합류하면 재시도 없이 실패한다.
      if (retry === null && bank.getSnapshot().piano === "error") {
        ctx.failDecode = false;
        retry = bank.ensureReady(dec, ["piano"]);
      }
    });

    const outer = await bank.ensureReady(dec, ["piano"]);
    expect(outer).toEqual({ ok: false, failed: ["piano"] });
    expect(retry).not.toBeNull();
    // 바깥 호출은 재시도가 끝나기 전에 풀리므로 재시도를 기다린 뒤에 상태를 본다
    expect(await retry).toEqual({ ok: true });

    expect(bank.status("piano")).toBe("ready");
    expect(bank.zoneFor("piano", 60)).not.toBeNull();
    // 디코드가 바이트를 분리했으므로 재시도는 다시 받아야 한다
    expect(calls.filter((u) => u.endsWith("manifest.json"))).toHaveLength(2);
    expect(decodedText(ctx.decoded)).toEqual([
      "bytes:/samples/piano/c4.wav", // 실패한 첫 시도
      "bytes:/samples/piano/c4.wav",
      "bytes:/samples/piano/c5.wav",
    ]);
  });
});

describe("SampleBank — 실패와 재시도", () => {
  it("파일 하나가 실패하면 그 악기만 failed이고 error 상태다", async () => {
    const { bank } = makeBank(["/samples/piano/c5.wav"]);
    const ctx = asAudioContext(new FakeAudioContext());

    const result = await bank.ensureReady(ctx, ["piano", "drums"]);

    expect(result).toEqual({ ok: false, failed: ["piano"] });
    expect(bank.status("piano")).toBe("error");
    expect(bank.status("drums")).toBe("ready"); // 다른 악기는 영향받지 않는다
  });

  it("실패 뒤 다시 부르면 실제로 재시도된다", async () => {
    const { bank, failing } = makeBank(["/samples/piano/c5.wav"]);
    const ctx = asAudioContext(new FakeAudioContext());

    expect((await bank.ensureReady(ctx, ["piano"])).ok).toBe(false);
    failing.clear();

    expect(await bank.ensureReady(ctx, ["piano"])).toEqual({ ok: true });
    expect(bank.status("piano")).toBe("ready");
  });

  it("prefetch도 error 상태에서 다시 받는다", async () => {
    const { bank, failing, calls } = makeBank(["/samples/piano/manifest.json"]);
    bank.prefetch(["piano"]);
    await settle();
    expect(bank.status("piano")).toBe("error");

    failing.clear();
    bank.prefetch(["piano"]);
    await settle();

    expect(bank.status("piano")).toBe("downloaded");
    expect(calls.filter((u) => u.endsWith("manifest.json"))).toHaveLength(2);
  });

  it("디코드가 실패하면 failed이고, 고친 뒤 다시 부르면 된다", async () => {
    const { bank, calls } = makeBank();
    const ctx = new FakeAudioContext();
    ctx.failDecode = true;

    expect(await bank.ensureReady(asAudioContext(ctx), ["piano"])).toEqual({
      ok: false,
      failed: ["piano"],
    });
    expect(bank.status("piano")).toBe("error");
    // 첫 파일(c4)에서 멈췄다. 그 바이트는 이미 분리됐다.
    expect(ctx.decoded).toHaveLength(1);
    const firstAttempt = ctx.decoded[0].buffer;

    ctx.failDecode = false;
    // 디코드는 넘긴 바이트를 분리하므로, 재시도는 반드시 다시 받아야 한다 —
    // 옛 바이트를 다시 넘기면 실제 브라우저(와 가짜)가 거부한다.
    expect(await bank.ensureReady(asAudioContext(ctx), ["piano"])).toEqual({
      ok: true,
    });
    expect(bank.status("piano")).toBe("ready");
    expect(calls).toEqual([
      "/samples/piano/manifest.json",
      "/samples/piano/c4.wav",
      "/samples/piano/c5.wav",
      "/samples/piano/manifest.json",
      "/samples/piano/c4.wav",
      "/samples/piano/c5.wav",
    ]);
    const retry = ctx.decoded.slice(1);
    expect(decodedText(retry)).toEqual([
      "bytes:/samples/piano/c4.wav",
      "bytes:/samples/piano/c5.wav",
    ]);
    expect(retry.map((d) => d.buffer)).not.toContain(firstAttempt);
  });

  it("깨진 매니페스트는 error다", async () => {
    const bank = new SampleBank({
      baseUrl: "/samples",
      fetchBytes: async () => enc("not json"),
    });
    const result = await bank.ensureReady(
      asAudioContext(new FakeAudioContext()),
      ["piano"],
    );
    expect(result).toEqual({ ok: false, failed: ["piano"] });
  });
});

describe("SampleBank — 구독", () => {
  it("구독자는 loading → downloaded → ready를 정확히 그 순서로 한 번씩 본다", async () => {
    const { bank } = makeBank();
    const seen: string[] = [];
    const unsubscribe = bank.subscribe(() => {
      seen.push(bank.getSnapshot().piano);
    });
    const before = bank.getSnapshot();
    expect(before.piano).toBe("idle");

    await bank.ensureReady(asAudioContext(new FakeAudioContext()), ["piano"]);

    // 중복을 걸러내지 않는다: publish는 상태가 실제로 바뀔 때만 알리고, 이
    // 테스트에서 움직이는 악기는 piano뿐이라 알림마다 piano가 바뀌어 있어야 한다.
    expect(seen).toEqual(["loading", "downloaded", "ready"]);
    const after = bank.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.piano).toBe("ready");

    unsubscribe();
    bank.prefetch(["drums"]);
    await settle();
    expect(seen).toHaveLength(3); // 구독을 끊은 뒤에는 안 부른다
  });

  it("상태가 안 바뀌면 같은 스냅샷 참조를 돌려준다(useSyncExternalStore 계약)", async () => {
    const { bank } = makeBank();
    bank.prefetch(["piano"]);
    const loading = bank.getSnapshot();
    expect(loading.piano).toBe("loading");

    bank.prefetch(["piano"]); // 이미 받는 중 — 바뀌는 것이 없다
    expect(bank.getSnapshot()).toBe(loading);

    await settle();
    const downloaded = bank.getSnapshot();
    expect(downloaded).not.toBe(loading);
    expect(downloaded.piano).toBe("downloaded");
    expect(bank.getSnapshot()).toBe(downloaded);
  });
});
