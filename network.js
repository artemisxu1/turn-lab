/* ============================================================
   PPI-style interaction network.
   Progressive enhancement: the page ships the real content as a
   plain list of .net-item cards. If the viewport is wide enough and
   motion is allowed, we lift that content into a STRING-like network
   of bubbles held together by springs. Drag a bubble and the bonds
   stretch, glow, and pull it back — they never break. Click a bubble
   and it flips over into the card it came from.
   ============================================================ */
(function () {
  const graphs = document.querySelectorAll('.netgraph');
  if (!graphs.length) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // A readable label colour for a given bubble fill. Saturated mid-tones like
  // #5b8cff read at only ~3:1 against white but ~6:1 against near-black, so the
  // threshold sits low on purpose: almost every bubble gets dark ink.
  function inkFor(hex) {
    const c = hex.replace('#', '');
    const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const onDark = (L + 0.05) / 0.0566;   // contrast vs #0d0726
    const onWhite = 1.05 / (L + 0.05);
    return onDark >= onWhite ? '#0d0726' : '#ffffff';
  }

  class Graph {
    constructor(root) {
      this.root = root;
      this.items = Array.from(root.querySelectorAll('.net-item'));
      if (this.items.length < 2) return;

      this.stage = document.createElement('div');
      this.stage.className = 'net-stage';
      this.svg = document.createElementNS(SVG_NS, 'svg');
      this.svg.setAttribute('class', 'net-edges');
      this.svg.setAttribute('aria-hidden', 'true');
      this.stage.appendChild(this.svg);

      this.nodes = this.items.map((li, i) => this.buildNode(li, i));
      this.edges = this.buildEdges(this.nodes.length);
      this.edges.forEach(e => {
        e.el = document.createElementNS(SVG_NS, 'line');
        e.el.setAttribute('class', 'net-edge');
        this.svg.appendChild(e.el);
      });

      root.appendChild(this.stage);
      root.classList.add('is-enhanced');

      this.open = null;
      this.drag = null;
      this.raf = 0;
      this.measure();
      this.seed();

      window.addEventListener('resize', () => { this.measure(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });
      this.stage.addEventListener('pointerdown', e => {
        if (e.target === this.stage || e.target === this.svg) this.close();
      });
      this.loop();
    }

    buildNode(li, i) {
      const label = li.dataset.label || ('Item ' + (i + 1));
      const color = li.dataset.color || '#5b8cff';

      const el = document.createElement('div');
      el.className = 'net-node';
      el.style.setProperty('--bub', color);
      el.style.setProperty('--bub-ink', inkFor(color));

      const inner = document.createElement('div');
      inner.className = 'net-inner';

      const front = document.createElement('button');
      front.type = 'button';
      front.className = 'net-face net-front';
      front.innerHTML = '<span>' + label + '</span>';
      front.setAttribute('aria-expanded', 'false');

      const back = document.createElement('div');
      back.className = 'net-face net-back';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'net-close';
      close.setAttribute('aria-label', 'Close ' + label);
      close.innerHTML = '&times;';
      const body = document.createElement('div');
      body.className = 'net-body';
      body.innerHTML = li.innerHTML;
      back.appendChild(close);
      back.appendChild(body);

      inner.appendChild(front);
      inner.appendChild(back);
      el.appendChild(inner);
      this.stage.appendChild(el);

      const n = {
        el, front, back, label,
        x: 0, y: 0, vx: 0, vy: 0,
        r: 56, baseR: 56, open: false, pinned: false, moved: 0
      };

      front.addEventListener('click', () => { if (n.moved < 6) this.toggle(n); });
      close.addEventListener('click', () => this.close());
      front.addEventListener('pointerdown', e => this.startDrag(e, n));
      return n;
    }

    // ring + chords: every node keeps four bonds, which makes the whole
    // thing springy enough to snap back into shape
    buildEdges(n) {
      const seen = new Set(), edges = [];
      const add = (a, b) => {
        const k = a < b ? a + ':' + b : b + ':' + a;
        if (a === b || seen.has(k)) return;
        seen.add(k); edges.push({ a, b, stretch: 0 });
      };
      for (let i = 0; i < n; i++) { add(i, (i + 1) % n); if (n > 3) add(i, (i + 2) % n); }
      return edges;
    }

    measure() {
      const rect = this.stage.getBoundingClientRect();
      this.w = rect.width; this.h = rect.height;
      const compact = this.w < 780;
      this.nodes.forEach(n => {
        n.baseR = compact ? 46 : 56;
        if (!n.open) n.r = n.baseR;
        n.el.style.setProperty('--r', n.baseR + 'px');
      });
      this.link = compact ? 150 : 190;
    }

    seed() {
      const cx = this.w / 2, cy = this.h / 2;
      const rad = Math.min(cx, cy) * 0.58;
      this.nodes.forEach((n, i) => {
        const a = (i / this.nodes.length) * Math.PI * 2 - Math.PI / 2;
        n.x = cx + Math.cos(a) * rad;
        n.y = cy + Math.sin(a) * rad;
      });
    }

    startDrag(e, n) {
      if (n.open) return;
      n.moved = 0;
      const rect = this.stage.getBoundingClientRect();
      this.drag = { n, dx: n.x - (e.clientX - rect.left), dy: n.y - (e.clientY - rect.top) };
      n.pinned = true;
      n.el.classList.add('is-dragging');
      e.target.setPointerCapture?.(e.pointerId);

      const move = ev => {
        const r = this.stage.getBoundingClientRect();
        const tx = ev.clientX - r.left + this.drag.dx;
        const ty = ev.clientY - r.top + this.drag.dy;
        n.moved += Math.abs(tx - n.x) + Math.abs(ty - n.y);
        n.x = tx; n.y = ty; n.vx = n.vy = 0;
      };
      const up = () => {
        n.pinned = false;
        n.el.classList.remove('is-dragging');
        this.drag = null;
        e.target.removeEventListener('pointermove', move);
        e.target.removeEventListener('pointerup', up);
        e.target.removeEventListener('pointercancel', up);
      };
      e.target.addEventListener('pointermove', move);
      e.target.addEventListener('pointerup', up);
      e.target.addEventListener('pointercancel', up);
    }

    toggle(n) { n.open ? this.close() : this.openNode(n); }

    openNode(n) {
      this.close();
      n.open = true; n.pinned = true;
      n.el.classList.add('is-open');
      n.front.setAttribute('aria-expanded', 'true');
      // the card takes up much more room, so its repulsion radius grows and
      // the rest of the network parts to make space
      const card = this.w < 780 ? { w: 300, h: 340 } : { w: 372, h: 424 };
      n.r = Math.max(card.w, card.h) * 0.52;
      n.cardW = card.w; n.cardH = card.h;
      this.open = n;
      requestAnimationFrame(() => n.back.querySelector('.net-close')?.focus());
    }

    close() {
      const n = this.open;
      if (!n) return;
      n.open = false; n.pinned = false; n.r = n.baseR;
      n.el.classList.remove('is-open');
      n.front.setAttribute('aria-expanded', 'false');
      this.open = null;
    }

    step() {
      const nodes = this.nodes, cx = this.w / 2, cy = this.h / 2;

      // springs — long bonds pull hard, but never let go
      for (const e of this.edges) {
        const a = nodes[e.a], b = nodes[e.b];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const rest = this.link + (a.open || b.open ? 150 : 0);
        const f = (d - rest) * 0.0022;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        if (!a.pinned) { a.vx += fx; a.vy += fy; }
        if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
        e.stretch = Math.max(0, (d - rest) / rest);
      }

      // mutual repulsion so bubbles never sit on top of each other
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.hypot(dx, dy) || 0.001;
          const min = a.r + b.r + 26;
          if (d < min) {
            const f = (min - d) * 0.02;
            const fx = (dx / d) * f, fy = (dy / d) * f;
            if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
            if (!b.pinned) { b.vx += fx; b.vy += fy; }
          }
        }
      }

      for (const n of nodes) {
        if (!n.pinned) {
          // drift home, damp, integrate
          n.vx += (cx - n.x) * 0.00045;
          n.vy += (cy - n.y) * 0.00045;
          n.vx *= 0.90; n.vy *= 0.90;
          const sp = Math.hypot(n.vx, n.vy);
          if (sp > 14) { n.vx = n.vx / sp * 14; n.vy = n.vy / sp * 14; }
          n.x += n.vx; n.y += n.vy;
        }
        // stay inside the stage
        const halfW = n.open ? n.cardW / 2 : n.r;
        const halfH = n.open ? n.cardH / 2 : n.r;
        n.x = Math.min(this.w - halfW - 4, Math.max(halfW + 4, n.x));
        n.y = Math.min(this.h - halfH - 4, Math.max(halfH + 4, n.y));
      }
    }

    paint() {
      for (const n of this.nodes) {
        n.el.style.transform = 'translate(' + (n.x | 0) + 'px,' + (n.y | 0) + 'px)';
      }
      for (const e of this.edges) {
        const a = this.nodes[e.a], b = this.nodes[e.b];
        e.el.setAttribute('x1', a.x); e.el.setAttribute('y1', a.y);
        e.el.setAttribute('x2', b.x); e.el.setAttribute('y2', b.y);
        // a stretched bond goes taut: brighter and thicker, so pulling
        // one bubble away visibly strains the whole network
        const t = Math.min(1, e.stretch);
        e.el.style.strokeWidth = (1.6 + t * 2.6).toFixed(2);
        e.el.style.opacity = (0.34 + t * 0.62).toFixed(2);
      }
    }

    loop() {
      this.step(); this.paint();
      this.raf = requestAnimationFrame(() => this.loop());
    }
  }

  graphs.forEach(root => {
    // Narrow screens and reduced-motion users keep the plain card list —
    // dragging bubbles on a phone fights the scroll.
    if (reduce || window.innerWidth < 720) return;
    new Graph(root);
  });
})();
