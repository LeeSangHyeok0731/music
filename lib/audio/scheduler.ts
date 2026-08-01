import { PPQ, type Song } from "@/lib/score/types";

import type { AudioClock, NoteSink } from "./types";

/**
 * 스케줄러의 note lookahead와 engine.ts의 메트로놈 클릭 horizon이 반드시
 * 같은 값을 써야 한다. setTempo가 scheduledUntilTick(= 이 lookahead로
 * 정해지는 경계)에 새 앵커를 놓는데, 둘이 어긋나면 그 경계 부근의 클릭이
 * 곡 노트와 다른 앵커로 계산돼 템포 변경 때마다 메트로놈이 곡에서 슬쩍
 * 어긋난다. 하나로 export해서 둘 다 이 값을 읽게 한다.
 */
export const LOOKAHEAD_SECONDS = 0.1;

/**
 * look-ahead 스케줄러.
 *
 * 타이머가 얼마나 정확한지에 의존하지 않는다. 타이머의 역할은 "충분히 미리
 * 예약했는가"뿐이고, 한 번 예약된 노드는 타이머가 늦어도 정확한 시각에 울린다.
 *
 * 시각 계산은 앵커 방식이다. 재생 위치를 pos += delta로 굴리지 않고 항상
 * 저장된 앵커 하나에서 다시 계산하므로 부동소수 오차가 쌓이지 않는다.
 * 앵커 틱이 정수라서가 아니다 — setTempo가 재앵커하는 경계는 부동소수
 * 시각에서 역산한 값이라 정수라는 보장이 없다.
 */
export class Scheduler {
  private readonly song: Song;
  private readonly clock: AudioClock;
  private readonly sink: NoteSink;
  private readonly lookahead: number;

  /** 라인별 "다음에 예약할 타일" 인덱스. 전체 스캔을 피하는 장치. */
  private cursors: number[];

  private anchorTick = 0;
  private anchorTime = 0;
  private bpm: number;

  /**
   * setTempo 직전까지 쓰던 앵커. 새 앵커는 미래(scheduledUntilTick)를
   * 가리키므로, 그 미래 시각에 아직 도달하지 않은 lookahead 구간 동안은
   * currentTick()이 새 템포가 아니라 이 옛 앵커로 역산해야 한다 —
   * 그 구간은 이미 옛 템포로 예약이 끝났기 때문이다.
   */
  private prevAnchor: { tick: number; time: number; bpm: number } | null =
    null;

  /** 이 틱보다 앞은 예약이 끝났다. setTempo가 앵커를 옮길 기준점. */
  private scheduledUntilTick = 0;

  /**
   * @param lookaheadSeconds 늘리면 안정적이지만 템포 변경 반응이 느려진다.
   *   0.1초는 25ms 타이머가 세 번 밀려도 버티는 값이다.
   */
  constructor(
    song: Song,
    clock: AudioClock,
    sink: NoteSink,
    lookaheadSeconds = LOOKAHEAD_SECONDS,
  ) {
    this.song = song;
    this.clock = clock;
    this.sink = sink;
    this.lookahead = lookaheadSeconds;
    this.bpm = song.tempo;
    // start() 전에 advance()가 불려도 undefined 커서로 조용히 no-op하지
    // 않도록 라인 수만큼 0으로 채워 둔다.
    this.cursors = song.lines.map(() => 0);
  }

  get tempo(): number {
    return this.bpm;
  }

  /** @param atTime 곡의 0틱이 울릴 절대 시각. */
  start(atTime: number): void {
    this.anchorTime = atTime;
    this.anchorTick = 0;
    this.scheduledUntilTick = 0;
    this.cursors = this.song.lines.map(() => 0);
    // 새 재생은 옛 템포 구간이 없다 — 지난 재생의 앵커가 남아 있으면 안 된다.
    this.prevAnchor = null;
  }

  tickToTime(tick: number): number {
    return this.anchorTime + ((tick - this.anchorTick) / PPQ) * (60 / this.bpm);
  }

  timeToTick(time: number): number {
    return this.anchorTick + (((time - this.anchorTime) * this.bpm) / 60) * PPQ;
  }

  /** 표시용 현재 틱. 재생 중이 아니면 의미가 없다. */
  currentTick(): number {
    // setTempo 직후 anchorTime은 미래(scheduledUntilTick 시각)를 가리킨다.
    // 그 시각에 아직 도달하지 않았다면 지금 재생 중인 소리는 여전히 옛
    // 템포로 예약된 것이므로, 새 앵커로 역산하면 재생 위치가 거꾸로 튄다.
    // 옛 앵커(prevAnchor)로 계산해 옛 템포를 그대로 따라간다.
    if (this.prevAnchor !== null && this.clock.currentTime < this.anchorTime) {
      const { tick, time, bpm } = this.prevAnchor;
      return tick + (((this.clock.currentTime - time) * bpm) / 60) * PPQ;
    }
    return this.timeToTick(this.clock.currentTime);
  }

  isDone(): boolean {
    return this.song.lines.every(
      (line, i) => this.cursors[i] >= line.tiles.length,
    );
  }

  /** 타이머가 부를 때마다 lookahead 구간 안의 타일을 예약한다. */
  advance(): void {
    const horizonTime = this.clock.currentTime + this.lookahead;
    const horizonTick = this.timeToTick(horizonTime);

    this.song.lines.forEach((line, i) => {
      let cursor = this.cursors[i];

      while (cursor < line.tiles.length) {
        const tile = line.tiles[cursor];
        // 경계에 정확히 걸친 타일은 다음 틱으로 넘긴다
        if (tile.start >= horizonTick) break;

        const when = this.tickToTime(tile.start);
        const dur = (tile.length / PPQ) * (60 / this.bpm);
        for (const note of tile.notes) {
          this.sink.schedule(line.id, note, when, dur, tile.velocity);
        }
        cursor++;
      }

      this.cursors[i] = cursor;
    });

    if (horizonTick > this.scheduledUntilTick) {
      this.scheduledUntilTick = horizonTick;
    }
  }

  /**
   * 앵커를 "이미 예약이 끝난 경계"로 옮기고 새 BPM을 넣는다.
   * 이미 예약된 노트는 옛 템포로 그대로 울리고, 그 다음부터 새 템포가
   * 이어져 틈도 겹침도 생기지 않는다.
   */
  setTempo(bpm: number): void {
    const boundary = this.scheduledUntilTick;
    // currentTick()이 lookahead 구간 동안 참조할 옛 앵커를 남겨 둔다.
    // tickToTime(예약 경로)은 아래에서 갱신되는 새 앵커만 본다 — 예약
    // 로직은 그대로 두고 표시 경로(currentTick)만 이 값을 추가로 본다.
    //
    // 아직 살아 있는 prevAnchor는 덮어쓰지 않는다. 슬라이더 드래그처럼
    // setTempo가 한 lookahead 구간 안에 연달아 오면, 지금 재생 중인 소리는
    // 여전히 "첫 변경 이전" 템포로 예약된 것이기 때문이다. 덮어쓰면
    // currentTick()이 그 구간을 중간 템포로 역산해 다시 뒤로 튄다.
    if (
      this.prevAnchor === null ||
      this.clock.currentTime >= this.anchorTime
    ) {
      this.prevAnchor = {
        tick: this.anchorTick,
        time: this.anchorTime,
        bpm: this.bpm,
      };
    }
    this.anchorTime = this.tickToTime(boundary);
    this.anchorTick = boundary;
    this.bpm = bpm;
  }
}
