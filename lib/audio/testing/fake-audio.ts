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

export class FakeAudioParam {
  value = 0;
  readonly calls: ParamCall[] = [];

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

  disconnect(): void {
    this.disconnectCount += 1;
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

class FakeScheduledSource extends FakeAudioNode {
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;

  start(when: number): void {
    this.startedAt = when;
  }

  stop(when: number): void {
    this.stoppedAt = when;
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

  advanceTo(time: number): void {
    this.currentTime = time;
  }

  advanceBy(seconds: number): void {
    this.currentTime += seconds;
  }

  private track<T extends FakeAudioNode>(node: T): T {
    this.created.push(node);
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
