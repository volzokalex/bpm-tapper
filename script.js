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
