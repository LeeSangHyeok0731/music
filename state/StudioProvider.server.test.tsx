// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudioProvider } from "@/state/StudioProvider";
import { useStudio } from "@/state/useStudio";

function Probe() {
  const s = useStudio();
  return (
    <p>
      {s.song.tempo}/{s.song.bars}/{s.sampleStatuses.piano}/{String(s.editable)}
    </p>
  );
}

describe("StudioProvider 서버 렌더(실제 deps)", () => {
  it("window 없이 실제 엔진·뱅크로 렌더해도 던지지 않고 데모 곡·idle 상태를 그린다", () => {
    expect(typeof window).toBe("undefined");
    const html = renderToString(
      <StudioProvider>
        <Probe />
      </StudioProvider>,
    );
    // React는 텍스트 조각 사이에 <!-- -->를 넣는다.
    expect(html.replace(/<!-- -->/g, "")).toBe("<p>120/8/idle/true</p>");
  });
});
