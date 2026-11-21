import { describe, expect, it } from "vitest";

import { patternLabel } from "./pattern-labels";
import { PATTERNS } from "./patterns";

describe("patternLabel", () => {
  it("화면에 보이는 이름 표", () => {
    expect(patternLabel("piano-block")).toBe("블록 코드");
    expect(patternLabel("piano-arpeggio-8th")).toBe("8분 아르페지오");
    expect(patternLabel("guitar-strum-quarter")).toBe("4분 스트럼");
    expect(patternLabel("bass-root-quarter")).toBe("근음 4분");
    expect(patternLabel("bass-root-fifth")).toBe("근음·5도");
    expect(patternLabel("drum-basic-rock")).toBe("기본 락");
    expect(patternLabel("drum-four-on-floor")).toBe("포 온 더 플로어");
  });

  it("카탈로그의 모든 패턴에 id와 다른 이름이 있다(새 패턴은 이름도 추가해야 한다)", () => {
    for (const p of PATTERNS) {
      const label = patternLabel(p.id);
      expect(label.trim(), p.id).not.toBe("");
      expect(label, p.id).not.toBe(p.id);
    }
  });

  it("모르는 id는 id 그대로", () => {
    expect(patternLabel("no-such-pattern")).toBe("no-such-pattern");
    expect(patternLabel("")).toBe("");
  });

  it("Object.prototype 속성 이름도 id로 취급한다", () => {
    expect(patternLabel("toString")).toBe("toString");
    expect(patternLabel("__proto__")).toBe("__proto__");
  });
});
