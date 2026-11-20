// 실제 샘플 팩(public/samples/**)을 CC0 원본에서 다시 만든다.
//
//   pnpm build:samples
//
// 1. 출처 저장소마다 고정 커밋의 LICENSE가 CC0 1.0 Universal인지 확인한다
//    (GitHub API의 SPDX도 확인 — `gh`가 없으면 그 한 가지만 건너뛴다). 아니면 멈춘다.
// 2. 필요한 원본만 고정 커밋의 raw URL에서 받아 `.sample-cache/`에 둔다
//    (이미 있으면 다시 받지 않는다).
// 3. 모노 → 온셋 정렬 → 자르기 → 끝 페이드 → 22050Hz 재샘플링(카이저 창 sinc) →
//    정규화 → 16비트 PCM 모노 WAV.
// 4. 매니페스트와 LICENSES.md를 쓰고, 출력마다 기본 주파수·피크·클리핑 등을
//    점검해 표로 출력한다. 피치 악기의 음높이가 존 중심에서 ±50센트를 벗어나면 멈춘다.
//
// `public/samples/`는 통째로 이 스크립트의 출력이다 — 시작할 때 비운다.
// 결정성: 같은 캐시로 두 번 돌리면 WAV와 manifest.json은 바이트 단위로 같다.
// LICENSES.md는 `- 내려받은 날짜:` 줄(실행일)만 달라진다.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import decodeAudio from "audio-decode";

import { INSTRUMENTS, OUTPUT_RATE, SOURCES, TARGET_PEAK } from "./sample-pack.config.mjs";
import {
  cropFromOnset,
  decodeWav16,
  encodeWav16,
  estimatePitch,
  fadeOut,
  measure,
  peakOf,
  resample,
  toMono,
} from "./sample-pack/dsp.mjs";
import { assertCc0LicenseText, assertCc0Spdx } from "./sample-pack/license.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_ROOT = path.join(REPO_ROOT, "public", "samples");
const CACHE_ROOT = path.join(REPO_ROOT, ".sample-cache");
const PITCH_TOLERANCE_CENTS = 50;

const stats = { downloadedBytes: 0, downloadedFiles: 0, cachedFiles: 0 };

const rawUrl = (src, file) =>
  `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${src.sha}/${file
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
const repoUrl = (src) => `https://github.com/${src.owner}/${src.repo}/tree/${src.sha}`;
const blobUrl = (src, file) =>
  `https://github.com/${src.owner}/${src.repo}/blob/${src.sha}/${file
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

/** 고정 커밋의 파일을 캐시에서 읽고, 없으면 받는다. */
async function fetchCached(src, file) {
  const cached = path.join(CACHE_ROOT, src.owner, src.repo, src.sha, ...file.split("/"));
  if (existsSync(cached)) {
    stats.cachedFiles++;
    return readFileSync(cached);
  }
  const url = rawUrl(src, file);
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`받기 실패(네트워크): ${url}: ${error.message}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`받기 실패: ${url}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(path.dirname(cached), { recursive: true });
  // 중간에 끊긴 파일이 캐시로 남지 않게 임시 이름으로 쓴 뒤 바꾼다.
  writeFileSync(`${cached}.part`, bytes);
  renameSync(`${cached}.part`, cached);
  stats.downloadedBytes += bytes.length;
  stats.downloadedFiles++;
  console.log(`  받음 ${(bytes.length / 1e6).toFixed(2)}MB ${src.repo}/${file}`);
  return bytes;
}

/** `gh api`로 SPDX를 읽는다. `gh`가 없으면 null. */
function githubSpdx(src) {
  try {
    return execFileSync(
      "gh",
      ["api", `repos/${src.owner}/${src.repo}/license?ref=${src.sha}`, "--jq", ".license.spdx_id"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(
      `${src.owner}/${src.repo}: gh api로 라이선스를 확인하지 못했습니다: ${String(error.stderr || error.message).trim()}`,
      { cause: error },
    );
  }
}

async function verifyLicenses() {
  for (const [key, src] of Object.entries(SOURCES)) {
    const label = `${src.owner}/${src.repo}@${src.sha.slice(0, 7)}`;
    const text = (await fetchCached(src, "LICENSE")).toString("utf8");
    assertCc0LicenseText(text, label);
    const spdx = githubSpdx(src);
    if (spdx === null) {
      console.warn(`  ${label}: gh가 없어 SPDX 확인을 건너뜁니다(LICENSE 본문은 확인함)`);
    } else {
      assertCc0Spdx(spdx, label);
    }
    console.log(`  라이선스 확인: ${key} ${label} LICENSE=CC0 1.0 Universal, SPDX=${spdx ?? "(건너뜀)"}`);
  }
}

const NOTE_BASE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** `C4`, `F#2`, `eb3`, `db2` → MIDI (C4=60). */
function noteToMidi(name) {
  const m = /^([a-gA-G])([#b]?)(-?\d+)$/.exec(name);
  if (!m) throw new Error(`음 이름을 읽을 수 없습니다: ${name}`);
  const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + NOTE_BASE[m[1].toLowerCase()] + accidental;
}

/** center 목록에서 이웃 사이를 반으로 나눠 0..127을 빈틈·겹침 없이 덮는다. */
function pitchedRanges(centers) {
  return centers.map((center, i) => ({
    center,
    lo: i === 0 ? 0 : Math.ceil((centers[i - 1] + center) / 2),
    hi: i === centers.length - 1 ? 127 : Math.ceil((center + centers[i + 1]) / 2) - 1,
  }));
}

async function decodeSource(bytes) {
  const audio = await decodeAudio(bytes);
  return { mono: toMono(audio.channelData), rate: audio.sampleRate, channels: audio.channelData.length };
}

/** 모노 → 온셋 정렬 → 자르기 → 페이드 → 재샘플링. 정규화 전 실수 샘플을 돌려준다. */
function shape(source, seconds, fadeMs) {
  const cropped = cropFromOnset(source.mono, source.rate, seconds, 5);
  fadeOut(cropped.samples, source.rate, fadeMs);
  const out = resample(cropped.samples, source.rate, OUTPUT_RATE, {
    outLength: Math.round(seconds * OUTPUT_RATE),
  });
  return { out, cropped };
}

const scale = (x, gain) => x.map((v) => v * gain);

async function buildPitched(inst) {
  const src = SOURCES[inst.source];
  const zones = [];
  const centers = inst.notes.map((note) => noteToMidi(note) + inst.soundingOffset);
  const ranges = pitchedRanges(centers);
  for (let i = 0; i < inst.notes.length; i++) {
    const note = inst.notes[i];
    const file = inst.path(note);
    const source = await decodeSource(await fetchCached(src, file));
    const { out, cropped } = shape(source, inst.seconds, inst.fadeMs);
    const gain = TARGET_PEAK / peakOf(out);
    zones.push({
      file: `p${ranges[i].center}.wav`,
      ...ranges[i],
      sourceFile: file,
      sourceRate: source.rate,
      sourceChannels: source.channels,
      padded: cropped.padded,
      gain,
      samples: scale(out, gain),
    });
  }
  return zones;
}

async function buildDrums(inst) {
  const src = SOURCES[inst.source];
  const shaped = [];
  for (const hit of inst.hits) {
    const source = await decodeSource(await fetchCached(src, hit.path));
    const { out, cropped } = shape(source, hit.seconds, inst.fadeMs);
    shaped.push({ hit, source, out, cropped });
  }
  // 키트 균형을 위해 세 소리에 같은 게인을 쓴다.
  const gain = TARGET_PEAK / Math.max(...shaped.map((s) => peakOf(s.out)));
  return shaped.map(({ hit, source, out, cropped }) => ({
    file: `${hit.name}.wav`,
    center: hit.pitch,
    lo: hit.pitch,
    hi: hit.pitch,
    sourceFile: hit.path,
    sourceRate: source.rate,
    sourceChannels: source.channels,
    padded: cropped.padded,
    gain,
    why: hit.why,
    samples: scale(out, gain),
  }));
}

function processingLine(inst, zones) {
  const channels = [...new Set(zones.map((z) => z.sourceChannels))].sort().join("/");
  const rates = [...new Set(zones.map((z) => z.sourceRate))].sort().join("/");
  const parts = [
    `원본 ${rates}Hz ${channels}채널 → 채널 평균으로 모노`,
    "온셋(피크의 1%를 처음 넘는 곳) 5ms 앞에서 시작",
    inst.pitched
      ? `${inst.seconds}s로 자름`
      : `자른 길이 ${inst.hits.map((h) => `${h.name} ${h.seconds}s`).join(", ")}`,
    `끝 ${inst.fadeMs}ms 코사인 페이드아웃`,
    `${OUTPUT_RATE}Hz로 재샘플링(카이저 창 sinc 저역통과, 컷오프 ${(0.45 * OUTPUT_RATE).toFixed(0)}Hz)`,
    inst.pitched
      ? `존마다 피크 ${TARGET_PEAK}로 정규화`
      : `세 소리에 같은 게인을 적용해 가장 큰 피크 ${TARGET_PEAK}로 정규화`,
    "16비트 PCM 모노 WAV",
  ];
  const files = zones.map((z) => `\`${z.sourceFile}\` → \`${z.file}\``).join(", ");
  return `${parts.join(" → ")}. 사용한 원본: ${files}`;
}

function licensesMarkdown(date) {
  const lines = [
    "# 샘플 출처와 라이선스",
    "",
    "이 파일은 `scripts/build-sample-pack.mjs`가 만든다 — 손으로 고치지 말고 `scripts/sample-pack.config.mjs`를 고친 뒤 `pnpm build:samples`를 다시 돌린다.",
    "모든 원본은 아래 고정 커밋의 파일이고, 빌드가 그 커밋의 LICENSE 본문(CC0 1.0 Universal)과 GitHub API의 SPDX(`CC0-1.0`)를 확인한다.",
    "",
  ];
  for (const inst of INSTRUMENTS) {
    const src = SOURCES[inst.source];
    const zones = built.get(inst.id);
    const origin = inst.info.sourceDir
      ? `${repoUrl(src)}/${inst.info.sourceDir.split("/").map(encodeURIComponent).join("/")}`
      : repoUrl(src);
    lines.push(
      `## ${inst.id}`,
      "",
      `- 팩 이름: ${inst.info.packName}`,
      `- 출처 URL: ${origin} (저장소 \`${src.owner}/${src.repo}\`, 커밋 \`${src.sha}\`)`,
      "- 라이선스: CC0 1.0 Universal",
      `- 라이선스 확인 URL: ${blobUrl(src, "LICENSE")}`,
      `- 내려받은 날짜: ${date}`,
      `- 가공: ${processingLine(inst, zones)}`,
    );
    if (inst.info.note) lines.push(`- 비고: ${inst.info.note}`);
    if (!inst.pitched) {
      for (const z of zones) lines.push(`- 고른 근거(${z.file}): ${z.why}`);
    }
    lines.push(`- 사용한 녹음: ${inst.info.used}`);
    for (const fact of inst.info.facts) lines.push(`- 원문: ${fact}`);
    lines.push("");
  }
  return lines.join("\n");
}

const built = new Map();

function encodeAll() {
  for (const inst of INSTRUMENTS) {
    for (const z of built.get(inst.id)) z.bytes = encodeWav16(z.samples, OUTPUT_RATE);
  }
}

function writeOutputs() {
  // 출력 폴더는 통째로 이 스크립트의 것이다. 옛 파일(개발용 톤 등)이 고아로 남지 않게 비운다.
  rmSync(OUT_ROOT, { recursive: true, force: true });
  for (const inst of INSTRUMENTS) {
    const dir = path.join(OUT_ROOT, inst.id);
    mkdirSync(dir, { recursive: true });
    const zones = built.get(inst.id);
    for (const z of zones) writeFileSync(path.join(dir, z.file), z.bytes);
    const manifest = {
      instrument: inst.id,
      zones: zones.map((z) => ({ file: z.file, centerPitch: z.center, loPitch: z.lo, hiPitch: z.hi })),
    };
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  }
  const date = process.env.SAMPLE_PACK_DATE ?? new Date().toLocaleDateString("sv-SE");
  writeFileSync(path.join(OUT_ROOT, "LICENSES.md"), licensesMarkdown(date));
}

/**
 * 인코딩한 WAV 바이트를 다시 디코드해 점검한다. 피치가 ±50센트를 벗어나거나
 * 클리핑이 있으면 던진다 — 그때는 public/samples/를 건드리지 않는다.
 */
function check() {
  const rows = [];
  const failures = [];
  let total = 0;
  for (const inst of INSTRUMENTS) {
    let instBytes = 0;
    for (const z of built.get(inst.id)) {
      const bytes = z.bytes;
      instBytes += bytes.length;
      const wav = decodeWav16(bytes);
      const m = measure(wav.samples, wav.ints, wav.rate);
      let pitch = "";
      if (inst.pitched) {
        const p = estimatePitch(wav.samples, wav.rate, z.center);
        const spread = p.estimates.map((e) => e.cents.toFixed(0)).join("/");
        pitch = `${p.median.freq.toFixed(2)}Hz (기대 ${p.expected.toFixed(2)}Hz) ${p.median.cents >= 0 ? "+" : ""}${p.median.cents.toFixed(1)}c [창별 ${spread}]`;
        if (Math.abs(p.median.cents) > PITCH_TOLERANCE_CENTS) {
          failures.push(`${inst.id}/${z.file}: ${pitch}`);
        }
      }
      if (m.clipped > 0) failures.push(`${inst.id}/${z.file}: 클리핑 ${m.clipped}샘플`);
      rows.push(
        `| ${inst.id} | ${z.file} | ${z.sourceFile.split("/").pop()} | ${z.center} | ${z.lo}–${z.hi} | ${m.seconds.toFixed(3)} | ${bytes.length} | ${m.peak.toFixed(4)} | ${m.rms.toFixed(4)} | ${m.dc.toExponential(1)} | ${m.firstMs.toFixed(1)} | ${m.tailMean.toExponential(1)} | ${m.clipped} | ${z.sourceRate}/${z.sourceChannels}ch${z.padded ? " (0으로 채움)" : ""} | ${z.gain.toFixed(3)} | ${pitch} |`,
      );
    }
    rows.push(`| ${inst.id} 합계 | | | | | | ${instBytes} | | | | | | | | | |`);
    total += instBytes;
  }
  console.log(
    "\n| 악기 | 파일 | 원본 | center | lo–hi | 길이(s) | 바이트 | 피크 | RMS | DC | 첫 유효(ms) | 끝 10ms 평균 | 클리핑 | 원본 Hz/채널 | 게인 | 기본 주파수 |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const row of rows) console.log(row);
  console.log(`\n총 ${total}바이트 (${(total / 1024 / 1024).toFixed(3)}MiB)`);
  if (failures.length > 0) {
    throw new Error(`점검 실패:\n  ${failures.join("\n  ")}`);
  }
}

function checksums() {
  console.log("\nsha256 (WAV·manifest; LICENSES.md는 날짜 줄을 뺀 내용):");
  for (const inst of INSTRUMENTS) {
    for (const file of ["manifest.json", ...built.get(inst.id).map((z) => z.file)]) {
      const hash = createHash("sha256")
        .update(readFileSync(path.join(OUT_ROOT, inst.id, file)))
        .digest("hex");
      console.log(`${hash}  ${inst.id}/${file}`);
    }
  }
  const licenses = readFileSync(path.join(OUT_ROOT, "LICENSES.md"), "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("- 내려받은 날짜:"))
    .join("\n");
  console.log(`${createHash("sha256").update(licenses).digest("hex")}  LICENSES.md(날짜 줄 제외)`);
}

async function main() {
  const started = process.hrtime.bigint();
  console.log("라이선스 확인");
  await verifyLicenses();
  console.log("원본 받기·가공");
  for (const inst of INSTRUMENTS) {
    built.set(inst.id, inst.pitched ? await buildPitched(inst) : await buildDrums(inst));
  }
  encodeAll();
  check();
  writeOutputs();
  checksums();
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  console.log(
    `\n받은 파일 ${stats.downloadedFiles}개 ${(stats.downloadedBytes / 1e6).toFixed(1)}MB, 캐시 사용 ${stats.cachedFiles}개, ${seconds.toFixed(1)}s`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
