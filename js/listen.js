import { detectPeaks, tempoFromIOI } from './audio.js';
import { setAnalyser } from './oscilloscope.js';

// ── DOM ───────────────────────────────────────────────────────────────────────
const bpmDisplay     = document.getElementById('bpm');
const tapBtn         = document.getElementById('tap-btn');
const listenMicBtn   = document.getElementById('listen-mic-btn');
const listenSysBtn   = document.getElementById('listen-system-btn');
const listenStatus   = document.getElementById('listen-status');

// ── Config ────────────────────────────────────────────────────────────────────
const BUFFER_SIZE              = 512;
const AUTO_STOP_MS             = 15000;
const EXTENSION_MS             = 10000;
const MIN_READINGS_FOR_RESULT  = 4;
const MIC_GAIN                 = 5;

// ── State ─────────────────────────────────────────────────────────────────────
let audioContext    = null;
let meydaAnalyzer   = null;
let mediaStream     = null;
let autoStopTimer   = null;
let countdownTimer  = null;
let isListening     = false;
let activeBtn       = null;

// ── UI state machine ──────────────────────────────────────────────────────────
function setListenState(state, countdown) {
  if (!activeBtn) return;
  activeBtn.className = '';

  switch (state) {
    case 'idle':
      listenMicBtn.textContent = '🎙 Microphone';
      listenSysBtn.textContent = '💻 System Audio';
      listenStatus.textContent = 'Choose how to detect BPM';
      break;
    case 'waiting':
      activeBtn.textContent    = `🎧 Listening... ${countdown}s`;
      activeBtn.classList.add('listening');
      listenStatus.textContent = activeBtn === listenMicBtn
        ? 'Hold mic near the speaker'
        : 'Playing music will be captured automatically';
      break;
    case 'analyzing':
      activeBtn.textContent    = `🔍 Analyzing... ${countdown}s`;
      activeBtn.classList.add('listening');
      listenStatus.textContent = 'Locking in the tempo';
      break;
    case 'ready':
      activeBtn.textContent    = '✅ BPM Ready — Try Again';
      activeBtn.classList.add('ready');
      listenStatus.textContent = 'Done! Click to analyze again';
      break;
    case 'error':
      listenStatus.textContent = '⚠️ Access denied — allow it in your browser';
      break;
  }
}

// ── Stop ──────────────────────────────────────────────────────────────────────
export function stopListening(autoStopped = false) {
  if (meydaAnalyzer) { meydaAnalyzer.stop(); meydaAnalyzer = null; }
  if (mediaStream)   mediaStream.getTracks().forEach(t => t.stop());
  if (audioContext)  audioContext.close();

  clearTimeout(autoStopTimer);
  clearInterval(countdownTimer);

  audioContext = null;
  mediaStream  = null;
  isListening  = false;

  setAnalyser(null);
  setListenState(autoStopped ? 'ready' : 'idle', 0);
  if (!autoStopped) activeBtn = null;
}

// ── Start ─────────────────────────────────────────────────────────────────────
async function startListening(useSystemAudio) {
  try {
    mediaStream = await getMediaStream(useSystemAudio);
    if (!mediaStream) return;

    audioContext = new AudioContext();
    const source   = audioContext.createMediaStreamSource(mediaStream);
    const gainNode = audioContext.createGain();
    gainNode.gain.value = useSystemAudio ? 1 : MIC_GAIN;
    source.connect(gainNode);

    const analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 1024;
    gainNode.connect(analyserNode);
    setAnalyser(analyserNode);

    isListening = true;
    runAnalysis(gainNode, useSystemAudio);

  } catch {
    setListenState('error', 0);
  }
}

async function getMediaStream(useSystemAudio) {
  if (!useSystemAudio) {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
  }

  const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg|OPR/.test(navigator.userAgent);
  if (!isChrome) {
    listenStatus.textContent = '⚠️ System Audio works only in Chrome.';
    setListenState('idle', 0);
    activeBtn = null;
    return null;
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 44100 },
    video: true
  });
  stream.getVideoTracks().forEach(t => t.stop());
  return stream;
}

function runAnalysis(source, useSystemAudio) {
  const fps          = audioContext.sampleRate / BUFFER_SIZE;
  const maxFrames    = Math.floor(fps * 8);
  const analyzeEvery = Math.floor(fps * 1.5);
  let   bpmReadings  = [];
  let   frameCounter = 0;
  let   onsetBuffer  = [];
  let   prevSpectrum = null;
  let   secondsLeft  = AUTO_STOP_MS / 1000;

  setListenState('waiting', secondsLeft);

  countdownTimer = setInterval(() => {
    secondsLeft--;
    const state = bpmReadings.length >= MIN_READINGS_FOR_RESULT ? 'analyzing' : 'waiting';
    setListenState(state, secondsLeft);
  }, 1000);

  autoStopTimer = setTimeout(() => {
    if (bpmReadings.length < MIN_READINGS_FOR_RESULT) {
      secondsLeft = EXTENSION_MS / 1000;
      listenStatus.textContent = `Need more time — keep playing! +${secondsLeft}s`;
      autoStopTimer = setTimeout(() => stopListening(true), EXTENSION_MS);
    } else {
      stopListening(true);
    }
  }, AUTO_STOP_MS);

  meydaAnalyzer = Meyda.createMeydaAnalyzer({
    audioContext,
    source,
    bufferSize: BUFFER_SIZE,
    featureExtractors: ['amplitudeSpectrum'],
    callback(features) {
      if (!features?.amplitudeSpectrum) return;

      // Spectral flux: sum of positive differences across full spectrum
      const spectrum = features.amplitudeSpectrum;
      let flux = 0;
      if (prevSpectrum) {
        for (let i = 1; i < spectrum.length; i++) {
          const diff = spectrum[i] - prevSpectrum[i];
          if (diff > 0) flux += diff;
        }
      }
      prevSpectrum = Array.from(spectrum);

      onsetBuffer.push(flux);
      frameCounter++;
      if (onsetBuffer.length > maxFrames) onsetBuffer.shift();

      // Flash tap button on strong onset
      const avg = onsetBuffer.reduce((a, b) => a + b, 0) / onsetBuffer.length;
      if (flux > avg * 2.5 && flux > 0.1) {
        tapBtn.classList.add('beat-flash');
        setTimeout(() => tapBtn.classList.remove('beat-flash'), 100);
      }

      // Re-analyze every 1.5s once we have 5s of data
      if (onsetBuffer.length >= Math.floor(fps * 5) && frameCounter % analyzeEvery === 0) {
        const peaks = detectPeaks(onsetBuffer, fps);
        const bpm   = tempoFromIOI(peaks, fps);
        if (!bpm) return;

        bpmReadings.push(bpm);
        if (bpmReadings.length > 5) bpmReadings.shift();

        const sorted = [...bpmReadings].sort((a, b) => a - b);
        const result = sorted[Math.floor(sorted.length / 2)];

        bpmDisplay.textContent = result;
        bpmDisplay.classList.remove('pulse');
        void bpmDisplay.offsetWidth;
        bpmDisplay.classList.add('pulse');
        setTimeout(() => bpmDisplay.classList.remove('pulse'), 100);
      }
    }
  });

  meydaAnalyzer.start();
}

// ── Click handler ─────────────────────────────────────────────────────────────
function handleClick(btn, useSystemAudio) {
  if (isListening && activeBtn === btn) {
    stopListening(false);
  } else if (!isListening) {
    activeBtn = btn;
    startListening(useSystemAudio);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
export function initListenButtons() {
  listenMicBtn.addEventListener('click', () => handleClick(listenMicBtn, false));
  listenSysBtn.addEventListener('click', () => handleClick(listenSysBtn, true));
}
