/* ============================================================
   PPI-style interaction network.

   Progressive enhancement: the page ships the real content as a plain
   list of .net-item cards. On a wide screen with motion allowed, that
   content is lifted into a STRING-like graph of bubbles.

   The layout is solved once, up front, and then frozen — nothing drifts,
   wobbles, or settles on its own. Nodes move for exactly two reasons:
   you are dragging one, or one has been opened and the others step aside
   to make room. Every move is a single eased tween toward a target that
   was computed before the motion started, so there is nothing to
   oscillate against.
   ============================================================ */
(function () {
  const graphs = document.querySelectorAll('.netgraph');
  if (!graphs.length) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);

  // Label colour for a bubble fill. Saturated mid-tones like #5b8cff read at
  // only ~3:1 against white but ~6:1 against near-black, so most bubbles get
  // dark ink; the comparison picks whichever actually wins.
  function inkFor(hex) {
    const c = hex.replace('#', '');
    const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return (L + 0.05) / 0.0566 >= 1.05 / (L + 0.05) ? '#0d0726' : '#ffffff';
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
      this.raf = 0;
      this.dragging = null;
      this.moved = false;   // true once the visitor has repositioned a bubble

      this.hasRoles = this.items.some(li => li.dataset.role);
      this.measure();
      this.solveLayout();
      this.snapToTargets();
      this.paint();

      let rt = 0;
      window.addEventListener('resize', () => {
        clearTimeout(rt);
        rt = setTimeout(() => {
          const ow = this.w, oh = this.h;
          this.measure();
          if (this.moved && ow && oh) {
            // keep the arrangement the user built, just rescale it
            const sx = this.w / ow, sy = this.h / oh;
            this.nodes.forEach(n => {
              n.bx = clamp(n.bx * sx, n.baseR + 6, this.w - n.baseR - 6);
              n.by = clamp(n.by * sy, n.baseR + 6, this.h - n.baseR - 6);
            });
            this.edges.forEach(e => {
              const a = this.nodes[e.a], b = this.nodes[e.b];
              e.rest = Math.hypot(b.bx - a.bx, b.by - a.by) || 1;
            });
            this.homeTargets();
          } else {
            this.solveLayout();
          }
          if (this.open) this.retarget(this.open);
          this.snapToTargets(); this.paint();
        }, 160);
      });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });
      this.stage.addEventListener('pointerdown', e => {
        if (e.target === this.stage || e.target === this.svg) this.close();
      });
    }

    /* ---------- build ---------- */

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
      const role = li.dataset.role || '';
      front.innerHTML = '<span class="net-name">' + label + '</span>'
        + (role ? '<span class="net-role-cap">' + role + '</span>' : '');
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
        el, front, back, label, i,
        x: 0, y: 0,      // where it is now
        tx: 0, ty: 0,    // where it is heading
        bx: 0, by: 0,    // its home in the frozen layout
        r: 56, baseR: 56, open: false, drag: false, moved: 0
      };

      front.addEventListener('click', () => { if (n.moved < 6) this.toggle(n); });
      front.addEventListener('pointerdown', e => this.startDrag(e, n));
      close.addEventListener('click', () => this.close());
      return n;
    }

    // ring + chords: four bonds per node, so the shape is rigid enough that a
    // dragged bubble visibly strains the whole graph
    buildEdges(n) {
      const seen = new Set(), edges = [];
      const add = (a, b) => {
        const k = a < b ? a + ':' + b : b + ':' + a;
        if (a === b || seen.has(k)) return;
        seen.add(k); edges.push({ a, b });
      };
      for (let i = 0; i < n; i++) { add(i, (i + 1) % n); if (n > 3) add(i, (i + 2) % n); }
      return edges;
    }

    measure() {
      const rect = this.stage.getBoundingClientRect();
      this.w = rect.width; this.h = rect.height;
      const compact = this.w < 820;
      this.nodes.forEach(n => {
        n.baseR = compact ? 46 : 56;
        n.r = n.baseR;
        n.el.style.setProperty('--r', n.baseR + 'px');
      });
      this.rest = compact ? 158 : 196;
      const wanted = parseInt(this.root.dataset.cardWidth, 10);
      this.cardW = compact ? 292 : (wanted || 336);
      if (this.cardW > this.w - 40) this.cardW = Math.max(280, this.w - 40);
    }

    /* ---------- layout, solved once then frozen ---------- */

    // The resting arrangement is a plain evenly-spaced circle. No relaxation,
    // no wobble: the radius is just wide enough that neighbouring bubbles clear
    // each other, and narrow enough to stay inside the stage.
    solveLayout() {
      const n = this.nodes.length, cx = this.w / 2, cy = this.h / 2;
      const r = this.nodes[0].baseR;
      const needed = (r * 2 + 40) / (2 * Math.sin(Math.PI / n));   // chord >= bubble + gap
      const foot = this.hasRoles ? 34 : 12;                        // room for the role caption
      const fits = Math.min(this.w / 2 - r - 12, this.h / 2 - r - foot);
      const rad = clamp(Math.max(needed, Math.min(this.w, this.h) * 0.32), 0, fits);

      this.nodes.forEach((nd, i) => {
        const a = (i / n) * TAU - Math.PI / 2;   // first node at twelve o'clock
        nd.x = nd.bx = cx + Math.cos(a) * rad;
        nd.y = nd.by = cy + Math.sin(a) * rad;
      });
      this.edges.forEach(e => {
        const a = this.nodes[e.a], b = this.nodes[e.b];
        e.rest = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      });
      this.homeTargets();
    }

    separate(list, strength) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          const min = (a.baseR || a.r) + (b.baseR || b.r) + 30;
          const dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          if (d < 0.001) { b.x += 0.7; d = 0.7; }
          if (d < min) {
            const push = (min - d) / d * 0.5 * strength;
            const ox = dx * push, oy = dy * push;
            a.x -= ox; a.y -= oy; b.x += ox; b.y += oy;
          }
        }
      }
    }

    homeTargets() { this.nodes.forEach(n => { n.tx = n.bx; n.ty = n.by; }); }

    snapToTargets() { this.nodes.forEach(n => { n.x = n.tx; n.y = n.ty; }); }

    /* ---------- opening: work out every destination before moving ---------- */

    retarget(openNode) {
      const cardW = openNode.cardW, cardH = openNode.cardH;
      const halfW = cardW / 2, halfH = cardH / 2;

      // the card itself: nudged just enough to sit fully inside the stage
      const ox = clamp(openNode.bx, halfW + 10, Math.max(halfW + 10, this.w - halfW - 10));
      const oy = clamp(openNode.by, halfH + 10, Math.max(halfH + 10, this.h - halfH - 10));
      openNode.tx = ox; openNode.ty = oy;

      // everyone else starts from home and steps out of the card's way
      const others = this.nodes.filter(n => n !== openNode)
        .map(n => ({ ref: n, x: n.bx, y: n.by, baseR: n.baseR }));

      for (let it = 0; it < 160; it++) {
        for (const p of others) {
          const gap = p.baseR + 34;
          const qx = clamp(p.x, ox - halfW, ox + halfW);
          const qy = clamp(p.y, oy - halfH, oy + halfH);
          let dx = p.x - qx, dy = p.y - qy;
          let d = Math.hypot(dx, dy);
          if (d < gap) {
            if (d < 0.001) {           // dead centre: leave along the long axis
              dx = p.x - ox; dy = p.y - oy;
              d = Math.hypot(dx, dy) || 1;
              dx /= d; dy /= d;
              p.x = ox + dx * (halfW + gap); p.y = oy + dy * (halfH + gap);
            } else {
              p.x = qx + dx / d * gap; p.y = qy + dy / d * gap;
            }
          } else {
            // no longer in the way — drift back toward home so the graph keeps its shape
            p.x += (p.ref.bx - p.x) * 0.06;
            p.y += (p.ref.by - p.y) * 0.06;
          }
        }
        this.separate(others, 0.6);
        const foot = this.hasRoles ? 34 : 6;
        for (const p of others) {
          p.x = clamp(p.x, p.baseR + 6, this.w - p.baseR - 6);
          p.y = clamp(p.y, p.baseR + 6, this.h - p.baseR - foot);
        }
      }
      others.forEach(p => { p.ref.tx = p.x; p.ref.ty = p.y; });
    }

    /* ---------- interaction ---------- */

    toggle(n) { n.open ? this.close() : this.openNode(n); }

    openNode(n) {
      if (this.open) this.close();
      n.open = true;
      this.open = n;
      this.root.classList.add('has-open');
      n.el.classList.add('is-open');
      n.front.setAttribute('aria-expanded', 'true');

      // size the card to its own content, then remember it for the clearance maths
      n.back.style.width = this.cardW + 'px';
      const h = Math.min(n.back.scrollHeight, Math.round(this.h * 0.78));
      n.back.style.height = h + 'px';
      n.el.style.setProperty('--cw', this.cardW + 'px');
      n.el.style.setProperty('--ch', h + 'px');
      n.cardW = this.cardW; n.cardH = h;
      n.back.classList.toggle('is-scrolling', n.back.scrollHeight > h + 2);

      this.edges.forEach(e => e.el.classList.toggle('is-live', e.a === n.i || e.b === n.i));

      this.retarget(n);
      this.run();
      requestAnimationFrame(() => n.back.querySelector('.net-close') && n.back.querySelector('.net-close').focus());
    }

    close() {
      const n = this.open;
      if (!n) return;
      n.open = false; this.open = null;
      this.root.classList.remove('has-open');
      n.el.classList.remove('is-open');
      n.front.setAttribute('aria-expanded', 'false');
      this.edges.forEach(e => e.el.classList.remove('is-live'));
      this.homeTargets();
      this.run();
    }

    startDrag(e, n) {
      if (n.open) return;
      n.moved = 0;
      const rect = this.stage.getBoundingClientRect();
      const offX = n.x - (e.clientX - rect.left);
      const offY = n.y - (e.clientY - rect.top);
      n.drag = true;
      this.dragging = n;
      n.el.classList.add('is-dragging');
      try { if (e.target.setPointerCapture) e.target.setPointerCapture(e.pointerId); } catch (_) {}

      const move = ev => {
        const r = this.stage.getBoundingClientRect();
        const tx = clamp(ev.clientX - r.left + offX, n.baseR, this.w - n.baseR);
        const foot = this.hasRoles ? 30 : 0;
        const ty = clamp(ev.clientY - r.top + offY, n.baseR, this.h - n.baseR - foot);
        n.moved += Math.abs(tx - n.x) + Math.abs(ty - n.y);
        n.x = n.tx = tx; n.y = n.ty = ty;   // follows the pointer exactly
        this.paint();
      };
      const up = () => {
        n.drag = false; this.dragging = null;
        n.el.classList.remove('is-dragging');
        // where you drop it is where it lives now — the bonds just stretch to
        // follow, since they never break
        n.bx = n.x; n.by = n.y;
        n.tx = n.x; n.ty = n.y;
        if (n.moved > 6) this.moved = true;
        e.target.removeEventListener('pointermove', move);
        e.target.removeEventListener('pointerup', up);
        e.target.removeEventListener('pointercancel', up);
        this.paint();
      };
      e.target.addEventListener('pointermove', move);
      e.target.addEventListener('pointerup', up);
      e.target.addEventListener('pointercancel', up);
    }

    /* ---------- the only animation loop, and it stops itself ---------- */

    run() {
      if (this.raf) return;
      const tick = () => {
        let moving = false;
        for (const n of this.nodes) {
          if (n.drag) continue;
          const dx = n.tx - n.x, dy = n.ty - n.y;
          if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) { n.x = n.tx; n.y = n.ty; continue; }
          n.x += dx * 0.16; n.y += dy * 0.16;
          moving = true;
        }
        this.paint();
        if (moving || this.dragging) { this.raf = requestAnimationFrame(tick); }
        else { this.raf = 0; this.paint(); }   // one last exact frame, then idle
      };
      this.raf = requestAnimationFrame(tick);
    }

    paint() {
      for (const n of this.nodes) {
        n.el.style.transform = 'translate(' + n.x.toFixed(1) + 'px,' + n.y.toFixed(1) + 'px)';
      }
      for (const e of this.edges) {
        const a = this.nodes[e.a], b = this.nodes[e.b];
        e.el.setAttribute('x1', a.x.toFixed(1)); e.el.setAttribute('y1', a.y.toFixed(1));
        e.el.setAttribute('x2', b.x.toFixed(1)); e.el.setAttribute('y2', b.y.toFixed(1));
        // a stretched bond goes taut rather than snapping
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        const t = clamp((d - e.rest) / e.rest, 0, 1);
        e.el.style.strokeWidth = (1.5 + t * 2.4).toFixed(2);
        e.el.style.opacity = (0.3 + t * 0.6).toFixed(2);
      }
    }
  }

  graphs.forEach(root => {
    // Narrow screens and reduced-motion visitors keep the plain card list:
    // dragging bubbles on a touchscreen fights the page scroll.
    if (reduce || window.innerWidth < 820) return;
    new Graph(root);
  });
})();
