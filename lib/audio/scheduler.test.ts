import { beforeEach, describe, expect, it } from "vitest";

import { Scheduler } from "@/lib/audio/scheduler";
import type { AudioClock, NoteSink } from "@/lib/audio/types";
import type { ScheduledNote, TrackEvents } from "@/lib/score/expand";
import { DRUM_HIHAT, DRUM_KICK, PPQ } from "@/lib/score/model";
import { ticksToSeconds } from "@/lib/score/time";

class FakeClock implements AudioClock {
  currentTime = 0;
  advanceBy(seconds: number): void {
    this.currentTime += seconds;
  }
}

type Recorded = {
  trackId: string;
  pitch: number;
  when: number;
  dur: number;
  vel: number;
};

class RecordingSink implements NoteSink {
  readonly events: Recorded[] = [];
  schedule(
    trackId: string,
    pitch: number,
    when: number,
    dur: number,
    vel: number,
  ): void {
    this.events.push({ trackId, pitch, when, dur, vel });
  }
}

const TEMPO = 120;
const BARS = 16;

/**
 * 16마디(120BPM에서 32초) 곡의 이벤트.
 * 피아노: 마디마다 3화음(60·64·67), 길이 한 마디.
 * 드럼: 8분음표(240틱)마다 하이햇, 마디 첫 박에 킥.
 * 스케줄러는 곡의 내용을 모른다 — 이벤트가 시간순이라는 것만 믿는다.
 */
function demoEvents(): TrackEvents[] {
  const piano: ScheduledNote[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    for (const pitch of [60, 64, 67]) {
      piano.push({ tick: bar * 1920, length: 1920, pitch, velocity: 0.7 });
    }
  }
  const drums: ScheduledNote[] = [];
  for (let i = 0; i < BARS * 8; i++) {
    drums.push({ tick: i * 240, length: 120, pitch: DRUM_HIHAT, velocity: 0.5 });
    if (i % 8 === 0) {
      drums.push({ tick: i * 240, length: 240, pitch: DRUM_KICK, velocity: 0.9 });
    }
  }
  return [
    { trackId: "track-piano", instrument: "piano", events: piano },
    { trackId: "track-drums", instrument: "drums", events: drums },
  ];
}

function totalCount(tracks: TrackEvents[]): number {
  return tracks.reduce((sum, t) => sum + t.events.length, 0);
}

/** 25ms 타이머를 흉내내 seconds만큼 굴린다. */
function run(scheduler: Scheduler, clock: FakeClock, seconds: number): void {
  const steps = Math.ceil(seconds / 0.025);
  scheduler.advance();
  for (let i = 0; i < steps; i++) {
    clock.advanceBy(0.025);
    scheduler.advance();
  }
}

describe("Scheduler", () => {
  let tracks: TrackEvents[];
  let clock: FakeClock;
  let sink: RecordingSink;
  let scheduler: Scheduler;

  beforeEach(() => {
    tracks = demoEvents();
    clock = new FakeClock();
    sink = new RecordingSink();
    scheduler = new Scheduler(tracks, TEMPO, clock, sink);
    scheduler.start(0);
  });

  it("곡을 끝까지 굴리면 모든 음이 정확히 한 번씩 예약된다", () => {
    run(scheduler, clock, 33);
    expect(sink.events).toHaveLength(totalCount(tracks));
    expect(scheduler.isDone()).toBe(true);
  });

  it("예약 시각이 음악적 시간과 일치한다", () => {
    run(scheduler, clock, 5);
    const piano = sink.events.filter((e) => e.trackId === "track-piano");
    // 피아노는 마디마다 3화음 하나 — 첫 마디는 0초, 둘째 마디는 2초
    expect(piano[0].when).toBeCloseTo(0, 9);
    expect(piano[3].when).toBeCloseTo(ticksToSeconds(1920, TEMPO), 9);
    expect(piano[3].when).toBeCloseTo(2, 9);
  });

  it("예약 길이가 이벤트 길이와 일치한다", () => {
    run(scheduler, clock, 3);
    const piano = sink.events.find((e) => e.trackId === "track-piano")!;
    // 한 마디(1920틱) = 120BPM에서 2초
    expect(piano.dur).toBeCloseTo(2, 9);
  });

  it("pitch와 velocity를 그대로 넘긴다", () => {
    run(scheduler, clock, 0.05);
    const first = sink.events.find((e) => e.trackId === "track-piano")!;
    expect(first.pitch).toBe(60);
    expect(first.vel).toBe(0.7);

    // 드럼 트랙도 각 이벤트의 pitch·velocity가 자기 트랙 id로 그대로 간다.
    // tick 0에 하이햇(42, 0.5)과 킥(36, 0.9)이 함께 있다.
    const drums = sink.events.filter((e) => e.trackId === "track-drums");
    const hihat = drums.find((e) => e.pitch === DRUM_HIHAT);
    const kick = drums.find((e) => e.pitch === DRUM_KICK);
    expect(hihat).toBeDefined();
    expect(hihat!.vel).toBe(0.5);
    expect(kick).toBeDefined();
    expect(kick!.vel).toBe(0.9);
  });

  it("같은 이벤트를 두 번 예약하지 않는다", () => {
    run(scheduler, clock, 33);
    const keys = sink.events.map((e) => `${e.trackId}:${e.pitch}:${e.when}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("advance를 시간 전진 없이 여러 번 불러도 중복이 없다", () => {
    scheduler.advance();
    const first = sink.events.length;
    scheduler.advance();
    scheduler.advance();
    expect(sink.events).toHaveLength(first);
  });

  it("lookahead 구간 밖은 아직 예약하지 않는다", () => {
    scheduler.advance();
    // lookahead 0.1초 → 0.1초 이후 시작하는 음은 아직 없어야 한다
    for (const event of sink.events) {
      expect(event.when).toBeLessThan(0.1);
    }
  });

  it("horizon 경계에 정확히 걸친 이벤트는 다음 틱으로 넘어간다", () => {
    const boundarySink = new RecordingSink();
    // 피아노 둘째 마디는 1920틱(120BPM에서 2.0초)이므로
    // lookahead를 2초로 잡아 그 경계에 정확히 걸리게 한다
    const s = new Scheduler(demoEvents(), TEMPO, new FakeClock(), boundarySink, 2);
    s.start(0);
    s.advance();
    const pianoWhens = boundarySink.events
      .filter((e) => e.trackId === "track-piano")
      .map((e) => e.when);
    // 0초짜리는 들어오고, 정확히 2.0초짜리는 아직 안 들어온다
    expect(pianoWhens).toContain(0);
    expect(pianoWhens.every((w) => w < 2)).toBe(true);
  });

  it("currentTick이 시간에 비례해 전진한다", () => {
    expect(scheduler.currentTick()).toBeCloseTo(0, 6);
    clock.advanceBy(2);
    // 120BPM에서 2초 = 한 마디 = 1920틱
    expect(scheduler.currentTick()).toBeCloseTo(1920, 6);
  });

  it("start 시각이 0이 아니어도 그 시각을 기준으로 예약한다", () => {
    const c = new FakeClock();
    const s2 = new RecordingSink();
    c.currentTime = 10;
    const sch = new Scheduler(demoEvents(), TEMPO, c, s2);
    sch.start(10.5);
    // 시계가 10초면 horizon(10.1)이 앵커(10.5)보다 앞이라 아무것도 예약되지
    // 않고, 빈 배열의 every는 늘 참이다. 앵커 직전까지 굴려 tick 0의
    // 이벤트가 lookahead 구간(10.45~10.55)에 들어오게 한다.
    c.currentTime = 10.45;
    sch.advance();
    expect(s2.events.length).toBeGreaterThan(0);
    expect(s2.events.every((e) => e.when >= 10.5)).toBe(true);
    const firstPiano = s2.events.find((e) => e.trackId === "track-piano")!;
    expect(firstPiano.when).toBeCloseTo(10.5, 9);
  });

  it("이벤트가 없는 트랙만 있어도 바로 끝난 상태다", () => {
    const empty = new Scheduler(
      [{ trackId: "t", instrument: "piano", events: [] }],
      TEMPO,
      new FakeClock(),
      new RecordingSink(),
    );
    empty.start(0);
    expect(empty.isDone()).toBe(true);
  });
});

describe("Scheduler.setTempo", () => {
  function setup() {
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const scheduler = new Scheduler(demoEvents(), TEMPO, clock, sink);
    scheduler.start(0);
    return { clock, sink, scheduler };
  }

  it("템포를 바꿔도 이미 예약된 구간과 새 구간 사이에 틈이나 겹침이 없다", () => {
    const { clock, sink, scheduler } = setup();

    // 4초까지 120BPM으로 굴린다
    run(scheduler, clock, 4);
    const beforeCount = sink.events.length;
    const lastWhenBefore = Math.max(...sink.events.map((e) => e.when));

    scheduler.setTempo(240);
    run(scheduler, clock, 20);

    const added = sink.events.slice(beforeCount);
    expect(added.length).toBeGreaterThan(0);
    // 새로 예약된 것은 전부 기존 예약 경계 이후다 — 과거에 예약되면 즉시 울린다
    for (const event of added) {
      expect(event.when).toBeGreaterThanOrEqual(lastWhenBefore - 1e-9);
    }

    // 순서만 보면 "현재 위치(3840틱)에 재앵커"처럼 잘못 구현해도 통과한다.
    // 하이햇은 3840틱과 4080틱에 있어 setTempo가 옮기는 경계(scheduledUntilTick
    // = 3936틱)를 사이에 두고 걸친다. 3840틱은 경계 이전이라 120BPM으로 이미
    // 예약됐고(when=4.0), 4080틱은 경계 이후라 240BPM으로 예약된다:
    // 4.1 + (4080 - 3936) / 480 * (60 / 240) = 4.175.
    // 틀린 앵커(3840@4.0)로 계산하면 간격이 0.125가 되어 이 값과 어긋난다.
    const hihatWhens = sink.events
      .filter((e) => e.trackId === "track-drums" && e.pitch === DRUM_HIHAT)
      .map((e) => e.when);
    const beforeBoundary = hihatWhens.find((w) => Math.abs(w - 4.0) < 1e-9);
    const afterBoundary = hihatWhens.find((w) => Math.abs(w - 4.175) < 1e-9);
    expect(beforeBoundary).toBeDefined();
    expect(afterBoundary).toBeDefined();
    expect(afterBoundary! - beforeBoundary!).toBeCloseTo(0.175, 9);
  });

  it("템포를 바꾸면 이후 간격이 새 템포를 따른다", () => {
    const { clock, sink, scheduler } = setup();
    scheduler.setTempo(240);
    run(scheduler, clock, 5);

    const piano = sink.events
      .filter((e) => e.trackId === "track-piano")
      .map((e) => e.when);
    // 240BPM에서 한 마디(1920틱)는 1초
    const uniqueStarts = [...new Set(piano)].sort((a, b) => a - b);
    expect(uniqueStarts[1] - uniqueStarts[0]).toBeCloseTo(1, 6);
  });

  it("tempo 프로퍼티가 현재 값을 돌려준다", () => {
    const { scheduler } = setup();
    expect(scheduler.tempo).toBe(TEMPO);
    scheduler.setTempo(90);
    expect(scheduler.tempo).toBe(90);
  });

  it("템포를 바꿔도 currentTick이 뒤로 가지 않고, lookahead 구간 안에서는 옛 템포를 따른다", () => {
    const { clock, scheduler } = setup();

    // 4초까지 120BPM으로 굴린다. scheduledUntilTick은 timeToTick(4.1) = 3936.
    run(scheduler, clock, 4);
    const beforeTempoChange = scheduler.currentTick();
    expect(beforeTempoChange).toBeCloseTo(3840, 6);

    scheduler.setTempo(240);

    // 시계는 그대로인데 새 앵커(3936@4.1)에서 새 템포로 역산하면 뒤로
    // 튄다 — 3840에서 그대로 이어져야 한다.
    expect(scheduler.currentTick()).toBeCloseTo(beforeTempoChange, 6);
    expect(scheduler.currentTick()).toBeGreaterThanOrEqual(
      beforeTempoChange - 1e-9,
    );

    // t=4.05: 아직 새 앵커 시각(4.1) 이전이므로 옛 템포(120BPM)로 계속
    // 전진해야 한다. 실제로 예약된 소리도 옛 템포로 울리는 구간이다.
    clock.advanceBy(0.05);
    expect(scheduler.currentTick()).toBeCloseTo(3888, 6);
    expect(scheduler.currentTick()).toBeGreaterThan(beforeTempoChange);

    // t=4.1: 새 앵커 시각에 도달 — 옛 앵커와 새 앵커 양쪽으로 계산해도
    // 같은 값(3936)으로 수렴해야 틈이나 겹침이 없다.
    clock.advanceBy(0.05);
    expect(scheduler.currentTick()).toBeCloseTo(3936, 6);
  });

  it("한 lookahead 구간 안에서 템포를 연달아 바꿔도 currentTick이 뒤로 가지 않는다", () => {
    // 슬라이더 드래그는 pointermove마다 setTempo를 부른다. 두 번째 호출이
    // 아직 살아 있는 prevAnchor를 덮어쓰면, 지금 울리고 있는 구간을 중간
    // 템포로 역산해 재생 위치가 다시 뒤로 튄다.
    const { clock, scheduler } = setup();

    run(scheduler, clock, 4);
    const before = scheduler.currentTick();
    expect(before).toBeCloseTo(3840, 6);

    // 시계를 전혀 전진시키지 않고 연달아 두 번 — 드래그의 최악 사례
    scheduler.setTempo(240);
    scheduler.setTempo(300);

    // 이 구간의 소리는 여전히 120BPM으로 예약돼 있으므로 위치도 그대로다
    expect(scheduler.currentTick()).toBeCloseTo(before, 6);

    // 새 앵커 시각(4.1) 이전까지는 옛 템포(120BPM)로 전진한다
    clock.advanceBy(0.05);
    expect(scheduler.currentTick()).toBeCloseTo(3888, 6);
    expect(scheduler.currentTick()).toBeGreaterThan(before);
  });
});

describe("Scheduler 커서", () => {
  it("커서는 뒤로 가지 않는다", () => {
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const scheduler = new Scheduler(demoEvents(), TEMPO, clock, sink);
    scheduler.start(0);

    let previous = 0;
    for (let i = 0; i < 200; i++) {
      clock.advanceBy(0.025);
      scheduler.advance();
      expect(sink.events.length).toBeGreaterThanOrEqual(previous);
      previous = sink.events.length;
    }
  });

  it("PPQ 기준 dur 계산이 음수가 되지 않는다", () => {
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const scheduler = new Scheduler(demoEvents(), TEMPO, clock, sink);
    scheduler.start(0);
    run(scheduler, clock, 33);
    for (const event of sink.events) {
      expect(event.dur).toBeGreaterThan(0);
      expect(Number.isFinite(event.when)).toBe(true);
    }
    expect(PPQ).toBe(480);
  });
});
