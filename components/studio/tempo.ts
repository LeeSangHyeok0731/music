/**
 * 템포 입력 문자열을 숫자로 바꾼다. 유한한 수가 아니면 null — 범위 자르기는
 * 여기서 하지 않는다(`setTempo` 편집 함수가 `MIN_TEMPO..MAX_TEMPO`로 자른다).
 * `Number("")`와 `Number("  ")`는 0이라 빈 입력을 따로 걸러 낸다.
 */
export function parseTempoInput(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
