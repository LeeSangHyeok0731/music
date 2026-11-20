// 개발용 임시 톤 팩을 만든다. 직접 생성한 사인파·노이즈이며 저작권 문제가 없다.
// 소리 파이프라인(받기 → 디코드 → 음높이 보정 → 스케줄)을 브라우저에서 끝까지
// 돌려 보기 위한 것이지, 음색 품질을 위한 것이 아니다.
// 실제 샘플 팩은 계획의 Task 15에서 넣고, 그때 이 스크립트의 출력은 지운다.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "public", "samples");
const RATE = 22050;

/** 16비트 모노 WAV. */
function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => {
    data.writeInt16LE((Math.max(-1, Math.min(1, s)) * 32767) | 0, i * 2);
  });
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const freq = (pitch) => 440 * 2 ** ((pitch - 69) / 12);

/** 배음 목록(비율, 진폭)과 감쇠로 음 하나를 만든다. */
function tone(pitch, seconds, partials, decay) {
  const n = Math.floor(RATE * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.005) * Math.exp(-t * decay);
    let s = 0;
    for (const [ratio, amp] of partials) {
      s += amp * Math.sin(2 * Math.PI * freq(pitch) * ratio * t);
    }
    out[i] = 0.4 * env * s;
  }
  return out;
}

// 결정적인 노이즈(같은 입력이면 같은 파일이 나온다)
function makeNoise() {
  let seed = 12345;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };
}

function kick() {
  const n = Math.floor(RATE * 0.35);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = 45 + 95 * Math.exp(-t * 30);
    phase += (2 * Math.PI * f) / RATE;
    out[i] = 0.9 * Math.exp(-t * 9) * Math.sin(phase);
  }
  return out;
}

function noiseHit(seconds, decay, highpass) {
  const rand = makeNoise();
  const n = Math.floor(RATE * seconds);
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const x = rand();
    // 단순 1차 고역 통과
    const y = highpass ? x - prev * 0.9 : x;
    prev = x;
    out[i] = 0.5 * Math.exp(-t * decay) * y;
  }
  return out;
}

function write(instrument, zones, build) {
  const dir = path.join(ROOT, instrument);
  mkdirSync(dir, { recursive: true });
  const manifest = { instrument, zones: [] };
  for (const z of zones) {
    const file = `${z.name}.wav`;
    writeFileSync(path.join(dir, file), wav(build(z)));
    manifest.zones.push({
      file,
      centerPitch: z.center,
      loPitch: z.lo,
      hiPitch: z.hi,
    });
  }
  writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

/** center 목록에서 이웃 사이를 반으로 나눠 존 범위를 만든다. */
function pitchedZones(centers) {
  return centers.map((center, i) => ({
    name: `p${center}`,
    center,
    lo: i === 0 ? 0 : Math.ceil((centers[i - 1] + center) / 2),
    hi: i === centers.length - 1 ? 127 : Math.ceil((center + centers[i + 1]) / 2) - 1,
  }));
}

const steps = (from, to, step) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

write("piano", pitchedZones(steps(36, 96, 6)), (z) =>
  tone(z.center, 1.2, [[1, 1], [2, 0.35], [3, 0.12]], 3.5),
);
write("guitar", pitchedZones(steps(36, 84, 6)), (z) =>
  tone(z.center, 1.0, [[1, 1], [2, 0.6], [3, 0.4], [4, 0.25]], 4.5),
);
write("bass", pitchedZones(steps(24, 60, 6)), (z) =>
  tone(z.center, 0.9, [[1, 1], [2, 0.2]], 3.0),
);
write(
  "drums",
  [
    { name: "kick", center: 36, lo: 36, hi: 36 },
    { name: "snare", center: 38, lo: 38, hi: 38 },
    { name: "hihat", center: 42, lo: 42, hi: 42 },
  ],
  (z) =>
    z.name === "kick"
      ? kick()
      : z.name === "snare"
        ? noiseHit(0.25, 14, false)
        : noiseHit(0.08, 60, true),
);

console.log(`개발용 톤 팩을 ${ROOT}에 만들었습니다.`);
