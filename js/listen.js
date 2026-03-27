import { computeFlux, acfTempogram } from './audio.js';
import { setAnalyser } from './oscilloscope.js';

// ── DOM ───────────────────────────────────────────────────────────────────────
const bpmDisplay   = document.getElementById('bpm');
const listenMicBtn = document.getElementById('listen-mic-btn');
const listenSysBtn = document.getElementById('listen-system-btn');
const listenStatus = document.getElementById('listen-status');

// ── Config ────────────────────────────────────────────────────────────────────
const BUFFER_SIZE   = 1024;
const RING_SECS     = 8;
const UPDATE_EVERY  = 2;   // seconds between BPM recalculations
const EMA_ALPHA     = 0.15;
const MIC_GAIN      = 5;

// ── State ─────────────────────────────────────────────────────────────────────
let audioCtx       = null;
let meydaAnalyzer  = null;
let mediaStream    = null;
let stopTimer      = null;
let countdownTimer = null;
let isListening    = false;
let activeBtn      = null;

// ── UI ────────────────────────────────────────────────────────────────────────
function setState(state, countdown = 0) {
  if (!activeBtn) return;
  activeBtn.className = '';

  switch (state) {
    case 'idle':
      listenMicBtn.textContent = '🎙 Microphone';
      listenSysBtn.textContent = '💻 System Audio';
      listenStatus.textContent = 'Choose how to detect BPM';
      activeBtn = null;
      break;
    case 'listening':
      activeBtn.textContent    = `🎧 Listening… ${countdown}s`;
      activeBtn.classList.add('listening');
      listenStatus.textContent = activeBtn === listenMicBtn
        ? 'Hold mic near the speaker' : 'Playing music will be captured';
      break;
    case 'ready':
      activeBtn.textContent    = '✅ Done — Try Again';
      activeBtn.classList.add('ready');
      listenStatus.textContent = 'Click to analyze again';
      break;
    case 'error':
      listenStatus.textContent = '⚠️ Access denied — allow it in your browser';
      break;
  }
}

// ── Stop ──────────────────────────────────────────────────────────────────────
export function stopListening(done = false) {
  meydaAnalyzer?.stop();
  mediaStream?.getTracks().forEach(t => t.stop());
  audioCtx?.close();
  clearTimeout(stopTimer);
  clearInterval(countdownTimer);

  meydaAnalyzer = audioCtx = mediaStream = null;
  isListening = false;
  setAnalyser(null);
  setState(done ? 'ready' : 'idle');
}

// ── Media stream ──────────────────────────────────────────────────────────────
async function getStream(useSystemAudio) {
  if (!useSystemAudio) {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
  }
  if (!/Chrome/.test(navigator.userAgent) || /Edg|OPR/.test(navigator.userAgent)) {
    listenStatus.textContent = '⚠️ System Audio works only in Chrome.';
    setState('idle');
    return null;
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 44100 },
    video: true,
  });
  stream.getVideoTracks().forEach(t => t.stop());
  return stream;
}

// ── Analysis ──────────────────────────────────────────────────────────────────
async function startListening(useSystemAudio) {
  try {
    mediaStream = await getStream(useSystemAudio);
    if (!mediaStream) return;

    audioCtx = new AudioContext();
    const fps      = audioCtx.sampleRate / BUFFER_SIZE;
    const ringSize = Math.round(fps * RING_SECS);
    const updateEveryFrames = Math.round(fps * UPDATE_EVERY);

    const source = audioCtx.createMediaStreamSource(mediaStream);
    const gain   = audioCtx.createGain();
    gain.gain.value = useSystemAudio ? 1 : MIC_GAIN;
    source.connect(gain);

    const analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = BUFFER_SIZE * 2;
    gain.connect(analyserNode);
    setAnalyser(analyserNode);

    isListening = true;

    let ring        = new Float32Array(ringSize);
    let ringHead    = 0;
    let ringFull    = false;
    let prevSpec    = null;
    let frameCount  = 0;
    let emaBpm      = null;
    let secsLeft    = RING_SECS;

    setState('listening', secsLeft);
    countdownTimer = setInterval(() => setState('listening', --secsLeft), 1000);

    stopTimer = setTimeout(() => stopListening(true), (RING_SECS + 5) * 1000);

    meydaAnalyzer = Meyda.createMeydaAnalyzer({
      audioContext: audioCtx,
      source: gain,
      bufferSize: BUFFER_SIZE,
      featureExtractors: ['amplitudeSpectrum'],
      callback({ amplitudeSpectrum: spec }) {
        if (!spec) return;

        const flux = computeFlux(spec, prevSpec);
        prevSpec = Array.from(spec);

        ring[ringHead] = flux;
        ringHead = (ringHead + 1) % ringSize;
        if (ringHead === 0) ringFull = true;
        frameCount++;

        if (!ringFull || frameCount % updateEveryFrames !== 0) return;

        // Flatten ring buffer into ordered array
        const ordered = new Float32Array(ringSize);
        for (let i = 0; i < ringSize; i++) {
          ordered[i] = ring[(ringHead + i) % ringSize];
        }

        const result = acfTempogram(ordered, fps);
        if (!result) return;

        // EMA smoothing
        emaBpm = emaBpm === null ? result.bpm : EMA_ALPHA * result.bpm + (1 - EMA_ALPHA) * emaBpm;
        const bpm = Math.round(emaBpm);
        const pct = Math.round(result.confidence * 100);

        bpmDisplay.textContent = bpm;
        bpmDisplay.classList.remove('pulse');
        void bpmDisplay.offsetWidth;
        bpmDisplay.classList.add('pulse');
        setTimeout(() => bpmDisplay.classList.remove('pulse'), 100);

        listenStatus.textContent = `Confidence ${pct}%`;
      }
    });

    meydaAnalyzer.start();
  } catch {
    setState('error');
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
export function initListenButtons() {
  function handle(btn, useSystem) {
    if (isListening && activeBtn === btn) { stopListening(false); return; }
    if (isListening) return;
    activeBtn = btn;
    startListening(useSystem);
  }
  listenMicBtn.addEventListener('click', () => handle(listenMicBtn, false));
  listenSysBtn.addEventListener('click', () => handle(listenSysBtn, true));
}
