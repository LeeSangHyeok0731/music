// 샘플 팩 가공과 점검에 쓰는 순수 함수들. 난수·시간에 의존하지 않는다 —
// 같은 입력이면 같은 출력이 나온다.

/**
 * 채널들을 평균해 모노로 만든다.
 *
 * @param {Float32Array[]} channels
 * @returns {Float64Array}
 */
export function toMono(channels) {
  const n = channels[0].length;
  const out = new Float64Array(n);
  for (const ch of channels) {
    for (let i = 0; i < n; i++) out[i] += ch[i];
  }
  for (let i = 0; i < n; i++) out[i] /= channels.length;
  return out;
}

/** @param {ArrayLike<number>} x */
export function peakOf(x) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    if (v > peak) peak = v;
  }
  return peak;
}

/**
 * 절대값이 전체 피크의 `ratio`를 처음 넘는 샘플 위치. 없으면 -1.
 *
 * @param {ArrayLike<number>} x
 * @param {number} [ratio]
 */
export function firstAbove(x, ratio = 0.01) {
  const threshold = peakOf(x) * ratio;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]) > threshold) return i;
  }
  return -1;
}

/**
 * 온셋(피크의 1%를 처음 넘는 곳) `preMs` 앞에서 시작해 `seconds`만큼 자른다.
 * 원본이 모자라면 0으로 채운다(그 사실은 `padded`로 알려 준다).
 *
 * @param {Float64Array} x
 * @param {number} rate
 * @param {number} seconds
 * @param {number} [preMs]
 */
export function cropFromOnset(x, rate, seconds, preMs = 5) {
  const onset = firstAbove(x, 0.01);
  if (onset < 0) throw new Error("무음 파일입니다");
  const start = Math.max(0, onset - Math.round((preMs / 1000) * rate));
  const n = Math.round(seconds * rate);
  const out = new Float64Array(n);
  const available = Math.min(n, x.length - start);
  for (let i = 0; i < available; i++) out[i] = x[start + i];
  return { samples: out, start, onset, padded: available < n };
}

/**
 * 마지막 `ms` 동안 코사인 곡선으로 줄여 마지막 샘플이 정확히 0이 되게 한다.
 *
 * @param {Float64Array} x 제자리에서 바꾼다
 * @param {number} rate
 * @param {number} ms
 */
export function fadeOut(x, rate, ms) {
  const n = Math.min(x.length, Math.round((ms / 1000) * rate));
  if (n < 2) return x;
  const begin = x.length - n;
  for (let i = 0; i < n; i++) {
    // i = 0에서 1, i = n - 1에서 0
    const t = i / (n - 1);
    x[begin + i] *= 0.5 * (1 + Math.cos(Math.PI * t));
  }
  return x;
}

/** 0차 제1종 변형 베셀 함수(카이저 창용). */
function besselI0(x) {
  let sum = 1;
  let term = 1;
  const half = x / 2;
  for (let k = 1; k < 64; k++) {
    term *= (half / k) * (half / k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * 카이저 창 sinc 저역통과로 임의 비율을 재샘플링한다(단순 선형보간이 아니다 —
 * 에일리어싱을 막는다).
 *
 * - 컷오프: 출력 샘플레이트의 `cutoff` 배(기본 0.45 → 22050Hz 출력이면 ≈9.9kHz).
 * - 커널 반폭: 출력 샘플 `halfWidth`개 분량(기본 48 → 44.1kHz 입력에서 양쪽 96탭).
 *   전이대역은 대략 ±0.6kHz라 출력 나이퀴스트(11.025kHz) 위의 성분은 충분히 줄어든다.
 * - 카이저 β = 8(저지대역 약 -80dB).
 *
 * 입출력 비율이 정수비라 원본 위치의 소수부는 유한 개뿐이다. 소수부마다
 * 커널을 한 번만 계산해 둔다(정확하고 결정적이다).
 *
 * @param {Float64Array} x
 * @param {number} inRate 정수 Hz
 * @param {number} outRate 정수 Hz
 * @param {{ outLength?: number, cutoff?: number, halfWidth?: number, beta?: number }} [opts]
 * @returns {Float64Array}
 */
export function resample(x, inRate, outRate, opts = {}) {
  const { cutoff = 0.45, halfWidth = 48, beta = 8 } = opts;
  const outLength = opts.outLength ?? Math.floor((x.length * outRate) / inRate);
  // 원본 샘플 단위의 정규화 컷오프(주기/샘플)와 커널 반폭
  const fc = (cutoff * outRate) / inRate;
  const half = Math.ceil((halfWidth * inRate) / outRate);
  const i0Beta = besselI0(beta);
  const g = gcd(inRate, outRate);
  const den = outRate / g;
  const num = inRate / g;

  /** @type {Map<number, Float64Array>} */
  const kernels = new Map();
  const kernelFor = (r) => {
    let k = kernels.get(r);
    if (k) return k;
    const frac = r / den;
    k = new Float64Array(2 * half);
    // 탭 j는 원본 샘플 base - half + 1 + j, 거리 u = (base + frac) - 그 샘플
    for (let j = 0; j < 2 * half; j++) {
      const u = frac + half - 1 - j;
      const a = u / half;
      if (Math.abs(a) >= 1) {
        k[j] = 0;
        continue;
      }
      const window = besselI0(beta * Math.sqrt(1 - a * a)) / i0Beta;
      const arg = 2 * fc * u;
      const sinc = arg === 0 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg);
      k[j] = 2 * fc * sinc * window;
    }
    kernels.set(r, k);
    return k;
  };

  const out = new Float64Array(outLength);
  for (let i = 0; i < outLength; i++) {
    // 원본 위치 = i * inRate / outRate = base + r / den (정수 연산)
    const scaled = i * num;
    const base = Math.floor(scaled / den);
    const r = scaled - base * den;
    const k = kernelFor(r);
    const first = base - half + 1;
    let acc = 0;
    for (let j = 0; j < k.length; j++) {
      const idx = first + j;
      if (idx >= 0 && idx < x.length) acc += x[idx] * k[j];
    }
    out[i] = acc;
  }
  return out;
}

/**
 * [-1, 1] 실수를 16비트 PCM 모노 WAV로 만든다(반올림, 디더 없음 — 결정적).
 *
 * @param {ArrayLike<number>} samples
 * @param {number} rate
 * @returns {Buffer}
 */
export function encodeWav16(samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.round(samples[i] * 32767);
    data.writeInt16LE(Math.max(-32768, Math.min(32767, v)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * `encodeWav16`이 만든 44바이트 헤더 WAV를 읽는다. 형식이 다르면 던진다.
 *
 * @param {Uint8Array} bytes
 */
export function decodeWav16(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => buf.toString("ascii", o, o + 4);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt " || tag(36) !== "data") {
    throw new Error("RIFF/WAVE/fmt/data 헤더가 아닙니다");
  }
  const format = buf.readUInt16LE(20);
  const channels = buf.readUInt16LE(22);
  const rate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  const dataBytes = buf.readUInt32LE(40);
  if (44 + dataBytes !== buf.length) throw new Error("data 길이가 파일 길이와 다릅니다");
  const ints = new Int16Array(dataBytes / 2);
  for (let i = 0; i < ints.length; i++) ints[i] = buf.readInt16LE(44 + i * 2);
  const samples = new Float64Array(ints.length);
  for (let i = 0; i < ints.length; i++) samples[i] = ints[i] / 32768;
  return { format, channels, rate, bits, ints, samples };
}

/**
 * YIN 방식 기본 주파수 추정(누적 평균 정규화 차분 함수 + 포물선 보간).
 * 탐색 범위는 [fmin, fmax]. 반환: 주파수(Hz)와 그 지연의 정규화 차분값(작을수록 확실).
 *
 * @param {ArrayLike<number>} x
 * @param {number} rate
 * @param {number} start 분석 시작 샘플
 * @param {number} win 창 길이(샘플)
 * @param {number} fmin
 * @param {number} fmax
 * @param {number} [threshold]
 */
export function yin(x, rate, start, win, fmin, fmax, threshold = 0.15) {
  const tauMin = Math.max(2, Math.floor(rate / fmax));
  const tauMax = Math.ceil(rate / fmin);
  if (start + win + tauMax + 1 > x.length) {
    throw new Error("YIN 분석 구간이 신호보다 깁니다");
  }
  const d = new Float64Array(tauMax + 2);
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let sum = 0;
    for (let i = 0; i < win; i++) {
      const v = x[start + i] - x[start + i + tau];
      sum += v * v;
    }
    d[tau] = sum;
  }
  const cmnd = new Float64Array(tauMax + 2);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    running += d[tau];
    cmnd[tau] = running === 0 ? 1 : (d[tau] * tau) / running;
  }
  let best = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) {
    best = tauMin;
    for (let tau = tauMin; tau <= tauMax; tau++) if (cmnd[tau] < cmnd[best]) best = tau;
  }
  const a = cmnd[best - 1];
  const b = cmnd[best];
  const c = cmnd[best + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (a - c) / (2 * denom) : 0;
  return { freq: rate / (best + shift), aperiodicity: b };
}

export const midiToFreq = (midi) => 440 * 2 ** ((midi - 69) / 12);
export const centsBetween = (freq, ref) => 1200 * Math.log2(freq / ref);

/**
 * 존 하나의 기본 주파수를 여러 창에서 추정해 중앙값을 낸다. 탐색 범위는 기대 음의
 * 한 옥타브 아래~위(조금 넉넉히)라 옥타브 오매핑이면 ±1200센트 근처로 드러난다.
 *
 * @param {ArrayLike<number>} x
 * @param {number} rate
 * @param {number} expectedMidi
 * @param {number[]} [offsets] 첫 유효 샘플부터의 창 시작(초)
 */
export function estimatePitch(x, rate, expectedMidi, offsets = [0.15, 0.3, 0.5]) {
  const expected = midiToFreq(expectedMidi);
  const fmin = expected / 2.3;
  const fmax = expected * 2.3;
  // 가장 낮은 탐색 주파수의 3주기 이상, 최소 40ms
  const win = Math.max(Math.round(0.04 * rate), Math.ceil((3 * rate) / fmin));
  const onset = Math.max(0, firstAbove(x, 0.01));
  const estimates = offsets.map((offset) => {
    const r = yin(x, rate, onset + Math.round(offset * rate), win, fmin, fmax);
    return { ...r, cents: centsBetween(r.freq, expected) };
  });
  const sorted = [...estimates].sort((p, q) => p.cents - q.cents);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { expected, median, estimates };
}

/**
 * 출력 존의 객관 지표(귀 대신).
 *
 * @param {ArrayLike<number>} samples [-1, 1)
 * @param {Int16Array} ints 같은 샘플의 정수 값(클리핑 판정용)
 * @param {number} rate
 */
export function measure(samples, ints, rate) {
  let sum = 0;
  let sq = 0;
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i];
    sq += samples[i] * samples[i];
    if (ints[i] >= 32767 || ints[i] <= -32768) clipped++;
  }
  const tailN = Math.round(0.01 * rate);
  let tail = 0;
  for (let i = samples.length - tailN; i < samples.length; i++) tail += Math.abs(samples[i]);
  return {
    seconds: samples.length / rate,
    peak: peakOf(samples),
    rms: Math.sqrt(sq / samples.length),
    dc: sum / samples.length,
    firstMs: (firstAbove(samples, 0.01) / rate) * 1000,
    tailMean: tail / tailN,
    clipped,
  };
}
