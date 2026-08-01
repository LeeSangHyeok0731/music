import { Timeline } from "@/components/timeline/Timeline";
import { TransportBar } from "@/components/transport/TransportBar";
import { StudioProvider } from "@/state/StudioProvider";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-950">
      <StudioProvider>
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-6 py-10">
          <h1 className="text-lg font-semibold text-zinc-100">Bandline</h1>
          <TransportBar />
          <Timeline />
        </main>
      </StudioProvider>
    </div>
  );
}
