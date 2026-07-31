"use client";

import { ticksPerBar } from "@/lib/score/time";
import { PPQ, type Song } from "@/lib/score/types";

import { ensureRunning, getAudioContext } from "./context";
import { createInstrument } from "./instruments";
import { createMetronome, type Metronome } from "./metronome";
import { Scheduler } from "./scheduler";
import type { Instrument, NoteSink } from "./types";
import { VoicePool } from "./voices";

const TIMER_MS = 25;
const MASTER_GAIN = 0.7;
const START_DELAY = 0.05;

/**
 * 노드 그래프와 재생 상태를 소유한다. React를 import하지 않는다.
 * UI는 명령형 메서드로만 이 레이어를 건드린다.
 */
export class Engine {
  private readonly song: Song;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private pool: VoicePool | null = null;
  private metronome: Metronome | null = null;
  private instruments = new Map<string, Instrument>();

  private scheduler: Scheduler | null = null;
  private timerId: number | null = null;
  private playing = false;
  private metronomeOn = false;
  private bpm: number;

  /** 다음에 예약할 메트로놈 박의 틱. */
  private nextClickTick = 0;

  onStop: (() => void) | null = null;

  constructor(song: Song) {
    this.song = song;
    this.bpm = song.tempo;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  currentTick(): number {
    if (!this.scheduler || !this.playing) return 0;
    return Math.max(0, this.scheduler.currentTick());
  }

  /** 반드시 사용자 제스처 핸들러 안에서 await할 것. */
  async play(): Promise<void> {
    if (this.playing) return;

    // 가드는 await 앞에서 동기적으로 세운다. 콜드 스타트에서는 아래
    // ensureRunning()이 진짜로 수십 ms 걸리는 await이라, playing을 그
    // 뒤에 세우면 그 틈으로 들어온 두 번째 play() 호출도 이 가드를
    // 통과해 setInterval을 한 번 더 건다 — stop()은 마지막 timerId만
    // 지우므로 먼저 걸린 타이머가 고아가 되어 dispose()로도 못 없앤다.
    this.playing = true;

    const ctx = getAudioContext();
    await ensureRunning();

    // await하는 동안 stop()이 끼어들었을 수 있다 (시작 중에 사용자가
    // 정지를 누른 경우). stop()이 이미 playing을 false로 내렸다면 여기서
    // 멈춘다 — 그러지 않으면 "정지를 눌렀는데 재생이 시작된다" 버그가
    // 되살아난다. 아직 타이머도, 그래프도 안 만들었으니 되돌릴 것도 없다.
    if (!this.playing) return;

    this.ctx = ctx;

    this.buildGraph(ctx);

    const sink: NoteSink = {
      schedule: (lineId, note, when, dur, vel) => {
        this.instruments.get(lineId)?.play(note, when, dur, vel);
      },
    };

    const startTime = ctx.currentTime + START_DELAY;
    this.scheduler = new Scheduler(this.song, ctx, sink);
    this.scheduler.setTempo(this.bpm);
    this.scheduler.start(startTime);
    this.nextClickTick = 0;

    this.timerId = window.setInterval(() => this.onTimer(), TIMER_MS);
    this.onTimer();
  }

  stop(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
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
      const beat = PPQ * (4 / this.song.timeSignature[1]);
      this.nextClickTick =
        Math.ceil(this.scheduler.currentTick() / beat) * beat;
    }
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

    for (const line of this.song.lines) {
      this.instruments.set(line.id, createInstrument(line.instrument, ctx, pool));
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
    // 자르지 않는다. 피아노 최소 0.3초, 킥 고정 0.35초처럼 악기들은
    // 의도적으로 tile 길이보다 오래 울리도록 되어 있어서, lengthTicks만
    // 보고 바로 stop() -> releaseAll(5ms 페이드)하면 마지막 비트의 꼬리가
    // 매번 뚝 잘린다. 풀에 아직 소리 나는 보이스가 없을 때까지 기다린다.
    const pastEnd = scheduler.currentTick() > this.song.lengthTicks;
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

    const beat = PPQ * (4 / this.song.timeSignature[1]);
    const perBar = ticksPerBar(this.song.timeSignature);
    const horizon = this.ctx.currentTime + 0.1;

    while (this.nextClickTick <= this.song.lengthTicks) {
      const when = scheduler.tickToTime(this.nextClickTick);
      if (when >= horizon) break;
      if (when >= this.ctx.currentTime) {
        this.metronome.click(when, this.nextClickTick % perBar === 0);
      }
      this.nextClickTick += beat;
    }
  }
}
