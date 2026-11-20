/**
 * 브라우저 없이 오디오 레이어를 돌리기 위한 최소 Web Audio 가짜.
 *
 * 소리를 검증하려는 게 아니다 — 소리는 귀로 확인한다. 여기서 잡으려는 것은
 * 귀로는 못 잡는 것들이다: 노드를 연결해 놓고 끊지 않았는지, 아직 울리는
 * 보이스를 잘라냈는지, play/stop이 겹쳤을 때 타이머가 고아로 남는지.
 *
 * 그래서 각 노드는 `connected` / `disconnectCount` 같은 관찰 지점만 들고 있고,
 * 신호 처리는 흉내조차 내지 않는다.
 */

export type ParamCall = {
  method:
    | "setValueAtTime"
    | "linearRampToValueAtTime"
    | "exponentialRampToValueAtTime"
    | "cancelScheduledValues"
    | "cancelAndHoldAtTime";
  value: number | null;
  time: number;
};

/** 가짜 decodeAudioData가 받은 입력 하나. */
export type DecodedInput = {
  /** 받은 객체 그대로. 디코드 뒤에는 분리돼 byteLength가 0이다. */
  buffer: ArrayBuffer;
  /** 분리하기 전의 크기. */
  byteLength: number;
  /** 분리하기 전에 떠 둔 사본. */
  bytes: Uint8Array;
};

export class FakeAudioParam {
  value: number;
  readonly calls: ParamCall[] = [];

  /** 실제 AudioParam처럼 노드마다 기본값이 다르다(대부분 0, playbackRate는 1). */
  constructor(defaultValue = 0) {
    this.value = defaultValue;
  }

  setValueAtTime(value: number, time: number): FakeAudioParam {
    this.value = value;
    this.calls.push({ method: "setValueAtTime", value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): FakeAudioParam {
    this.calls.push({ method: "linearRampToValueAtTime", value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): FakeAudioParam {
    this.calls.push({ method: "exponentialRampToValueAtTime", value, time });
    return this;
  }

  cancelScheduledValues(time: number): FakeAudioParam {
    this.calls.push({ method: "cancelScheduledValues", value: null, time });
    return this;
  }

  cancelAndHoldAtTime(time: number): FakeAudioParam {
    this.calls.push({ method: "cancelAndHoldAtTime", value: null, time });
    return this;
  }
}

export class FakeAudioNode {
  readonly connected: FakeAudioNode[] = [];
  disconnectCount = 0;

  constructor(readonly kind: string) {}

  connect(target: FakeAudioNode): FakeAudioNode {
    this.connected.push(target);
    return target;
  }

  /**
   * 인자 없는 disconnect()는 실제 API에서도 나가는 연결을 전부 끊는다.
   * `connected`를 비워야 "지금 연결돼 있나"를 물을 수 있다 — 호출 이력만
   * 남기면 끊긴 뒤에도 계속 연결된 것처럼 보인다.
   */
  disconnect(): void {
    this.disconnectCount += 1;
    this.connected.length = 0;
  }

  /** 한 번이라도 회수됐는지. 노드 누수 검사의 기준. */
  get isDisconnected(): boolean {
    return this.disconnectCount > 0;
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam();

  constructor() {
    super("gain");
  }
}

export class FakeScheduledSource extends FakeAudioNode {
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  private ended = false;

  start(when: number): void {
    this.startedAt = when;
  }

  stop(when: number): void {
    this.stoppedAt = when;
  }

  /**
   * 예약된 정지 시각이 지났으면 onended를 한 번 발화한다.
   *
   * 이걸 흉내내지 않으면 노드 누수를 아예 검사할 수 없다. 이 코드베이스의
   * 노트 단위 노드는 전부 onended 안에서만 disconnect되기 때문이다 —
   * onended가 안 오면 모든 노드가 영원히 연결된 것처럼 보인다.
   */
  fireEndedIfDue(now: number): void {
    if (this.ended) return;
    if (this.stoppedAt === null || this.stoppedAt > now) return;
    this.ended = true;
    this.onended?.();
  }
}

class FakeOscillatorNode extends FakeScheduledSource {
  type = "sine";
  readonly frequency = new FakeAudioParam();
  readonly detune = new FakeAudioParam();

  constructor() {
    super("oscillator");
  }
}

class FakeBufferSourceNode extends FakeScheduledSource {
  buffer: unknown = null;
  /** 실제 노드처럼 1에서 시작한다 — 속도를 안 정한 샘플러가 맞아 보이면 안 된다. */
  readonly playbackRate = new FakeAudioParam(1);

  constructor() {
    super("bufferSource");
  }
}

class FakeBiquadFilterNode extends FakeAudioNode {
  type = "lowpass";
  readonly frequency = new FakeAudioParam();
  readonly Q = new FakeAudioParam();

  constructor() {
    super("biquadFilter");
  }
}

class FakeWaveShaperNode extends FakeAudioNode {
  curve: Float32Array | null = null;

  constructor() {
    super("waveShaper");
  }
}

/**
 * 시간이 저절로 흐르지 않는 AudioContext. 테스트가 `advanceTo`로 직접 굴린다.
 * 실제 컨텍스트와 달리 결정적이라, 타이밍 검사를 반복해도 결과가 흔들리지 않는다.
 */
export class FakeAudioContext {
  currentTime = 0;
  state: "suspended" | "running" | "closed" = "running";
  readonly sampleRate = 48000;
  readonly destination = new FakeAudioNode("destination");

  /** 만들어진 모든 노드. 누수 검사에 쓴다. */
  readonly created: FakeAudioNode[] = [];

  /** start/stop이 예약된 노드. 시계가 지날 때 onended를 발화시킨다. */
  readonly sources: FakeScheduledSource[] = [];

  advanceTo(time: number): void {
    this.currentTime = time;
    // 실제 API는 예약된 정지 시각이 되면 onended를 부른다. 이 코드베이스는
    // 거기서만 노드를 회수하므로, 흉내내지 않으면 전부 누수로 보인다.
    for (const source of this.sources) {
      source.fireEndedIfDue(time);
    }
  }

  advanceBy(seconds: number): void {
    this.advanceTo(this.currentTime + seconds);
  }

  private track<T extends FakeAudioNode>(node: T): T {
    this.created.push(node);
    if (node instanceof FakeScheduledSource) {
      this.sources.push(node);
    }
    return node;
  }

  createGain(): FakeGainNode {
    return this.track(new FakeGainNode());
  }

  createOscillator(): FakeOscillatorNode {
    return this.track(new FakeOscillatorNode());
  }

  createBufferSource(): FakeBufferSourceNode {
    return this.track(new FakeBufferSourceNode());
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    return this.track(new FakeBiquadFilterNode());
  }

  createWaveShaper(): FakeWaveShaperNode {
    return this.track(new FakeWaveShaperNode());
  }

  createBuffer(channels: number, length: number): { getChannelData(): Float32Array } {
    const data = new Float32Array(length * channels);
    return { getChannelData: () => data };
  }

  /**
   * decodeAudioData가 받은 바이트. 몇 번, 무엇을 디코드했는지 검사한다.
   * `buffer`는 받은 객체 그대로라 분리(detach)된 뒤다 — 크기와 내용은
   * 분리하기 전에 떠 둔 `byteLength`와 `bytes`로 본다.
   */
  readonly decoded: DecodedInput[] = [];
  /** true면 decodeAudioData가 실패한다(실제처럼 바이트는 분리된 뒤에). */
  failDecode = false;

  /**
   * 실제 브라우저처럼 받은 ArrayBuffer를 분리한다 — 디코드가 실패해도.
   * 그래서 같은 바이트를 두 번 넘기면 두 번째는 거부된다. 이걸 흉내내지
   * 않으면 "실패 뒤 재시도는 새로 받는다"는 불변식을 아무도 지키지 않는다.
   */
  async decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
    if (data.byteLength === 0) {
      throw new DOMException(
        "decodeAudioData: 분리(detach)됐거나 빈 ArrayBuffer입니다",
        "EncodingError",
      );
    }
    this.decoded.push({
      buffer: data,
      byteLength: data.byteLength,
      bytes: new Uint8Array(data.slice(0)),
    });
    structuredClone(data, { transfer: [data] });
    if (this.failDecode) throw new Error("decode 실패");
    return {
      duration: 1,
      length: 48000,
      sampleRate: 48000,
      numberOfChannels: 1,
    } as unknown as AudioBuffer;
  }

  async resume(): Promise<void> {
    this.state = "running";
  }
}

/**
 * 실제 타입 대신 쓰기 위한 캐스팅. 가짜는 Web Audio 인터페이스의 극히 일부만
 * 구현하므로 구조적 타입 검사를 통과하지 못한다. 캐스팅을 한곳에 모아 두면
 * 테스트 본문이 `as unknown as`로 지저분해지지 않는다.
 */
export function asAudioContext(fake: FakeAudioContext): AudioContext {
  return fake as unknown as AudioContext;
}

export function asAudioNode(fake: FakeAudioNode): AudioNode {
  return fake as unknown as AudioNode;
}
