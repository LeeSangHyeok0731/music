import { render, type RenderResult } from "@testing-library/react";
import { useEffect, type ReactElement } from "react";

import { StudioProvider } from "@/state/StudioProvider";
import {
  createFakeDeps,
  type FakeDeps,
  type FakeDepsOptions,
} from "@/state/testing/fake-deps";
import type { StudioApi } from "@/state/types";
import { useStudio } from "@/state/useStudio";

/**
 * 편집 화면 컴포넌트 테스트의 공통 틀(Task 7~10). 가짜 엔진·뱅크·저장소를 끼운
 * `StudioProvider` 안에 렌더하고, 테스트가 `act(() => studio().edit.setBars(9))`처럼
 * 상태 API를 직접 부를 수 있게 최신 `StudioApi`를 돌려준다.
 *
 * ```ts
 * beforeEach(() => { restoreAudio = installAudioContextStub(); });
 * afterEach(() => { cleanup(); restoreAudio(); });
 * const { fake, studio } = renderWithStudio(<Studio />, { statuses: { piano: "error" } });
 * ```
 */

type AudioWindow = { AudioContext?: unknown };

/** Web Audio 미지원 브라우저를 흉내 낸다(`installAudioContextStub` 뒤에 부른다). */
export function removeAudioContextStub(): void {
  delete (window as unknown as AudioWindow).AudioContext;
}

/** jsdom에는 Web Audio가 없다. 지원하는 브라우저인 척한다. 돌려주는 함수가 되돌린다. */
export function installAudioContextStub(): () => void {
  (window as unknown as AudioWindow).AudioContext = class {};
  return removeAudioContextStub;
}

export type StudioHarness = RenderResult & {
  fake: FakeDeps;
  /** 가장 최근 렌더의 `useStudio()`. */
  studio(): StudioApi;
};

export function renderWithStudio(
  ui: ReactElement,
  options: FakeDepsOptions = {},
): StudioHarness {
  const fake = createFakeDeps(options);
  const latest: { api: StudioApi | null } = { api: null };

  function Capture() {
    const api = useStudio();
    useEffect(() => {
      latest.api = api;
    });
    return null;
  }

  const result = render(
    <StudioProvider createDeps={fake.createDeps}>
      <Capture />
      {ui}
    </StudioProvider>,
  );
  return {
    ...result,
    fake,
    studio: () => {
      if (!latest.api) throw new Error("아직 렌더되지 않았습니다");
      return latest.api;
    },
  };
}
