import { tap, reset } from './tap.js';
import { initListenButtons } from './listen.js';

// TAP button + keyboard
document.getElementById('tap-btn').addEventListener('click', tap);
document.getElementById('reset-btn').addEventListener('click', reset);

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    tap();
  }
  if (e.code === 'KeyR') reset();
});

// Listen mode
initListenButtons();
