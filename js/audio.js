const MAX_BPM = 180;
const MIN_BPM = 60;

// Half-wave rectified spectral flux (onset strength)
export function computeFlux(spectrum, prevSpectrum) {
  if (!prevSpectrum) return 0;
  let flux = 0;
  for (let i = 0; i < spectrum.length; i++) {
    const diff = spectrum[i] - prevSpectrum[i];
    if (diff > 0) flux += diff;
  }
  return flux;
}

// ACF tempogram → dominant BPM + confidence
export function acfTempogram(envelope, fps) {
  const minLag = Math.round(fps * 60 / MAX_BPM);
  const maxLag = Math.round(fps * 60 / MIN_BPM);
  const n = envelope.length;

  if (n < maxLag * 2) return null;

  // Mean-normalize
  const mean = envelope.reduce((a, b) => a + b, 0) / n;
  const norm = envelope.map(x => x - mean);

  // Autocorrelation
  const acf = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += norm[i] * norm[i + lag];
    acf[lag] = sum / (n - lag);
  }

  // Peak
  let bestLag = minLag, bestVal = acf[minLag];
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (acf[lag] > bestVal) { bestVal = acf[lag]; bestLag = lag; }
  }

  if (bestVal <= 0) return null;

  // Confidence = peak / mean of positive ACF values
  let pos = 0, posCount = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (acf[lag] > 0) { pos += acf[lag]; posCount++; }
  }
  const avgPos = posCount > 0 ? pos / posCount : 1;
  const confidence = Math.min(1, bestVal / avgPos / 3);

  return { bpm: Math.round(fps * 60 / bestLag), confidence };
}
