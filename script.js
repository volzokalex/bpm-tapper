const bpmDisplay = document.getElementById('bpm');
const tapBtn = document.getElementById('tap-btn');
const resetBtn = document.getElementById('reset-btn');

let taps = [];
let resetTimer = null;

function tap() {
  const now = Date.now();
  taps.push(now);

  // Auto-reset if more than 3 seconds since last tap
  clearTimeout(resetTimer);
  resetTimer = setTimeout(reset, 3000);

  // Need at least 2 taps to calculate BPM
  if (taps.length < 2) {
    bpmDisplay.textContent = '...';
    return;
  }

  // Calculate average interval between taps
  const intervals = [];
  for (let i = 1; i < taps.length; i++) {
    intervals.push(taps[i] - taps[i - 1]);
  }
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const bpm = Math.round(60000 / avgInterval);

  bpmDisplay.textContent = bpm;

  // Pulse animation
  bpmDisplay.classList.remove('pulse');
  void bpmDisplay.offsetWidth; // reflow to restart animation
  bpmDisplay.classList.add('pulse');
  setTimeout(() => bpmDisplay.classList.remove('pulse'), 100);

  // Button press animation
  tapBtn.classList.add('active');
  setTimeout(() => tapBtn.classList.remove('active'), 100);
}

function reset() {
  taps = [];
  clearTimeout(resetTimer);
  bpmDisplay.textContent = '--';
  bpmDisplay.classList.remove('pulse');
}

// Button click
tapBtn.addEventListener('click', tap);

// Reset button
resetBtn.addEventListener('click', reset);

// Keyboard: Space, Enter = tap | R = reset
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    tap();
  }
  if (e.code === 'KeyR') {
    reset();
  }
});

// ── Listen Mode ──────────────────────────────────────────────
const listenBtn = document.getElementById('listen-btn');
const listenStatus = document.getElementById('listen-status');

let audioContext = null;
let meydaAnalyzer = null;
let mediaStream = null;
let autoStopTimer = null;
let countdownInterval = null;
let isListening = false;

let beatTimes = [];
let lastBeatTime = 0;
let bpmReadings = [];
let prevFlux = null;
let fluxHistory = [];

const BEAT_HOLD_MS = 300;
const AUTO_STOP_AFTER_MS = 15000;

function setListenState(state, countdown) {
  listenBtn.className = '';
  switch (state) {
    case 'idle':
      listenBtn.textContent = '🎵 Detect BPM';
      listenStatus.textContent = "Play your song — we'll find the BPM";
      break;
    case 'waiting':
      listenBtn.textContent = `🎧 Listening... ${countdown}s`;
      listenBtn.classList.add('listening');
      listenStatus.textContent = 'Hold mic near the speaker';
      break;
    case 'analyzing':
      listenBtn.textContent = `🔍 Analyzing... ${countdown}s`;
      listenBtn.classList.add('listening');
      listenStatus.textContent = 'Locking in the tempo';
      break;
    case 'ready':
      listenBtn.textContent = '✅ BPM Ready — Try Again';
      listenBtn.classList.add('ready');
      listenStatus.textContent = 'Done! Click to analyze a new song';
      break;
    case 'error':
      listenBtn.textContent = '🎵 Detect BPM';
      listenStatus.textContent = '⚠️ Mic access denied — allow it in your browser';
      break;
  }
}

function stopListening(autoStopped = false) {
  if (meydaAnalyzer) { meydaAnalyzer.stop(); meydaAnalyzer = null; }
  if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
  if (audioContext) audioContext.close();
  clearTimeout(autoStopTimer);
  clearInterval(countdownInterval);
  audioContext = null;
  mediaStream = null;
  beatTimes = [];
  bpmReadings = [];
  lastBeatTime = 0;
  prevFlux = null;
  fluxHistory = [];
  isListening = false;
  setListenState(autoStopped ? 'ready' : 'idle', 0);
}

async function startListening() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(mediaStream);

    isListening = true;
    let secondsLeft = AUTO_STOP_AFTER_MS / 1000;
    setListenState('waiting', secondsLeft);

    countdownInterval = setInterval(() => {
      secondsLeft--;
      const state = bpmReadings.length >= 4 ? 'analyzing' : 'waiting';
      setListenState(state, secondsLeft);
    }, 1000);

    autoStopTimer = setTimeout(() => stopListening(true), AUTO_STOP_AFTER_MS);

    meydaAnalyzer = Meyda.createMeydaAnalyzer({
      audioContext,
      source,
      bufferSize: 512,
      featureExtractors: ['amplitudeSpectrum', 'rms'],
      callback(features) {
        if (!features || !features.amplitudeSpectrum) return;

        // Spectral flux: sum of positive differences in amplitude spectrum
        const spectrum = features.amplitudeSpectrum;
        let flux = 0;
        if (prevFlux !== null) {
          for (let i = 0; i < spectrum.length; i++) {
            const diff = spectrum[i] - prevFlux[i];
            if (diff > 0) flux += diff;
          }
        }
        prevFlux = Array.from(spectrum);

        // Keep flux history to compute dynamic threshold
        fluxHistory.push(flux);
        if (fluxHistory.length > 43) fluxHistory.shift(); // ~1 sec at 512/23ms

        const avgFlux = fluxHistory.reduce((a, b) => a + b, 0) / fluxHistory.length;
        const threshold = avgFlux * 1.5;
        const now = Date.now();

        // Beat detected when flux exceeds threshold
        if (flux > threshold && flux > 0.5 && now - lastBeatTime > BEAT_HOLD_MS) {
          lastBeatTime = now;
          beatTimes.push(now);
          if (beatTimes.length > 32) beatTimes.shift();

          if (beatTimes.length >= 4) {
            const intervals = [];
            for (let i = 1; i < beatTimes.length; i++) {
              intervals.push(beatTimes[i] - beatTimes[i - 1]);
            }
            const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            const detectedBpm = Math.round(60000 / avgInterval);

            if (detectedBpm >= 40 && detectedBpm <= 220) {
              bpmDisplay.textContent = detectedBpm;
              bpmDisplay.classList.remove('pulse');
              void bpmDisplay.offsetWidth;
              bpmDisplay.classList.add('pulse');
              setTimeout(() => bpmDisplay.classList.remove('pulse'), 100);

              bpmReadings.push(detectedBpm);
              if (bpmReadings.length > 20) bpmReadings.shift();
            }
          }
        }
      }
    });

    meydaAnalyzer.start();

  } catch (err) {
    setListenState('error', 0);
  }
}

listenBtn.addEventListener('click', () => {
  if (isListening) {
    stopListening(false);
  } else {
    reset();
    startListening();
  }
});

setListenState('idle', 0);
