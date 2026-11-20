"use client";

import { expandSong, instrumentsOf, type TrackEvents } from "@/lib/score/expand";
import type { InstrumentId, Song } from "@/lib/score/model";
import { songLengthTicks, ticksPerBar, ticksPerBeat } from "@/lib/score/time";

import { ensureRunning, getAudioContext } from "./context";
import { createInstrument } from "./instruments";
import { createMetronome, type Metronome } from "./metronome";
import { defaultSampleBank, type SamplePort } from "./samples/bank";
import { LOOKAHEAD_SECONDS, Scheduler } from "./scheduler";
import type { Instrument, NoteSink } from "./types";
import { VoicePool } from "./voices";

const TIMER_MS = 25;
const MASTER_GAIN = 0.7;
const START_DELAY = 0.05;

/**
 * AudioContext를 얻는 통로.
 *
 * 엔진이 `getAudioContext`/`ensureRunning`을 직접 부르면 브라우저 없이는
 * 한 줄도 돌릴 수 없다. play/stop 세션 레이스처럼 눈으로 확인하기 가장 어려운
 * 로직이 바로 이 경로에 있어서, 가짜를 끼울 수 있게 좁은 인터페이스로 뺀다.
 */
export type AudioContextProvider = {
  get(): AudioContext;
  ensureRunning(): Promise<void>;
};

const browserContextProvider: AudioContextProvider = {
  get: getAudioContext,
  ensureRunning,
};

/**
 * `play()`의 결과. "눌렀는데 아무 일도 안 일어남"을 값으로 구분한다.
 *
 * - `playing`: 소리를 시작했다
 * - `already-playing`: 이미 재생 중이라 아무것도 하지 않았다
 * - `superseded`: 기다리는 동안 stop()이나 더 나중의 play()가 주도권을 가져갔다
 * - `not-ready`: 곡이 쓰는 악기 중 샘플이 준비되지 않은 것이 있어 시작하지 않았다
 */
export type PlayResult =
  | { status: "playing" }
  | { status: "already-playing" }
  | { status: "superseded" }
  | { status: "not-ready"; failed: InstrumentId[] };

/**
 * 노드 그래프와 재생 상태를 소유한다. React를 import하지 않는다.
 * UI는 명령형 메서드로만 이 레이어를 건드린다.
 */
export class Engine {
  private song: Song;
  /** `expandSong`으로 편 이벤트. 재생과 내보내기가 같은 함수를 쓴다. */
  private events: TrackEvents[];

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private pool: VoicePool | null = null;
  private metronome: Metronome | null = null;
  private instruments = new Map<string, Instrument>();

  private scheduler: Scheduler | null = null;
  /**
   * 브라우저의 setInterval은 number를, node는 Timeout 객체를 돌려준다.
   * 이 파일은 양쪽에서 다 돌아야 하므로(테스트가 node에서 엔진을 굴린다)
   * 반환 타입을 그대로 받는다.
   */
  private timerId: ReturnType<typeof setInterval> | null = null;
  private playing = false;

  /** play() 시작마다 발급하고 stop()에서 무효화하는 세션 번호. */
  private session = 0;
  private metronomeOn = false;
  private bpm: number;

  /** 다음에 예약할 메트로놈 박의 틱. */
  private nextClickTick = 0;

  onStop: (() => void) | null = null;

  private readonly contextProvider: AudioContextProvider;
  private readonly bank: SamplePort;

  constructor(
    song: Song,
    contextProvider: AudioContextProvider = browserContextProvider,
    bank: SamplePort = defaultSampleBank(),
  ) {
    this.song = song;
    this.events = expandSong(song);
    this.bpm = song.tempo;
    this.contextProvider = contextProvider;
    this.bank = bank;
    // AudioContext 없이 파일만 받는다. 곡을 여는 시점은 사용자 제스처 밖일 수
    // 있으므로 디코드는 play()에서 컨텍스트가 생긴 뒤에 한다.
    this.bank.prefetch(instrumentsOf(song));
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getTempo(): number {
    return this.bpm;
  }

  currentTick(): number {
    if (!this.scheduler || !this.playing) return 0;
    return Math.max(0, this.scheduler.currentTick());
  }

  /**
   * 반드시 사용자 제스처 핸들러 안에서 await할 것.
   *
   * 결과를 값으로 돌려준다(`PlayResult`). 샘플이 준비되지 않으면 소리를 시작하지
   * 않는다 — 준비 안 된 악기가 조용히 무음이 되는 경로를 만들지 않는다.
   */
  async play(): Promise<PlayResult> {
    if (this.playing) return { status: "already-playing" };

    // 콜드 스타트에서 ensureRunning()은 수십 ms 걸리는 진짜 await이다.
    // 그 창 안에서 play/stop이 어떤 순서로 겹쳐도 살아남을 세션 번호를
    // await 앞에서 동기적으로 발급한다. 불리언 하나로는 부족하다 —
    // play -> stop -> play 순서면 playing이 다시 true라서 먼저 시작한
    // 호출도 통과해 setInterval을 하나 더 걸고, stop()은 마지막 timerId만
    // 지우므로 먼저 걸린 타이머가 고아가 되어 dispose()로도 못 없앤다.
    this.playing = true;
    const session = ++this.session;

    try {
      const ctx = this.contextProvider.get();

      // 사용자 제스처 안의 **첫** await. 샘플 대기는 반드시 이 뒤에 온다 —
      // 순서가 바뀌면 느린 네트워크에서 제스처 창이 지나 resume이 거부된다.
      await this.contextProvider.ensureRunning();
      // 그 사이 stop()이 눌렸거나 더 나중의 play()가 주도권을 가져갔으면 여기서
      // 끝낸다. 아직 타이머도 그래프도 안 만들었으니 되돌릴 것은 없다. stop()이
      // 이미 playing을 false로 되돌려 놓았으니 여기서 다시 만질 필요도 없다.
      if (!this.isCurrent(session)) return { status: "superseded" };

      // **두 번째** await. 이 창에서도 stop()이나 더 나중의 play()가 끼어들 수
      // 있으므로 세션을 다시 확인한다. 첫 번째 확인만으로는 막지 못한다.
      const readiness = await this.bank.ensureReady(
        ctx,
        instrumentsOf(this.song),
      );
      if (!this.isCurrent(session)) return { status: "superseded" };
      if (!readiness.ok) {
        // 이 세션이 아직 내 것이므로 playing을 되돌려야 다음 play()가 재시도된다.
        this.playing = false;
        return { status: "not-ready", failed: readiness.failed };
      }

      this.ctx = ctx;
      this.buildGraph(ctx);

      const sink: NoteSink = {
        schedule: (trackId, pitch, when, dur, vel) => {
          this.instruments.get(trackId)?.play(pitch, when, dur, vel);
        },
      };

      const startTime = ctx.currentTime + START_DELAY;
      this.scheduler = new Scheduler(this.events, this.bpm, ctx, sink);
      this.scheduler.start(startTime);
      this.nextClickTick = 0;

      // window.setInterval이 아니라 전역으로 부른다 — 브라우저에서는 같은
      // 함수이고, 테스트가 도는 node 환경에는 window가 없다.
      this.timerId = setInterval(() => this.onTimer(), TIMER_MS);
      this.onTimer();
      return { status: "playing" };
    } catch (err) {
      // resume()이 거부되거나(자동재생 정책) getAudioContext()가 미지원
      // 브라우저에서 던지면, 타이머도 그래프도 없이 playing만 true로 남는다.
      // 그대로 두면 다음 play() 호출이 최상단 가드(already-playing)에
      // 걸려 조용히 아무 일도 안 하므로, 재시도가 실제로 다시 시도되도록
      // 여기서 되돌린다. 그사이 stop()이 이미 session을 바꿔놨다면(=이미
      // playing=false) 손대지 않는다 — 이 실패가 그 세션 소유는 아니다.
      if (this.session === session) {
        this.playing = false;
      }
      throw err;
    }
  }

  /** 내가 시작한 세션이 아직 최신인가. 아니면 그 사이 stop()이나 더 나중의 play()가 있었다. */
  private isCurrent(session: number): boolean {
    return this.playing && this.session === session;
  }

  stop(): void {
    // 아직 await 중인 play()가 있다면 이 증가로 무효화된다.
    this.session += 1;

    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.ctx && this.pool) {
      this.pool.releaseAll(this.ctx.currentTime);
    }
    this.scheduler = null;
    this.playing = false;
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
    this.scheduler?.setTempo(bpm);
  }

  setMetronome(on: boolean): void {
    this.metronomeOn = on;
    if (on && this.scheduler) {
      // 지금 지나간 박부터 다시 잡는다 — 과거에 예약하면 한꺼번에 울린다
      const beat = ticksPerBeat(this.song.timeSignature);
      this.nextClickTick =
        Math.ceil(this.scheduler.currentTick() / beat) * beat;
    }
  }

  /**
   * 곡을 갈아끼운다. 편집은 정지 중에만 일어나므로 다음 play()부터 반영된다.
   *
   * 재생 중에는 거부하고 false를 돌려준다. 트랙별 커서가 이벤트 인덱스라,
   * 재생 중 이벤트가 바뀌면 노트가 조용히 누락되기 때문이다.
   *
   * 곡·이벤트·템포·악기 맵을 **한 번에** 맞춘다. `song.tempo`가 템포의
   * 유일한 진실이므로 호출부가 setTempo를 따로 부를 필요가 없다 — 옛
   * 설계에서는 그 책임이 호출부에 있어서, 빠뜨리면 화면과 재생 속도가
   * 영구히 갈라졌다. 재생 중 템포 변경은 setTempo가 맡는다.
   *
   * 트랙 구성(id·instrument 순서)이 바뀌면 악기 맵을 다시 채운다. 파일을
   * 불러오면 트랙 id나 악기가 다른 곡이 통째로 들어올 수 있고, 맵을 그대로
   * 두면 sink.schedule의 `this.instruments.get(trackId)`가 못 찾은 트랙을
   * 조용히 무시하거나(무음) 옛 악기로 재생한다. ctx/pool이 아직 없으면(한 번도
   * play()하지 않았거나 dispose된 뒤라면) 다시 채울 그래프 자체가 없다 —
   * 다음 buildGraph()가 새 곡의 트랙으로 정확히 채운다.
   *
   * `false`는 소리가 나는 동안만이 아니라 play()가 기다리는 창 전체에서도
   * 돌아온다 — 콜드 스타트(ensureRunning)뿐 아니라 그 뒤의 샘플 로딩 대기
   * (bank.ensureReady)까지다. play()는 첫 await 전에 이미 playing을 true로
   * 올리고, not-ready·예외로 끝나거나 stop()이 불릴 때까지 내리지 않는다. 느린
   * 네트워크에서는 이 창이 몇 초씩 간다. 그러니 UI 코드는 이 창에서
   * `isPlaying()`을 "소리가 난다"로 취급하지 말고, setSong의 `false` 결과를
   * 반드시 처리해야 한다.
   *
   * 잘못된 곡(모르는 패턴 id, 트랙 악기와 맞지 않는 패턴)이면 `expandSong`이
   * 예외를 던지고, 그때 엔진은 **아무것도 바뀌지 않는다**(곡·이벤트·템포·
   * 악기 맵 모두 그대로). 그래서 무엇이든 바꾸기 전에 먼저 편다. 악기 생성이
   * 던져도 마찬가지다 — 새 맵은 지역 변수에 다 만든 뒤에야 바꿔 끼운다.
   *
   * 파일·링크처럼 믿을 수 없는 입력은 넘기기 전에 반드시 `parseSong`을
   * 거친다. `validateSong`은 이미 타입이 맞는 곡의 구조 불변식만 보고
   * `chord.quality`는 보지 않으므로 `parseSong`의 대체가 아니다.
   */
  setSong(song: Song): boolean {
    if (this.playing) return false;

    // 곡이 잘못됐을 때 던지는 단계라 맨 앞에 둔다. 여기서 던지면 아래의 어떤
    // 대입도 일어나지 않는다 — 새 악기 맵에 옛 이벤트가 남아 무음이 되거나,
    // 새 곡 길이에 옛 이벤트가 걸려 일찍 멈추는 반쪽 상태가 생기지 않는다.
    const events = expandSong(song);

    // 새 맵은 지역 변수에 끝까지 만든다. this.instruments를 제자리에서 비우고
    // 채우다 createInstrument가 던지면, 곡·이벤트는 옛 것인데 맵은 새 곡의 앞
    // 트랙만 든 반쪽이 되어 옛 트랙 전체가 조용히 무음이 된다.
    let instruments = this.instruments;
    if (this.ctx && this.pool && !sameTrackComposition(this.song, song)) {
      instruments = new Map();
      for (const track of song.tracks) {
        instruments.set(
          track.id,
          createInstrument(track.instrument, this.ctx, this.pool, this.bank),
        );
      }
    }

    this.instruments = instruments;
    this.song = song;
    this.events = events;
    this.bpm = song.tempo;
    // 새 곡이 쓰는 악기를 컨텍스트 없이 미리 받는다.
    this.bank.prefetch(instrumentsOf(song));
    return true;
  }

  dispose(): void {
    this.stop();
    this.instruments.clear();
    this.master?.disconnect();
    this.master = null;
    this.pool = null;
    this.metronome = null;
    this.ctx = null;
  }

  private buildGraph(ctx: AudioContext): void {
    if (this.master) return;

    // 악기 4종이 동시에 울리면 합산 진폭이 1.0을 넘어 클리핑이 난다
    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);

    const pool = new VoicePool(ctx, master);

    // early return(this.master) 때문에 이 맵은 최초 play() 시점에만 이
    // 루프로 채워진다. 그 뒤로 트랙 구성이 바뀌는 유일한 경로는 setSong()
    // 뿐이고, setSong()이 sameTrackComposition()으로 변화를 감지해 맵을
    // 직접 다시 채운다(위 참고) — 그래서 여기서는 그냥 최초 채우기만 하면
    // 된다. 이 동기화가 깨지면 sink.schedule의
    // `this.instruments.get(trackId)?.play(...)`가 못 찾은 트랙을 조용히
    // 무시해버린다 — 예외도 로그도 없이 노트만 안 울리는, 가장 찾기 어려운
    // 종류의 오디오 버그다.
    for (const track of this.song.tracks) {
      this.instruments.set(
        track.id,
        createInstrument(track.instrument, ctx, pool, this.bank),
      );
    }

    this.master = master;
    this.pool = pool;
    this.metronome = createMetronome(ctx, master);
  }

  private onTimer(): void {
    const scheduler = this.scheduler;
    if (!scheduler || !this.ctx) return;

    scheduler.advance();

    if (this.metronomeOn) {
      this.scheduleClicks(scheduler);
    }

    // 곡 끝을 지나도 마지막 노트의 릴리즈 테일이 아직 울리는 중이면
    // 자르지 않는다. 음이 있는 악기는 음 길이 뒤에 릴리즈를 타고, 드럼은
    // 음 길이와 무관하게 샘플 길이만큼 울리는 원샷이라, 곡 길이만
    // 보고 바로 stop() -> releaseAll(5ms 페이드)하면 마지막 비트의 꼬리가
    // 매번 뚝 잘린다. 풀에 아직 소리 나는 보이스가 없을 때까지 기다린다.
    const pastEnd = scheduler.currentTick() > songLengthTicks(this.song);
    const stillSounding = this.pool
      ? this.pool.latestEndsAt() > this.ctx.currentTime
      : false;

    if (pastEnd && !stillSounding) {
      this.stop();
      this.onStop?.();
    }
  }

  private scheduleClicks(scheduler: Scheduler): void {
    if (!this.ctx || !this.metronome) return;

    const beat = ticksPerBeat(this.song.timeSignature);
    const perBar = ticksPerBar(this.song.timeSignature);
    // 스케줄러의 note lookahead와 같은 값이어야 한다 — LOOKAHEAD_SECONDS 주석 참고.
    const horizon = this.ctx.currentTime + LOOKAHEAD_SECONDS;

    while (this.nextClickTick <= songLengthTicks(this.song)) {
      const when = scheduler.tickToTime(this.nextClickTick);
      if (when >= horizon) break;
      if (when >= this.ctx.currentTime) {
        this.metronome.click(when, this.nextClickTick % perBar === 0);
      }
      this.nextClickTick += beat;
    }
  }
}

/**
 * 두 곡의 트랙 구성(순서·id·instrument)이 같은지 본다.
 *
 * 클립 내용(음, 세기, 길이 등)은 보지 않는다 — 그건 expandSong이 매번
 * 새로 펴므로 악기 맵과 무관하다. 여기서 보는 것은 오직 "sink.schedule이
 * trackId로 인스트루먼트를 찾을 수 있는가"에 영향을 주는 두 가지, id와
 * instrument뿐이다.
 */
function sameTrackComposition(a: Song, b: Song): boolean {
  if (a.tracks.length !== b.tracks.length) return false;
  return a.tracks.every(
    (track, i) =>
      track.id === b.tracks[i].id && track.instrument === b.tracks[i].instrument,
  );
}
