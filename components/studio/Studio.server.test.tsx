// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudioProvider } from "@/state/StudioProvider";

import { Studio } from "./Studio";

describe("Studio 서버 렌더(실제 deps)", () => {
  it("window 없이 실제 엔진·뱅크로 렌더해도 던지지 않고 데모 곡의 코드 구간을 그린다", () => {
    expect(typeof window).toBe("undefined");
    const html = renderToString(
      <StudioProvider>
        <Studio />
      </StudioProvider>,
    );
    for (const label of ["C", "Am", "F", "G7"]) {
      expect(html).toContain(`>${label}</button>`);
    }
    // 데모 곡 8마디의 눈금, 마디 버튼, 트랙 4줄.
    expect(html).toContain('aria-label="마디 추가"');
    expect(html).toContain('aria-label="마디 삭제"');
    expect(html.match(/data-testid="track-lane-/g)).toHaveLength(4);
    expect(html.match(/data-testid="ruler"/g)).toHaveLength(1);
  });
});
