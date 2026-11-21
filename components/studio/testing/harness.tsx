import { act, render, screen, type RenderResult } from "@testing-library/react";
import { useEffect, type ReactElement } from "react";

import { StudioProvider } from "@/state/StudioProvider";
import {
  createFakeDeps,
  type FakeDeps,
  type FakeDepsOptions,
} from "@/state/testing/fake-deps";
import type { StudioApi } from "@/state/types";
import { useStudio } from "@/state/useStudio";

import { LANE_LEFT, stubLaneRect } from "./pointer";

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

/**
 * 레인 하나를 렌더하고 그 요소의 화면 사각형을 고정한다(`left = LANE_LEFT`, 폭 1280).
 * `laneTestId`는 `chord-lane`, `track-lane-<id>` 같은 레인의 `data-testid`.
 */
export function renderLane(
  ui: ReactElement,
  laneTestId: string,
  height: number,
  options: FakeDepsOptions = {},
): StudioHarness {
  const harness = renderWithStudio(ui, options);
  stubLaneRect(screen.getByTestId(laneTestId), {
    left: LANE_LEFT,
    width: 1280,
    height,
  });
  return harness;
}

/** `play()`를 시작한다(기본 가짜 엔진이면 재생 중, `playMode: "manual"`이면 대기 중). */
export async function startPlaying(harness: StudioHarness): Promise<void> {
  await act(async () => {
    void harness.studio().play();
  });
}
