import { PPQ, type Song } from "@/lib/score/types";

import type { AudioClock, NoteSink } from "./types";

/**
 * look-ahead 스케줄러.
 *
 * 타이머가 얼마나 정확한지에 의존하지 않는다. 타이머의 역할은 "충분히 미리
 * 예약했는가"뿐이고, 한 번 예약된 노드는 타이머가 늦어도 정확한 시각에 울린다.
 *
 * 시각 계산은 앵커 방식이다. 재생 위치를 pos += delta로 굴리지 않고 항상
 * 정수 앵커에서 다시 계산하므로 부동소수 오차가 쌓이지 않는다.
 */
export class Scheduler {
  private readonly song: Song;
  private readonly clock: AudioClock;
  private readonly sink: NoteSink;
  private readonly lookahead: number;

  /** 라인별 "다음에 예약할 타일" 인덱스. 전체 스캔을 피하는 장치. */
  private cursors: number[] = [];

  private anchorTick = 0;
  private anchorTime = 0;
  private bpm: number;

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
    lookaheadSeconds = 0.1,
  ) {
    this.song = song;
    this.clock = clock;
    this.sink = sink;
    this.lookahead = lookaheadSeconds;
    this.bpm = song.tempo;
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
  }

  tickToTime(tick: number): number {
    return this.anchorTime + ((tick - this.anchorTick) / PPQ) * (60 / this.bpm);
  }

  timeToTick(time: number): number {
    return this.anchorTick + (((time - this.anchorTime) * this.bpm) / 60) * PPQ;
  }

  /** 표시용 현재 틱. 재생 중이 아니면 의미가 없다. */
  currentTick(): number {
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
    this.anchorTime = this.tickToTime(boundary);
    this.anchorTick = boundary;
    this.bpm = bpm;
  }
}
