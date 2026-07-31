import { beforeEach, describe, expect, it } from "vitest";

import { Scheduler } from "@/lib/audio/scheduler";
import type { AudioClock, NoteSink } from "@/lib/audio/types";
import { buildDemoSong } from "@/lib/score/fixture";
import { ticksToSeconds } from "@/lib/score/time";
import { PPQ, type Song } from "@/lib/score/types";

class FakeClock implements AudioClock {
  currentTime = 0;
  advanceBy(seconds: number): void {
    this.currentTime += seconds;
  }
}

type Recorded = {
  lineId: string;
  note: number;
  when: number;
  dur: number;
  vel: number;
};

class RecordingSink implements NoteSink {
  readonly events: Recorded[] = [];
  schedule(
    lineId: string,
    note: number,
    when: number,
    dur: number,
    vel: number,
  ): void {
    this.events.push({ lineId, note, when, dur, vel });
  }
}

/** 타일 하나에 음이 여러 개면 예약도 그만큼 나온다. */
function totalNoteCount(song: Song): number {
  return song.lines.reduce(
    (sum, line) =>
      sum + line.tiles.reduce((s, tile) => s + tile.notes.length, 0),
    0,
  );
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
  let song: Song;
  let clock: FakeClock;
  let sink: RecordingSink;
  let scheduler: Scheduler;

  beforeEach(() => {
    song = buildDemoSong();
    clock = new FakeClock();
    sink = new RecordingSink();
    scheduler = new Scheduler(song, clock, sink);
    scheduler.start(0);
  });

  it("곡을 끝까지 굴리면 모든 음이 정확히 한 번씩 예약된다", () => {
    run(scheduler, clock, 33);
    expect(sink.events).toHaveLength(totalNoteCount(song));
    expect(scheduler.isDone()).toBe(true);
  });

  it("예약 시각이 음악적 시간과 일치한다", () => {
    run(scheduler, clock, 5);
    const piano = sink.events.filter((e) => e.lineId === "line-piano");
    // 피아노는 마디마다 3화음 하나 — 첫 마디는 0초, 둘째 마디는 2초
    expect(piano[0].when).toBeCloseTo(0, 9);
    expect(piano[3].when).toBeCloseTo(ticksToSeconds(1920, 120), 9);
    expect(piano[3].when).toBeCloseTo(2, 9);
  });

  it("예약 길이가 타일 길이와 일치한다", () => {
    run(scheduler, clock, 3);
    const piano = sink.events.find((e) => e.lineId === "line-piano")!;
    // 피아노 타일은 한 마디(1920틱) = 120BPM에서 2초
    expect(piano.dur).toBeCloseTo(2, 9);
  });

  it("같은 타일을 두 번 예약하지 않는다", () => {
    run(scheduler, clock, 33);
    const keys = sink.events.map((e) => `${e.lineId}:${e.note}:${e.when}`);
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

  it("horizon 경계에 정확히 걸친 타일은 다음 틱으로 넘어간다", () => {
    // lookahead를 0.5초로 두면 첫 advance의 경계는 정확히 1920틱(2초)이 아니라 0.5초
    const boundaryClock = new FakeClock();
    const boundarySink = new RecordingSink();
    // 0.5초 = 240틱. 피아노 두 번째 타일은 1920틱이므로 경계 테스트는
    // lookahead를 2초로 잡아 둘째 마디(정확히 2.0초)가 경계에 걸리게 한다
    const s = new Scheduler(song, boundaryClock, boundarySink, 2);
    s.start(0);
    s.advance();
    const pianoWhens = boundarySink.events
      .filter((e) => e.lineId === "line-piano")
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
    const sch = new Scheduler(song, c, s2);
    sch.start(10.5);
    sch.advance();
    expect(s2.events.every((e) => e.when >= 10.5)).toBe(true);
  });
});

describe("Scheduler.setTempo", () => {
  it("템포를 바꿔도 이미 예약된 구간과 새 구간 사이에 틈이나 겹침이 없다", () => {
    const song = buildDemoSong();
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const scheduler = new Scheduler(song, clock, sink);
    scheduler.start(0);

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
  });

  it("템포를 바꾸면 이후 간격이 새 템포를 따른다", () => {
    const song = buildDemoSong();
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const scheduler = new Scheduler(song, clock, sink);
    scheduler.start(0);
    scheduler.setTempo(240);
    run(scheduler, clock, 5);

    const piano = sink.events
      .filter((e) => e.lineId === "line-piano")
      .map((e) => e.when);
    // 240BPM에서 한 마디(1920틱)는 1초
    const uniqueStarts = [...new Set(piano)].sort((a, b) => a - b);
    expect(uniqueStarts[1] - uniqueStarts[0]).toBeCloseTo(1, 6);
  });

  it("tempo 프로퍼티가 현재 값을 돌려준다", () => {
    const song = buildDemoSong();
    const scheduler = new Scheduler(song, new FakeClock(), new RecordingSink());
    expect(scheduler.tempo).toBe(song.tempo);
    scheduler.setTempo(90);
    expect(scheduler.tempo).toBe(90);
  });
});

describe("Scheduler 커서", () => {
  it("커서는 뒤로 가지 않는다", () => {
    const song = buildDemoSong();
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const scheduler = new Scheduler(song, clock, sink);
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
    const song = buildDemoSong();
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const scheduler = new Scheduler(song, clock, sink);
    scheduler.start(0);
    run(scheduler, clock, 33);
    for (const event of sink.events) {
      expect(event.dur).toBeGreaterThan(0);
      expect(Number.isFinite(event.when)).toBe(true);
    }
    expect(PPQ).toBe(480);
  });
});
