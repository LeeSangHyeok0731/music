import { describe, expect, it } from "vitest";

import { SampleBank } from "@/lib/audio/samples/bank";
import { FakeAudioContext, asAudioContext } from "@/lib/audio/testing/fake-audio";

const enc = (text: string): ArrayBuffer =>
  new TextEncoder().encode(text).buffer as ArrayBuffer;

const manifestFor = (instrument: string) =>
  JSON.stringify({
    instrument,
    zones: [
      { file: "c4.wav", centerPitch: 60, loPitch: 55, hiPitch: 64 },
      { file: "c5.wav", centerPitch: 72, loPitch: 65, hiPitch: 79 },
    ],
  });

/** 실제 네트워크 없이 url → 바이트를 돌려주는 fetch. failing에 든 url은 실패한다. */
function makeBank(failingUrls: string[] = []) {
  const calls: string[] = [];
  const failing = new Set(failingUrls);
  const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
    calls.push(url);
    if (failing.has(url)) throw new Error(`404 ${url}`);
    const match = /^\/samples\/([a-z]+)\/(.+)$/.exec(url)!;
    return match[2] === "manifest.json"
      ? enc(manifestFor(match[1]))
      : enc(`bytes:${url}`);
  };
  return {
    bank: new SampleBank({ baseUrl: "/samples", fetchBytes }),
    calls,
    failing,
  };
}

/** 이미 끝난 약속들이 마저 정리되도록 한 번 양보한다. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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

  it("동시에 두 번 불러도 디코드는 한 번만 한다", async () => {
    const { bank } = makeBank();
    const ctx = new FakeAudioContext();
    const dec = asAudioContext(ctx);

    await Promise.all([
      bank.ensureReady(dec, ["piano"]),
      bank.ensureReady(dec, ["piano"]),
    ]);
    await bank.ensureReady(dec, ["piano"]); // 이미 ready

    expect(ctx.decoded).toHaveLength(2);
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
    const { bank } = makeBank();
    const ctx = new FakeAudioContext();
    ctx.failDecode = true;

    expect(await bank.ensureReady(asAudioContext(ctx), ["piano"])).toEqual({
      ok: false,
      failed: ["piano"],
    });
    expect(bank.status("piano")).toBe("error");

    ctx.failDecode = false;
    expect(await bank.ensureReady(asAudioContext(ctx), ["piano"])).toEqual({
      ok: true,
    });
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
  it("상태가 바뀌면 구독자를 부르고 스냅샷을 새로 만든다", async () => {
    const { bank } = makeBank();
    let calls = 0;
    const unsubscribe = bank.subscribe(() => {
      calls += 1;
    });
    const before = bank.getSnapshot();
    expect(before.piano).toBe("idle");

    await bank.ensureReady(asAudioContext(new FakeAudioContext()), ["piano"]);

    const after = bank.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.piano).toBe("ready");
    expect(calls).toBeGreaterThan(0);

    unsubscribe();
    const callsAtUnsubscribe = calls;
    bank.prefetch(["drums"]);
    expect(calls).toBe(callsAtUnsubscribe);
  });

  it("상태가 안 바뀌면 같은 스냅샷 참조를 돌려준다(useSyncExternalStore 계약)", () => {
    const { bank } = makeBank();
    expect(bank.getSnapshot()).toBe(bank.getSnapshot());
  });
});
