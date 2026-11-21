/**
 * 시드 고정 난수(mulberry32). 속성 테스트가 같은 시드에서 같은 열을 만들도록
 * `Math.random` 대신 쓴다. [0, 1) 구간의 실수를 돌려준다.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
