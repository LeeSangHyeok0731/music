/**
 * 패턴의 화면 표시 이름. 패턴 데이터(`patterns.ts`)와 id는 불변이라 이름은 여기에
 * 따로 둔다. 새 패턴을 추가하면 이름도 추가해야 한다(`pattern-labels.test.ts`가 지킨다).
 */
const LABELS: ReadonlyMap<string, string> = new Map([
  ["piano-block", "블록 코드"],
  ["piano-arpeggio-8th", "8분 아르페지오"],
  ["guitar-strum-quarter", "4분 스트럼"],
  ["bass-root-quarter", "근음 4분"],
  ["bass-root-fifth", "근음·5도"],
  ["drum-basic-rock", "기본 락"],
  ["drum-four-on-floor", "포 온 더 플로어"],
]);

/** 모르는 id는 id 그대로. */
export function patternLabel(id: string): string {
  return LABELS.get(id) ?? id;
}
