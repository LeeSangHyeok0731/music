import { INSTRUMENT_IDS, type InstrumentId } from "@/lib/score/model";

import {
  findZone,
  parseManifest,
  playbackRateFor,
  type SampleManifest,
} from "./manifest";

/**
 * - `idle`: 아직 시작하지 않음
 * - `loading`: 파일을 받는 중
 * - `downloaded`: 다 받았지만 AudioContext가 없어 디코드는 아직 못 함
 * - `ready`: 디코드까지 끝나 소리를 낼 수 있음
 * - `error`: 받기 또는 디코드 실패. 다시 부르면 재시도한다
 */
export type SampleStatus =
  | "idle"
  | "loading"
  | "downloaded"
  | "ready"
  | "error";

export type SampleReadiness =
  | { ok: true }
  | { ok: false; failed: InstrumentId[] };

/** `AudioContext`가 이 모양을 만족한다. 테스트는 가짜를 넣는다. */
export type Decoder = {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
};

export type SampleHit = { buffer: AudioBuffer; rate: number };

/** 엔진과 샘플 악기가 뱅크에서 쓰는 부분. 테스트가 가짜를 끼운다. */
export interface SamplePort {
  /** AudioContext 없이 파일만 받는다. 사용자 제스처 밖(곡을 열 때)에 불러도 된다. */
  prefetch(instruments: readonly InstrumentId[]): void;
  /**
   * 디코드까지 끝내 소리를 낼 수 있게 한다. **AudioContext가 있어야 하므로
   * 컨텍스트를 만든 뒤에 부른다.** 실패한 악기는 `failed`에 담긴다.
   */
  ensureReady(
    ctx: Decoder,
    instruments: readonly InstrumentId[],
  ): Promise<SampleReadiness>;
  /** ready가 아니면 null. */
  zoneFor(instrument: InstrumentId, pitch: number): SampleHit | null;
}

type Entry = {
  status: SampleStatus;
  manifest: SampleManifest | null;
  fetched: Promise<Map<string, ArrayBuffer>> | null;
  decoding: Promise<void> | null;
  buffers: Map<string, AudioBuffer> | null;
};

const IDLE: Readonly<Record<InstrumentId, SampleStatus>> = Object.fromEntries(
  INSTRUMENT_IDS.map((id) => [id, "idle"]),
) as Record<InstrumentId, SampleStatus>;

export class SampleBank implements SamplePort {
  private readonly entries = new Map<InstrumentId, Entry>();
  private readonly listeners = new Set<() => void>();
  private snapshot = IDLE;

  constructor(
    private readonly opts: {
      baseUrl: string;
      fetchBytes: (url: string) => Promise<ArrayBuffer>;
      /**
       * false면 prefetch가 아무것도 받지 않는다. 서버 렌더링 중에는 상대 URL
       * fetch가 실패하고, 서버 HTML과 클라이언트 상태가 달라져 하이드레이션이
       * 어긋날 수 있다. ensureReady는 영향받지 않는다 — 클라이언트의 사용자
       * 제스처 뒤에서만 불린다.
       */
      enabled?: boolean;
    },
  ) {}

  status(instrument: InstrumentId): SampleStatus {
    return this.snapshot[instrument];
  }

  /** useSyncExternalStore용. 상태가 안 바뀌면 같은 참조를 돌려준다. */
  readonly getSnapshot = (): Readonly<Record<InstrumentId, SampleStatus>> =>
    this.snapshot;

  /**
   * 리스너는 상태를 publish하는 도중에 **동기로** 불린다. 그러니 리스너는
   * 던지면 안 된다 — 던지면 진행 중인 받기/디코드의 상태 전이가 중간에 끊겨
   * 상태가 어긋난다(여기서 잡아 주지 않는다). 리스너 안에서 뱅크를 다시
   * 불러도 되지만(재진입), 다시 렌더를 예약하는 정도가 권장된다.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  prefetch(instruments: readonly InstrumentId[]): void {
    if (this.opts.enabled === false) return;
    for (const instrument of instruments) {
      // 실패는 상태(error)로 드러난다. 여기서 던지면 처리되지 않은 거부가 된다.
      this.startFetch(instrument).fetched.catch(() => {});
    }
  }

  async ensureReady(
    ctx: Decoder,
    instruments: readonly InstrumentId[],
  ): Promise<SampleReadiness> {
    const unique = [...new Set(instruments)];
    const failed = new Set<InstrumentId>();
    await Promise.all(
      unique.map(async (instrument) => {
        try {
          await this.decode(ctx, instrument);
        } catch {
          failed.add(instrument);
        }
      }),
    );
    return failed.size === 0
      ? { ok: true }
      : { ok: false, failed: unique.filter((i) => failed.has(i)) };
  }

  zoneFor(instrument: InstrumentId, pitch: number): SampleHit | null {
    const entry = this.entries.get(instrument);
    if (!entry || entry.status !== "ready" || !entry.manifest || !entry.buffers) {
      return null;
    }
    const zone = findZone(entry.manifest.zones, pitch);
    const buffer = entry.buffers.get(zone.file);
    return buffer
      ? { buffer, rate: playbackRateFor(pitch, zone.centerPitch) }
      : null;
  }

  /**
   * 옛 시도의 늦게 도착한 결과는 버린다 — 지금 항목이 아니면 아무것도 하지 않는다.
   *
   * 아래의 `ready → loading/downloaded` 가드는 **현재 순서로는 도달할 수 없는
   * 방어용 가드**다. loading은 항목을 만들 때 동기로 알리고, downloaded 처리기는
   * startFetch가 decode의 `await fetched`보다 먼저 달아 두므로(같은 약속의
   * 처리기는 단 순서대로 불린다) 같은 항목에서 ready보다 늦게 올 수 없다. 순서가
   * 바뀌어도 소리를 낼 수 있는 악기를 못 내는 것처럼 보이게 하지 않으려고 남긴다.
   */
  private publish(
    instrument: InstrumentId,
    entry: Entry,
    status: SampleStatus,
  ): void {
    if (this.entries.get(instrument) !== entry) return;
    if (
      entry.status === "ready" &&
      (status === "downloaded" || status === "loading")
    ) {
      return;
    }
    entry.status = status;
    if (this.snapshot[instrument] === status) return;
    this.snapshot = { ...this.snapshot, [instrument]: status };
    for (const listener of this.listeners) listener();
  }

  /**
   * 지금 시도(항목과 그 받기 약속)를 돌려준다. 진행 중이거나 끝난 시도가
   * 있으면 그것을, 없거나 error면 새로 시작한다. 부르는 쪽은 돌려받은 항목을
   * 붙잡고 쓴다 — 맵을 다시 읽으면 그 사이 재진입이 바꿔 놓은 항목을 볼 수 있다.
   */
  private startFetch(instrument: InstrumentId): {
    entry: Entry;
    fetched: Promise<Map<string, ArrayBuffer>>;
  } {
    const current = this.entries.get(instrument);
    if (current && current.status !== "error" && current.fetched) {
      return { entry: current, fetched: current.fetched };
    }

    const entry: Entry = {
      status: "idle",
      manifest: null,
      fetched: null,
      decoding: null,
      buffers: null,
    };
    this.entries.set(instrument, entry);

    // fetched와 그 처리기를 loading을 알리기 *전에* 단다. 알림은 리스너를 동기로
    // 부르므로, 리스너가 뱅크를 다시 부르면 이 항목을 이미 받는 중으로 봐야 한다
    // — 아니면 두 번째 항목을 만들고 다시 받는다.
    const dir = `${this.opts.baseUrl}/${instrument}`;
    entry.fetched = (async () => {
      const raw = await this.opts.fetchBytes(`${dir}/manifest.json`);
      const manifest = parseManifest(
        JSON.parse(new TextDecoder().decode(raw)),
        instrument,
      );
      entry.manifest = manifest;
      const files = [...new Set(manifest.zones.map((z) => z.file))];
      const bytes = await Promise.all(
        files.map((file) => this.opts.fetchBytes(`${dir}/${file}`)),
      );
      return new Map(files.map((file, i) => [file, bytes[i]]));
    })();

    entry.fetched.then(
      () => this.publish(instrument, entry, "downloaded"),
      () => this.publish(instrument, entry, "error"),
    );
    const fetched = entry.fetched;
    this.publish(instrument, entry, "loading");
    return { entry, fetched };
  }

  private decode(ctx: Decoder, instrument: InstrumentId): Promise<void> {
    // 지금 시도를 먼저 정한다. 진행 중이거나 끝난 시도는 그대로 돌아오고, error인
    // 시도는 startFetch가 새 항목으로 바꾼다. 맵을 따로 읽어 먼저 판정하지 않는다 —
    // error를 알리는 리스너 안에서 재진입하면 실패한 디코드의 약속이 아직 그
    // 항목에 걸려 있어(finally 전), 거기 합류하면 재시도 없이 같이 실패한다.
    const { entry, fetched } = this.startFetch(instrument);
    // 이미 ready면 다시 디코드하지 않는다. 디코드는 받은 바이트를 분리했으므로
    // 다시 디코드하면 실패해 소리 나는 악기가 error로 떨어진다.
    if (entry.status === "ready") return Promise.resolve();
    // 이미 디코드 중이면(앞선 호출, 또는 startFetch의 loading 알림 안에서 재진입한
    // ensureReady) 같은 약속에 합류한다 — 덮어쓰면 두 번 디코드한다.
    if (entry.decoding) return entry.decoding;

    entry.decoding = (async () => {
      try {
        const bytes = await fetched;
        const buffers = new Map<string, AudioBuffer>();
        for (const [file, data] of bytes) {
          // decodeAudioData는 넘긴 ArrayBuffer를 분리(detach)한다. 받은 바이트는
          // 이 디코드에만 쓰이고, 실패 뒤 재시도는 새 항목으로 다시 받으므로
          // 사본을 만들 이유가 없다.
          buffers.set(file, await ctx.decodeAudioData(data));
        }
        entry.buffers = buffers;
        this.publish(instrument, entry, "ready");
      } catch (error) {
        this.publish(instrument, entry, "error");
        throw error;
      } finally {
        entry.decoding = null;
      }
    })();
    return entry.decoding;
  }
}

export async function browserFetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.arrayBuffer();
}

/**
 * 브라우저용 기본 뱅크. 만들 때 아무것도 받지 않는다 — fetch는 prefetch가 시작한다.
 * 서버 렌더링 중(`window`가 없을 때)에는 prefetch도 하지 않는다.
 */
export function defaultSampleBank(): SampleBank {
  return new SampleBank({
    baseUrl: "/samples",
    fetchBytes: browserFetchBytes,
    enabled: typeof window !== "undefined",
  });
}
