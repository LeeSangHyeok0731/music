import { PX_PER_BAR } from "./layout";

/** 마디선과 박선. repeating-linear-gradient라 DOM 노드가 0개다. */
export function BarLines({ width }: { width: number }) {
  const beatWidth = PX_PER_BAR / 4;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-0"
      style={{
        width,
        backgroundImage: [
          `repeating-linear-gradient(to right, rgb(255 255 255 / 0.14) 0 1px, transparent 1px ${PX_PER_BAR}px)`,
          `repeating-linear-gradient(to right, rgb(255 255 255 / 0.05) 0 1px, transparent 1px ${beatWidth}px)`,
        ].join(","),
      }}
    />
  );
}
