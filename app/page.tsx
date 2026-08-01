import { Timeline } from "@/components/timeline/Timeline";
import { TransportBar } from "@/components/transport/TransportBar";
import { StudioProvider } from "@/state/StudioProvider";

export default function Home() {
  return (
    <StudioProvider>
      {/*
        DAW 셸이라 화면을 꽉 채우고 바깥은 스크롤하지 않는다. 스크롤은
        타임라인 안쪽에서만 일어난다.
      */}
      <div className="flex h-dvh flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-6 border-b border-white/10 bg-[#141519] px-5 py-2.5">
          <h1 className="shrink-0 text-[13px] font-semibold tracking-wide text-zinc-100">
            Bandline
          </h1>
          <TransportBar />
        </header>

        <main className="min-h-0 flex-1">
          <Timeline />
        </main>
      </div>
    </StudioProvider>
  );
}
