"use client";

import { useSyncExternalStore } from "react";

import { isAudioSupported } from "@/lib/audio/context";
import { useStudio } from "@/state/useStudio";

// isAudioSupported()는 window를 읽으므로 SSR 스냅샷과 다르다.
// SSR에서는 true를, 마운트 후에는 실제 값을 돌려준다.
function subscribeNever() {
  return () => {};
}
const serverSupported = () => true;

/** 이 브라우저가 Web Audio를 지원하는가(서버 렌더에서는 참). */
export function useAudioSupported(): boolean {
  return useSyncExternalStore(subscribeNever, isAudioSupported, serverSupported);
}

/**
 * 상단 바와 피아노롤 헤더가 함께 쓰는 알림 줄: Web Audio 미지원, 재생 중 편집 불가, 샘플 로딩,
 * Provider 메시지(닫기 버튼 포함). 안내가 나타나고 사라져도 본문이 밀리지 않게 한 줄 높이를
 * 항상 비워 둔다. 같은 화면에 둘이 함께 있을 수 있어 `testId`를 받는다.
 */
export function MessageStrip({ testId = "message-strip" }: { testId?: string }) {
  const { playing, pending, message, dismissMessage } = useStudio();
  const supported = useAudioSupported();

  return (
    <div
      data-testid={testId}
      className="flex min-h-7 flex-wrap items-center gap-x-4 px-3 pb-2"
    >
      {!supported && (
        <p role="alert" className="text-amber-400">
          이 브라우저는 Web Audio를 지원하지 않습니다.
        </p>
      )}
      {playing && (
        <p role="status" className="text-zinc-400">
          재생 중에는 편집할 수 없습니다
        </p>
      )}
      {pending && (
        <p role="status" className="text-zinc-400">
          샘플을 불러오는 중…
        </p>
      )}
      {message && (
        <p role="alert" className="flex items-center gap-2 text-amber-400">
          <span>{message}</span>
          <button
            type="button"
            aria-label="메시지 닫기"
            onClick={dismissMessage}
            className="rounded px-1.5 text-zinc-400 hover:bg-white/10"
          >
            ×
          </button>
        </p>
      )}
    </div>
  );
}
