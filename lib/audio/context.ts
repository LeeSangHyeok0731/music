"use client";

type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let ctx: AudioContext | null = null;

function getConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as WebkitWindow).webkitAudioContext ?? null;
}

export function isAudioSupported(): boolean {
  return getConstructor() !== null;
}

/**
 * 앱 전체에 AudioContext는 하나다. 반드시 사용자 제스처 핸들러 안에서
 * 처음 호출해야 한다.
 */
export function getAudioContext(): AudioContext {
  if (ctx) return ctx;

  const Ctor = getConstructor();
  if (!Ctor) {
    throw new Error("이 브라우저는 Web Audio를 지원하지 않습니다.");
  }
  ctx = new Ctor();
  return ctx;
}

/**
 * 자동재생 정책상 컨텍스트는 suspended로 시작한다. 사용자 제스처 핸들러
 * 안에서 이걸 await해야 소리가 난다. 탭이 백그라운드에 다녀오면 다시
 * suspended가 될 수 있어 재생 시작마다 부른다.
 */
export async function ensureRunning(): Promise<void> {
  const context = getAudioContext();
  if (context.state !== "running") {
    await context.resume();
  }
}
