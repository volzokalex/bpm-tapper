const MAX_BPM = 175;
const MIN_BPM = 40;

export function detectPeaks(signal, fps) {
  const minDist = Math.floor(fps * 60 / MAX_BPM);

  // Smooth with a window of ±3 frames
  const smoothed = signal.map((_, i) => {
    const lo = Math.max(0, i - 3);
    const hi = Math.min(signal.length - 1, i + 3);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += signal[j];
    return sum / (hi - lo + 1);
  });

  const avg    = smoothed.reduce((a, b) => a + b, 0) / smoothed.length;
  const thresh = avg * 1.4;
  const peaks  = [];

  for (let i = 1; i < smoothed.length - 1; i++) {
    const isPeak = smoothed[i] > smoothed[i - 1]
                && smoothed[i] > smoothed[i + 1]
                && smoothed[i] > thresh;
    const isFarEnough = peaks.length === 0 || i - peaks[peaks.length - 1] >= minDist;
    if (isPeak && isFarEnough) peaks.push(i);
  }

  return peaks;
}

export function tempoFromIOI(peaks, fps) {
  if (peaks.length < 4) return null;

  const minLag = Math.floor(fps * 60 / MAX_BPM);
  const maxLag = Math.ceil(fps * 60 / MIN_BPM);
  const hist   = new Float32Array(maxLag + 1);

  // Build inter-onset interval histogram
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < peaks.length; j++) {
      const interval = peaks[j] - peaks[i];
      if (interval > maxLag) break;
      if (interval >= minLag) hist[interval] += 1;
    }
  }

  // Score each lag with partial credit for its harmonics
  let bestLag = -1, bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = hist[lag];
    for (let h = 2; h <= 4; h++) {
      const hLag = Math.round(lag * h);
      if (hLag <= maxLag) score += hist[hLag] / h;
    }
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }

  if (bestLag < 0 || bestScore < 2) return null;
  return Math.round(60 * fps / bestLag);
}
