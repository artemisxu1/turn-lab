// ---------- Mobile nav toggle ----------
(function () {
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');
  if (!toggle || !links) return;
  toggle.addEventListener('click', () => {
    const open = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open);
  });
  links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    links.classList.remove('open');
    toggle.setAttribute('aria-expanded', false);
  }));
})();

// ---------- Scroll fade-ins ----------
(function () {
  const els = document.querySelectorAll('.reveal');
  if (!els.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  els.forEach(el => io.observe(el));
})();

// ---------- Interactive "inside a cell" hero canvas (home only) ----------
(function () {
  const canvas = document.getElementById('cellCanvas');
  const hero = document.getElementById('top');
  if (!canvas || !hero) return;
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COLORS = ['#7fd3da', '#34c6d4', '#bfeef2', '#e2864a', '#9c7bd6'];
  let w = 0, h = 0, dpr = 1, parts = [], raf = 0;
  const mouse = { x: -9999, y: -9999, active: false };
  const LINK = 124, REPEL = 140;

  function init() {
    const count = Math.round(Math.min(95, Math.max(34, (w * h) / 13500)));
    parts = [];
    for (let i = 0; i < count; i++) {
      const r = 3 + Math.random() * 4;
      const ang = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * 0.7;
      parts.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        r, c: COLORS[(Math.random() * COLORS.length) | 0]
      });
    }
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = rect.width; h = rect.height;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    init();
  }
  function frame() {
    ctx.clearRect(0, 0, w, h);
    // pairwise pass: elastic collisions (bounce off each other) + signaling links
    for (let i = 0; i < parts.length; i++) {
      const a = parts[i];
      for (let j = i + 1; j < parts.length; j++) {
        const b = parts[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        const minD = a.r + b.r + 6;
        if (d < minD) {
          // separate the overlap, then exchange velocity along the contact normal
          const nx = dx / d, ny = dy / d, overlap = (minD - d) / 2;
          a.x -= nx * overlap; a.y -= ny * overlap;
          b.x += nx * overlap; b.y += ny * overlap;
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel < 0) {
            const p = rel * 0.9; // ~elastic with a touch of damping
            a.vx += p * nx; a.vy += p * ny;
            b.vx -= p * nx; b.vy -= p * ny;
          }
        }
        if (d < LINK) {
          ctx.strokeStyle = 'rgba(127,211,218,' + (1 - d / LINK) * 0.45 + ')';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    // integrate + draw
    for (const p of parts) {
      // avoid the cursor
      if (mouse.active) {
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy);
        if (d < REPEL && d > 0.01) {
          const f = (REPEL - d) / REPEL;
          p.vx += (dx / d) * f * 1.1;
          p.vy += (dy / d) * f * 1.1;
        }
      }
      // spontaneous brownian wander
      p.vx += (Math.random() - .5) * 0.06;
      p.vy += (Math.random() - .5) * 0.06;
      p.vx *= 0.992; p.vy *= 0.992;
      // keep a lively floor and a sane ceiling on speed
      let sp = Math.hypot(p.vx, p.vy);
      if (sp < 0.28) { const a2 = Math.random() * Math.PI * 2; p.vx += Math.cos(a2) * .28; p.vy += Math.sin(a2) * .28; sp = Math.hypot(p.vx, p.vy); }
      if (sp > 2.0) { p.vx = p.vx / sp * 2.0; p.vy = p.vy / sp * 2.0; }
      p.x += p.vx; p.y += p.vy;
      // bounce off the walls of the cytoplasm
      if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx) * 0.9; }
      else if (p.x > w - p.r) { p.x = w - p.r; p.vx = -Math.abs(p.vx) * 0.9; }
      if (p.y < p.r) { p.y = p.r; p.vy = Math.abs(p.vy) * 0.9; }
      else if (p.y > h - p.r) { p.y = h - p.r; p.vy = -Math.abs(p.vy) * 0.9; }
      // soft glow
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4.2);
      g.addColorStop(0, p.c); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4.2, 0, Math.PI * 2); ctx.fill();
      // core
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  }
  function setMouse(e) {
    const rect = canvas.getBoundingClientRect();
    const pt = e.touches ? e.touches[0] : e;
    mouse.x = pt.clientX - rect.left;
    mouse.y = pt.clientY - rect.top;
    mouse.active = true;
  }
  hero.addEventListener('mousemove', setMouse);
  hero.addEventListener('touchmove', setMouse, { passive: true });
  hero.addEventListener('mouseleave', () => { mouse.active = false; mouse.x = mouse.y = -9999; });
  window.addEventListener('resize', resize);
  resize();
  if (reduce) { frame(); cancelAnimationFrame(raf); }  // draw one static frame
  else frame();
})();
