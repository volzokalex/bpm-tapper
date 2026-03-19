const bpmDisplay = document.getElementById('bpm');
const tapBtn = document.getElementById('tap-btn');
const resetBtn = document.getElementById('reset-btn');
const tapGlow = document.getElementById('tap-glow');

// Colors cycling between purple and red
const glowColors = ['#a78bfa', '#c084fc', '#e879f9', '#f472b6', '#fb7185', '#f87171'];
let glowIndex = 0;

let taps = [];
let resetTimer = null;

function tap() {
  const now = Date.now();
  taps.push(now);

  // Keep only last 8 taps — older taps slow down the response
  if (taps.length > 8) taps.shift();

  // Auto-reset if more than 3 seconds since last tap
  clearTimeout(resetTimer);
  resetTimer = setTimeout(reset, 3000);

  // Show BPM from 2nd tap onwards
  if (taps.length < 2) {
    bpmDisplay.textContent = '...';
    tapBtn.classList.add('active');
    setTimeout(() => tapBtn.classList.remove('active'), 100);
    return;
  }

  // Average of last intervals only
  const intervals = [];
  for (let i = 1; i < taps.length; i++) {
    intervals.push(taps[i] - taps[i - 1]);
  }
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const bpm = Math.round(60000 / avgInterval);

  bpmDisplay.textContent = bpm;

  // Pulse animation
  bpmDisplay.classList.remove('pulse');
  void bpmDisplay.offsetWidth;
  bpmDisplay.classList.add('pulse');
  setTimeout(() => bpmDisplay.classList.remove('pulse'), 100);

  // Button press animation
  tapBtn.classList.add('active');
  setTimeout(() => tapBtn.classList.remove('active'), 100);

  // Glow — new color each tap, fade duration tied to BPM
  const currentBpm = parseInt(bpmDisplay.textContent);
  const fadeMs = currentBpm > 0 && !isNaN(currentBpm)
    ? Math.round(60000 / currentBpm * 0.85)
    : 600;

  const color = glowColors[glowIndex % glowColors.length];
  glowIndex++;

  tapGlow.style.setProperty('--glow-duration', `${fadeMs}ms`);
  tapGlow.style.setProperty('--glow-color', color);
  tapGlow.classList.remove('active');
  void tapGlow.offsetWidth;
  tapGlow.classList.add('active');
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
const listenMicBtn = document.getElementById('listen-mic-btn');
const listenSystemBtn = document.getElementById('listen-system-btn');
const listenStatus = document.getElementById('listen-status');

// ── Oscilloscope ─────────────────────────────────────────────
const oscCanvas = document.getElementById('oscilloscope');
const oscCtx = oscCanvas.getContext('2d');
let oscAnalyser = null;
let oscAnimFrame = null;

function drawOscilloscope() {
  oscAnimFrame = requestAnimationFrame(drawOscilloscope);
  const W = oscCanvas.width;
  const H = oscCanvas.height;
  oscCtx.clearRect(0, 0, W, H);

  // Edge-fading gradient for stroke
  const fadeGrad = oscCtx.createLinearGradient(0, 0, W, 0);

  if (!oscAnalyser) {
    fadeGrad.addColorStop(0,    'transparent');
    fadeGrad.addColorStop(0.15, '#2a2a2a');
    fadeGrad.addColorStop(0.85, '#2a2a2a');
    fadeGrad.addColorStop(1,    'transparent');
    oscCtx.beginPath();
    oscCtx.moveTo(0, H / 2);
    oscCtx.lineTo(W, H / 2);
    oscCtx.strokeStyle = fadeGrad;
    oscCtx.lineWidth = 1.5;
    oscCtx.stroke();
    return;
  }

  const data = new Uint8Array(oscAnalyser.fftSize);
  oscAnalyser.getByteTimeDomainData(data);

  fadeGrad.addColorStop(0,    'transparent');
  fadeGrad.addColorStop(0.1,  '#a78bfa');
  fadeGrad.addColorStop(0.9,  '#a78bfa');
  fadeGrad.addColorStop(1,    'transparent');

  oscCtx.beginPath();
  const step = W / data.length;
  for (let i = 0; i < data.length; i++) {
    const y = (data[i] / 255) * H;
    i === 0 ? oscCtx.moveTo(0, y) : oscCtx.lineTo(i * step, y);
  }
  oscCtx.strokeStyle = fadeGrad;
  oscCtx.lineWidth = 1.5;
  oscCtx.shadowColor = '#a78bfa';
  oscCtx.shadowBlur = 6;
  oscCtx.stroke();
  oscCtx.shadowBlur = 0;
}

drawOscilloscope();

let audioContext = null;
let meydaAnalyzer = null;
let mediaStream = null;
let autoStopTimer = null;
let countdownInterval = null;
let isListening = false;
let activeBtn = null;

let energyBuffer = [];  // bass energy over time
let prevSpectrum = null;

const BUFFER_SIZE = 512;
const AUTO_STOP_AFTER_MS = 15000;
const EXTENSION_MS = 10000;
const MIN_READINGS_FOR_RESULT = 4;
const MIC_GAIN = 5;

// Smooth signal with moving average to remove noise
function smooth(data, window = 3) {
  return data.map((_, i) => {
    const from = Math.max(0, i - window);
    const slice = data.slice(from, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

// Find peaks in energy signal with minimum distance between them
function findPeaks(data, minDist) {
  const smoothed = smooth(data, 4);
  const avg = smoothed.reduce((a, b) => a + b, 0) / smoothed.length;
  const threshold = avg * 2.0;
  const peaks = [];
  for (let i = 1; i < smoothed.length - 1; i++) {
    if (smoothed[i] > smoothed[i - 1] && smoothed[i] > smoothed[i + 1] && smoothed[i] > threshold) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDist) {
        peaks.push(i);
      }
    }
  }
  return peaks;
}

// Compute BPM from peak positions, with half-tempo correction
function bpmFromPeaks(peaks, fps) {
  if (peaks.length < 3) return null;
  const intervals = [];
  for (let i = 1; i < peaks.length; i++) {
    intervals.push(peaks[i] - peaks[i - 1]);
  }
  const minInterval = fps * 60 / 180; // cap at 180 BPM max
  const maxInterval = fps * 60 / 40;
  const valid = intervals.filter(d => d >= minInterval && d <= maxInterval);
  if (valid.length < 2) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  let bpm = Math.round(60 * fps / med);

  // Half-tempo correction: if BPM > 150, check if half is more musical
  if (bpm > 150 && bpm / 2 >= 40) bpm = Math.round(bpm / 2);

  return bpm;
}

function setListenState(state, countdown) {
  if (!activeBtn) return;
  activeBtn.className = '';
  switch (state) {
    case 'idle':
      listenMicBtn.textContent = '🎙 Microphone';
      listenSystemBtn.textContent = '💻 System Audio';
      listenStatus.textContent = 'Choose how to detect BPM';
      break;
    case 'waiting':
      activeBtn.textContent = `🎧 Listening... ${countdown}s`;
      activeBtn.classList.add('listening');
      listenStatus.textContent = activeBtn === listenMicBtn
        ? 'Hold mic near the speaker'
        : 'Playing music will be captured automatically';
      break;
    case 'analyzing':
      activeBtn.textContent = `🔍 Analyzing... ${countdown}s`;
      activeBtn.classList.add('listening');
      listenStatus.textContent = 'Locking in the tempo';
      break;
    case 'ready':
      activeBtn.textContent = '✅ BPM Ready — Try Again';
      activeBtn.classList.add('ready');
      listenStatus.textContent = 'Done! Click to analyze again';
      break;
    case 'error':
      listenStatus.textContent = '⚠️ Access denied — allow it in your browser';
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
  oscAnalyser = null;
  energyBuffer = [];
  prevSpectrum = null;
  isListening = false;
  setListenState(autoStopped ? 'ready' : 'idle', 0);
  if (!autoStopped) activeBtn = null;
}

async function startListening(useSystemAudio) {
  try {
    if (useSystemAudio) {
      const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg|OPR/.test(navigator.userAgent);
      if (!isChrome) {
        listenStatus.textContent = '⚠️ System Audio works only in Chrome. Open this page in Chrome and try again.';
        setListenState('idle', 0);
        activeBtn = null;
        return;
      }
      // Chrome requires video:true to show the dialog, we just ignore the video track
      mediaStream = await navigator.mediaDevices.getDisplayMedia({
        audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 44100 },
        video: true
      });
      // Stop video track — we only need audio
      mediaStream.getVideoTracks().forEach(t => t.stop());
    } else {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
    }
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(mediaStream);

    // Boost mic signal with a gain node
    const gainNode = audioContext.createGain();
    gainNode.gain.value = useSystemAudio ? 1 : MIC_GAIN;
    source.connect(gainNode);

    // Hook oscilloscope analyser
    oscAnalyser = audioContext.createAnalyser();
    oscAnalyser.fftSize = 1024;
    gainNode.connect(oscAnalyser);

    const fps = audioContext.sampleRate / BUFFER_SIZE; // ~86 frames/sec
    const minPeakDist = Math.floor(fps * 60 / 220);   // min frames between peaks (220 BPM)
    const maxEnergy = Math.floor(fps * 10);            // keep 10 sec of data
    let bpmReadings = [];
    let frameCounter = 0;
    const analyzeEvery = Math.floor(fps * 1.5);        // analyze every 1.5 sec
    energyBuffer = [];
    prevSpectrum = null;

    isListening = true;
    let secondsLeft = AUTO_STOP_AFTER_MS / 1000;
    setListenState('waiting', secondsLeft);

    countdownInterval = setInterval(() => {
      secondsLeft--;
      const state = bpmReadings.length >= MIN_READINGS_FOR_RESULT ? 'analyzing' : 'waiting';
      setListenState(state, secondsLeft);
    }, 1000);

    autoStopTimer = setTimeout(() => {
      if (bpmReadings.length < MIN_READINGS_FOR_RESULT) {
        secondsLeft = EXTENSION_MS / 1000;
        listenStatus.textContent = `Нужно больше времени — продолжай играть! +${secondsLeft}s`;
        autoStopTimer = setTimeout(() => stopListening(true), EXTENSION_MS);
      } else {
        stopListening(true);
      }
    }, AUTO_STOP_AFTER_MS);

    meydaAnalyzer = Meyda.createMeydaAnalyzer({
      audioContext,
      source: gainNode,
      bufferSize: BUFFER_SIZE,
      featureExtractors: ['amplitudeSpectrum'],
      callback(features) {
        if (!features || !features.amplitudeSpectrum) return;

        // Bass flux: positive changes in low-frequency bins (kick drum range ~60-200Hz)
        const spectrum = features.amplitudeSpectrum;
        const bassEnd = Math.min(4, spectrum.length); // bins 0-3 ≈ 0-344Hz
        let bassFlux = 0;
        if (prevSpectrum) {
          for (let i = 0; i < bassEnd; i++) {
            const diff = spectrum[i] - prevSpectrum[i];
            if (diff > 0) bassFlux += diff;
          }
        }
        prevSpectrum = Array.from(spectrum);

        energyBuffer.push(bassFlux);
        frameCounter++;
        if (energyBuffer.length > maxEnergy) energyBuffer.shift();

        // Flash button on strong bass hit
        const avg = energyBuffer.reduce((a, b) => a + b, 0) / energyBuffer.length;
        if (bassFlux > avg * 2.5 && bassFlux > 0.5) {
          tapBtn.classList.add('beat-flash');
          setTimeout(() => tapBtn.classList.remove('beat-flash'), 100);
        }

        // Analyze every 1.5 seconds once we have 4+ seconds of data
        if (energyBuffer.length >= Math.floor(fps * 4) && frameCounter % analyzeEvery === 0) {
          const peaks = findPeaks(energyBuffer, minPeakDist);
          const bpm = bpmFromPeaks(peaks, fps);
          if (bpm) {
            bpmReadings.push(bpm);
            if (bpmReadings.length > 6) bpmReadings.shift();

            // Use median of recent readings — stable and responsive
            const sorted = [...bpmReadings].sort((a, b) => a - b);
            const result = sorted[Math.floor(sorted.length / 2)];

            bpmDisplay.textContent = result;
            bpmDisplay.classList.remove('pulse');
            void bpmDisplay.offsetWidth;
            bpmDisplay.classList.add('pulse');
            setTimeout(() => bpmDisplay.classList.remove('pulse'), 100);
          }
        }
      }
    });

    meydaAnalyzer.start();

  } catch (err) {
    setListenState('error', 0);
  }
}

function handleListenClick(btn, useSystemAudio) {
  if (isListening && activeBtn === btn) {
    stopListening(false);
  } else if (!isListening) {
    activeBtn = btn;
    reset();
    startListening(useSystemAudio);
  }
}

listenMicBtn.addEventListener('click', () => handleListenClick(listenMicBtn, false));
listenSystemBtn.addEventListener('click', () => handleListenClick(listenSystemBtn, true));

setListenState('idle', 0);
