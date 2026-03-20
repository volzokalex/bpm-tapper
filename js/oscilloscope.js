const canvas = document.getElementById('oscilloscope');
const ctx    = canvas.getContext('2d');
let analyser = null;

export function setAnalyser(node) {
  analyser = node;
}

function draw() {
  requestAnimationFrame(draw);

  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const grad = ctx.createLinearGradient(0, 0, W, 0);

  if (!analyser) {
    grad.addColorStop(0,    'transparent');
    grad.addColorStop(0.15, '#2a2a2a');
    grad.addColorStop(0.85, '#2a2a2a');
    grad.addColorStop(1,    'transparent');
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    return;
  }

  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);

  grad.addColorStop(0,   'transparent');
  grad.addColorStop(0.1, '#a78bfa');
  grad.addColorStop(0.9, '#a78bfa');
  grad.addColorStop(1,   'transparent');

  const step = W / data.length;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const y = (data[i] / 255) * H;
    i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * step, y);
  }
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = '#a78bfa';
  ctx.shadowBlur  = 6;
  ctx.stroke();
  ctx.shadowBlur  = 0;
}

draw();
