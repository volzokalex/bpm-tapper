const bpmDisplay = document.getElementById('bpm');
const tapBtn    = document.getElementById('tap-btn');
const tapGlow   = document.getElementById('tap-glow');

const GLOW_COLORS = ['#a78bfa', '#c084fc', '#e879f9', '#f472b6', '#fb7185', '#f87171'];
let glowIndex = 0;
let taps = [];
let resetTimer = null;

export function reset() {
  taps = [];
  clearTimeout(resetTimer);
  bpmDisplay.textContent = '--';
  bpmDisplay.classList.remove('pulse');
}

function flashBpmDisplay() {
  bpmDisplay.classList.remove('pulse');
  void bpmDisplay.offsetWidth;
  bpmDisplay.classList.add('pulse');
  setTimeout(() => bpmDisplay.classList.remove('pulse'), 100);
}

function flashTapBtn() {
  tapBtn.classList.add('active');
  setTimeout(() => tapBtn.classList.remove('active'), 100);
}

function triggerGlow(bpm) {
  const fadeMs = bpm > 0 ? Math.round(60000 / bpm * 0.85) : 600;
  const color  = GLOW_COLORS[glowIndex % GLOW_COLORS.length];
  glowIndex++;

  tapGlow.style.setProperty('--glow-duration', `${fadeMs}ms`);
  tapGlow.style.setProperty('--glow-color', color);
  tapGlow.classList.remove('active');
  void tapGlow.offsetWidth;
  tapGlow.classList.add('active');
}

export function tap() {
  const now = Date.now();
  taps.push(now);
  if (taps.length > 8) taps.shift();

  clearTimeout(resetTimer);
  resetTimer = setTimeout(reset, 3000);

  if (taps.length < 2) {
    bpmDisplay.textContent = '...';
    flashTapBtn();
    return;
  }

  const intervals = taps.slice(1).map((t, i) => t - taps[i]);
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const bpm = Math.round(60000 / avg);

  bpmDisplay.textContent = bpm;
  flashBpmDisplay();
  flashTapBtn();
  triggerGlow(bpm);
}
