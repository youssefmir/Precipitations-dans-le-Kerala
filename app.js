/* ==========================================================================
   Mousson du Kerala : graphiques et animations
   Données : window.SITE_DATA (docs/data.js, généré par scripts/build_site_data.py).
   Outils communs : window.Frame (frame.js). Aucune autre dépendance.

   Principe des animations : le rendu par défaut est l'état final. Un graphique
   n'est remis à son état de départ que lorsque le lecteur fait défiler la page
   et s'en approche ; il s'anime ensuite en entrant dans l'écran. Sans défilement,
   ou avec « mouvement réduit », la page est complète.
   ========================================================================== */
(function () {
  'use strict';

  const D = window.SITE_DATA;
  const F = window.Frame;
  const { fmt, svg, html } = F;
  const YEARS = D.rain.years;
  const MONSOON_MONTHS = new Set([5, 6, 7, 8]);
  const mmFmt = (v) => fmt.unit(v, 'mm');
  const pctFmt = (v, d = 0) => `${fmt.num(v, d)} %`;

  /* ---------- Couleurs (lues dans les tokens CSS du conteneur) ---------- */

  function hexToRgb(hex) {
    const n = parseInt(hex.trim().replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /** Rampe déclarée dans un token CSS → fonction t ∈ [0, 1] → couleur. */
  function ramp(token, el) {
    const stops = F.cssVar(token, el).split(',').map(hexToRgb);
    return (t) => {
      const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(x));
      const f = x - i;
      const rgb = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
      return `rgb(${rgb.join(', ')})`;
    };
  }

  /* ---------- Montage : rendu initial, redimensionnement, thème ---------- */

  const renderers = [];
  function mount(id, render) {
    const el = document.getElementById(id);
    if (!el) return;
    const run = () => {
      if (el.clientWidth > 0) render(el, el.clientWidth);
    };
    renderers.push(run);
    F.onResize(el, run);
  }
  F.onTheme(() => renderers.forEach((run) => run()));

  /** Applique un changement d'état sans transition (rendu, remise à zéro). */
  function instantly(root, change) {
    root.classList.add('no-anim');
    change();
    void root.getBoundingClientRect();
    requestAnimationFrame(() => root.classList.remove('no-anim'));
  }

  /* ---------- Animations déclenchées par le défilement ---------- */

  const watched = [];
  let ticking = false;

  /** Remet à zéro quand le lecteur s'approche (par le bas), joue à l'entrée dans l'écran. */
  function reveal(target, { reset, play, threshold = 0.35 }) {
    if (!target || F.reducedMotion || !('IntersectionObserver' in window)) return;
    const item = { target, reset, state: 'final' };
    watched.push(item);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && item.state === 'armed') {
            item.state = 'played';
            play();
            io.disconnect();
          }
        }
      },
      { threshold }
    );
    io.observe(target);
  }

  addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        for (const item of watched) {
          if (item.state !== 'final') continue;
          const top = item.target.getBoundingClientRect().top;
          if (top > innerHeight && top < innerHeight + 320) {
            item.state = 'armed';
            item.reset();
          }
        }
      });
    },
    { passive: true }
  );

  /** Étapes d'un récit défilant : l'étape qui croise le milieu de l'écran devient active. */
  function scrollSteps(container, onStep) {
    const steps = [...container.querySelectorAll('.step')];
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const k = steps.indexOf(e.target);
          steps.forEach((s, i) => s.classList.toggle('is-active', i === k));
          onStep(k);
        }
      },
      { rootMargin: '-46% 0px -46% 0px' }
    );
    steps.forEach((s) => io.observe(s));
  }

  /* ---------- Outils de dessin ---------- */

  function chart(el, width, height, label, cls) {
    el.replaceChildren();
    return svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': label, class: cls }, el);
  }

  function columnPath(x, y, w, h, r = 2) {
    const rr = Math.max(0, Math.min(r, w / 2, h));
    return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
  }

  function barPath(x, y, w, h, r = 3) {
    const rr = Math.max(0, Math.min(r, h / 2, w));
    return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
  }

  function yAxis(parent, y, ticks, x0, x1, format) {
    const grid = svg('g', { class: 'grid' }, parent);
    const axis = svg('g', { class: 'axis' }, parent);
    for (const t of ticks) {
      svg('line', { x1: x0, x2: x1, y1: y(t), y2: y(t) }, grid);
      svg('text', { x: x0 - 8, y: y(t), dy: '0.32em', 'text-anchor': 'end', text: format(t) }, axis);
    }
  }

  function yearTicks(parent, xOf, years, y) {
    const axis = svg('g', { class: 'axis' }, parent);
    for (const year of years) svg('text', { x: xOf(year), y, 'text-anchor': 'middle', text: String(year) }, axis);
  }

  function toLocal(root, evt) {
    const p = root.createSVGPoint();
    p.x = evt.clientX;
    p.y = evt.clientY;
    return p.matrixTransform(root.getScreenCTM().inverse());
  }

  /** Réticule vertical + infobulle + clavier (← →) sur une série indexée. */
  function crosshair(parent, root, { n, xOf, box, content, label, start = n - 1 }) {
    const line = svg('line', { class: 'crosshair', y1: box.y0, y2: box.y1, visibility: 'hidden' }, parent);
    const hit = svg('rect', { class: 'hit', x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0, tabindex: 0, 'aria-label': label }, parent);
    let current = -1;
    const nearest = (px) => {
      let best = 0;
      for (let i = 1; i < n; i++) if (Math.abs(xOf(i) - px) < Math.abs(xOf(best) - px)) best = i;
      return best;
    };
    const show = (i, anchor) => {
      current = i;
      line.setAttribute('x1', xOf(i));
      line.setAttribute('x2', xOf(i));
      line.setAttribute('visibility', 'visible');
      F.tip.show(anchor || line, content(i));
    };
    const hide = () => {
      line.setAttribute('visibility', 'hidden');
      F.tip.hide();
    };
    hit.addEventListener('pointermove', (e) => show(nearest(toLocal(root, e).x), e));
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('focus', () => show(current < 0 ? start : current));
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const base = current < 0 ? start : current;
      show(Math.max(0, Math.min(n - 1, base + (e.key === 'ArrowRight' ? 1 : -1))));
    });
  }

  /** Vue tableau repliable, insérée juste après un nœud (jumeau accessible d'un graphique). */
  function tableAfter(node, options) {
    if (!node) return;
    const holder = html('div', { class: node.classList.contains('wide') ? 'wide' : null });
    node.after(holder);
    F.dataTable(holder, options);
  }

  /* =======================================================================
     1. Le cadran de la mousson (en-tête) : il se remplit mois après mois
     ======================================================================= */

  let clockFilled = false;

  function renderClock(el, size) {
    el.replaceChildren();
    const S = 700;
    const C = S / 2;
    const R0 = 100;
    const R1 = 288;
    const k = Math.min(1.7, S / size);
    const n = YEARS.length;
    const ringW = (R1 - R0) / n;
    const GAP = 12;
    const SECTOR = (360 - GAP) / 12;
    const MONTH_GAP = 0.9;
    const VMAX = 1550;
    const rain = ramp('--rain-ramp', el);
    const tOf = (v) => Math.sqrt(Math.max(0, v) / VMAX);
    const rad = (deg) => (deg * Math.PI) / 180;
    const pt = (r, deg) => [C + r * Math.sin(rad(deg)), C - r * Math.cos(rad(deg))];
    const start = (m) => GAP / 2 + m * SECTOR + MONTH_GAP / 2;
    const end = (m) => start(m) + SECTOR - MONTH_GAP;
    const f2 = (v) => v.toFixed(2);
    const sector = (ra, rb, a0, a1) => {
      const [x0, y0] = pt(rb, a0);
      const [x1, y1] = pt(rb, a1);
      const [x2, y2] = pt(ra, a1);
      const [x3, y3] = pt(ra, a0);
      return `M${f2(x0)},${f2(y0)}A${rb},${rb} 0 0 1 ${f2(x1)},${f2(y1)}L${f2(x2)},${f2(y2)}A${ra},${ra} 0 0 0 ${f2(x3)},${f2(y3)}Z`;
    };

    const root = svg('svg', {
      viewBox: `0 0 ${S} ${S}`,
      tabindex: 0,
      role: 'group',
      'aria-label':
        'Cadran de la mousson : pluie de chaque mois de 1901 (centre) à 2017 (bord). Flèches gauche et droite pour changer de mois, haut et bas pour changer d’année.',
    }, el);

    const cells = svg('g', { class: 'clock-cells' }, root);
    const fill = !clockFilled && !F.reducedMotion;
    for (let i = 0; i < n; i++) {
      const ra = R0 + i * ringW;
      const rb = i === n - 1 ? R1 : ra + ringW + 0.6;
      for (let m = 0; m < 12; m++) {
        const cell = svg('path', { d: sector(ra, rb, start(m), end(m)), fill: rain(tOf(D.rain.monthly[i][m])) }, cells);
        if (fill) cell.style.setProperty('--d', String(Math.round((i * 12 + m) * 1.3)));
      }
    }
    if (fill) {
      clockFilled = true;
      cells.classList.add('is-filling');
      setTimeout(() => cells.classList.remove('is-filling'), 2600);
    }

    D.rain.months.forEach((name, m) => {
      const angle = (start(m) + end(m)) / 2;
      const [x, y] = pt(R1 + 16, angle);
      const side = Math.sin(rad(angle));
      svg('text', {
        class: `clock-month${MONSOON_MONTHS.has(m) ? ' clock-month--monsoon' : ''}`,
        x,
        y,
        dy: '0.35em',
        'text-anchor': side > 0.35 ? 'start' : side < -0.35 ? 'end' : 'middle',
        style: { fontSize: `${13 * k}px` },
        text: name,
      }, root);
    });
    for (const year of [1901, 1950, 2000]) {
      const i = YEARS.indexOf(year);
      svg('text', {
        class: 'clock-year',
        x: C,
        y: C - (R0 + (i + 0.5) * ringW),
        dy: '0.35em',
        'text-anchor': 'middle',
        style: { fontSize: `${11 * k}px` },
        text: String(year),
      }, root);
    }

    // Centre : le mot « pluie » en malayalam au repos, la lecture d'un mois au survol
    const rest = svg('g', { 'text-anchor': 'middle' }, root);
    svg('text', { class: 'clock-word', x: C, y: C + 10, lang: 'ml', style: { fontSize: `${74 * Math.min(k, 1.25)}px` }, text: 'മഴ' }, rest);
    svg('text', { class: 'clock-gloss', x: C, y: C + 44, style: { fontSize: `${13 * k}px` }, text: 'mazha, la pluie' }, rest);
    const read = svg('g', { 'text-anchor': 'middle', visibility: 'hidden' }, root);
    const readYear = svg('text', { class: 'clock-read__year', x: C, y: C - 4, style: { fontSize: `${40 * Math.min(k, 1.3)}px` } }, read);
    const readMonth = svg('text', { class: 'clock-read__line', x: C, y: C + 24, style: { fontSize: `${13 * k}px` } }, read);
    const readValue = svg('text', { class: 'clock-read__line', x: C, y: C + 46, style: { fontSize: `${15 * k}px`, fontWeight: 700 } }, read);

    const ring = svg('circle', { class: 'clock-ring', cx: C, cy: C, r: 0, visibility: 'hidden' }, root);
    const focus = svg('path', { class: 'clock-focus', visibility: 'hidden' }, root);
    let current = null;
    const select = (i, m, anchor) => {
      current = [i, m];
      const value = D.rain.monthly[i][m];
      const ra = R0 + i * ringW;
      focus.setAttribute('d', sector(ra, ra + ringW, start(m), end(m)));
      focus.setAttribute('visibility', 'visible');
      ring.setAttribute('r', ra + ringW / 2);
      ring.setAttribute('visibility', 'visible');
      rest.setAttribute('visibility', 'hidden');
      read.setAttribute('visibility', 'visible');
      readYear.textContent = String(YEARS[i]);
      readMonth.textContent = D.rain.months[m];
      readValue.textContent = mmFmt(value);
      F.tip.show(anchor || focus, {
        title: `${D.rain.months[m]} ${YEARS[i]}`,
        rows: [
          { value: mmFmt(value), label: 'de pluie' },
          { value: `${fmt.num(value / D.rain.climatology[m], 1)} ×`, label: 'la moyenne de ce mois' },
        ],
      });
    };
    const reset = () => {
      current = null;
      focus.setAttribute('visibility', 'hidden');
      ring.setAttribute('visibility', 'hidden');
      read.setAttribute('visibility', 'hidden');
      rest.setAttribute('visibility', 'visible');
      F.tip.hide();
    };
    root.addEventListener('pointermove', (e) => {
      const p = toLocal(root, e);
      const r = Math.hypot(p.x - C, p.y - C);
      let a = (Math.atan2(p.x - C, C - p.y) * 180) / Math.PI;
      if (a < 0) a += 360;
      const m = Math.floor((a - GAP / 2) / SECTOR);
      if (r < R0 || r > R1 || m < 0 || m > 11) return reset();
      select(Math.min(n - 1, Math.floor((r - R0) / ringW)), m, e);
    });
    root.addEventListener('pointerleave', reset);
    root.addEventListener('blur', reset);
    root.addEventListener('focus', () => select(current ? current[0] : n - 1, current ? current[1] : 6));
    root.addEventListener('keydown', (e) => {
      const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [1, 0], ArrowDown: [-1, 0] };
      if (!moves[e.key]) return;
      e.preventDefault();
      const [i, m] = current || [n - 1, 6];
      select(Math.max(0, Math.min(n - 1, i + moves[e.key][0])), (m + moves[e.key][1] + 12) % 12);
    });

    rampLegend(document.getElementById('clock-ramp'), rain, VMAX);
  }

  function rampLegend(el, colorAt, vmax) {
    if (!el) return;
    el.replaceChildren();
    const W = 320;
    const root = svg('svg', { viewBox: `0 0 ${W} 30`, width: '100%' }, el);
    const grad = svg('linearGradient', { id: 'clock-gradient' }, svg('defs', {}, root));
    for (let s = 0; s <= 20; s++) svg('stop', { offset: `${s * 5}%`, 'stop-color': colorAt(s / 20) }, grad);
    svg('rect', { x: 0, y: 0, width: W, height: 9, rx: 1, fill: 'url(#clock-gradient)' }, root);
    const axis = svg('g', { class: 'axis' }, root);
    for (const v of [0, 100, 400, 900, 1500]) {
      if (v === 900) continue;
      const x = Math.sqrt(v / vmax) * W;
      svg('text', {
        x: Math.min(W - 1, Math.max(1, x)),
        y: 25,
        'text-anchor': v === 0 ? 'start' : v === 1500 ? 'end' : 'middle',
        text: v === 1500 ? '1 500 mm' : fmt.num(v),
      }, axis);
    }
  }

  /* =======================================================================
     2. La mousson en quatre temps (graphique fixe + étapes de texte)
     ======================================================================= */

  const monsoon = { step: 3, root: null };

  function renderMonsoon(el, width) {
    el.replaceChildren();
    const narrow = width < 560;
    const height = Math.round(Math.max(300, Math.min(520, innerHeight * (narrow ? 0.5 : 0.7))));
    const m = { top: 46, right: narrow ? 34 : 44, bottom: narrow ? 50 : 56, left: narrow ? 38 : 48 };
    const root = svg('svg', {
      viewBox: `0 0 ${width} ${height}`,
      class: 'monsoon',
      role: 'group',
      'aria-label': 'La pluie au Kerala : moyenne de chaque mois, puis pluie de chaque mousson de 1901 à 2017',
    }, el);
    monsoon.root = root;
    instantly(root, () => {
      root.dataset.step = String(monsoon.step);
    });
    const x0 = m.left;
    const x1 = width - m.right;
    const base = height - m.bottom;

    // Couche 1 : les douze mois
    const months = D.rain.months;
    const clim = D.rain.climatology;
    const yM = F.scaleLinear([0, 800], [base, m.top]);
    const gM = svg('g', { class: 'layer layer--months' }, root);
    yAxis(gM, yM, [0, 200, 400, 600, 800], x0, x1, (t) => fmt.num(t));
    const bandM = F.scaleBand(months, [x0, x1], { paddingInner: 0.3, paddingOuter: 0.12 });
    const bw = Math.min(30, bandM.bandwidth);
    months.forEach((name, i) => {
      const cx = bandM(name) + bandM.bandwidth / 2;
      const top = yM(clim[i]);
      svg('path', { class: `mbar${MONSOON_MONTHS.has(i) ? ' is-monsoon' : ''}`, d: columnPath(cx - bw / 2, top, bw, base - top, 3) }, gM);
      svg('text', { class: 'chart-label', x: cx, y: base + 20, 'text-anchor': 'middle', text: narrow ? name.slice(0, 1).toUpperCase() : name }, gM);
      const hit = svg('rect', { class: 'hit', x: bandM(name), y: m.top, width: bandM.bandwidth, height: base - m.top }, gM);
      F.hover(hit, () => ({
        title: name,
        rows: [
          { value: mmFmt(clim[i]), label: 'en moyenne (1901–2017)' },
          { value: pctFmt((clim[i] / D.rain.mean) * 100), label: 'de la pluie de l’année' },
        ],
      }), { label: `${name} : ${mmFmt(clim[i])} en moyenne` });
    });
    svg('line', { class: 'baseline', x1: x0, x2: x1, y1: base, y2: base }, gM);
    const jx = bandM(months[6]) + bandM.bandwidth / 2 + bw / 2 + 8;
    svg('text', { class: 'note note--july layer halo', x: jx, y: yM(clim[6]) + 4, text: `${fmt.num(clim[6])} mm en juillet` }, root);
    const bx0 = bandM(months[5]) + (bandM.bandwidth - bw) / 2;
    const bx1 = bandM(months[8]) + (bandM.bandwidth + bw) / 2;
    const by = yM(clim[6]) - 16;
    const bracket = svg('g', { class: 'note--bracket layer' }, root);
    svg('path', { class: 'leader', d: `M${bx0},${by + 7}V${by}H${bx1}V${by + 7}` }, bracket);
    svg('text', { class: 'note halo', x: (bx0 + bx1) / 2, y: by - 9, 'text-anchor': 'middle', text: `${Math.round(D.rain.jjasShare * 100)} % de la pluie de l’année` }, bracket);

    // Couche 2 : les 117 moussons
    const yY = F.scaleLinear([0, 3600], [base, m.top]);
    const gY = svg('g', { class: 'layer layer--years' }, root);
    yAxis(gY, yY, [0, 1000, 2000, 3000], x0, x1, (t) => fmt.num(t));
    const bandY = F.scaleBand(YEARS, [x0, x1], { paddingInner: 0.24, paddingOuter: 0.2 });
    const xY = (yr) => bandY(yr) + bandY.bandwidth / 2;
    const dry = new Set(D.rain.dry.years);
    YEARS.forEach((yr, i) => {
      const top = yY(D.rain.jjas[i]);
      const bar = svg('path', { class: `ybar${dry.has(yr) ? ' is-dry' : ''}`, d: columnPath(bandY(yr), top, bandY.bandwidth, base - top, 1.5) }, gY);
      bar.style.setProperty('--i', String(i));
    });
    svg('line', { class: 'baseline', x1: x0, x2: x1, y1: base, y2: base }, gY);
    yearTicks(gY, xY, narrow ? [1920, 1960, 2000] : [1910, 1930, 1950, 1970, 1990, 2010], base + 18);
    const yT = yY(D.rain.dry.threshold);
    svg('line', { class: 'threshold', x1: x0, x2: x1, y1: yT, y2: yT }, root);
    svg('text', { class: 'note note--soft note--dry', x: x1 + 5, y: yT, dy: '0.32em', text: '70 %' }, root);
    const dryMarks = svg('g', { class: 'note--dry layer' }, root);
    svg('text', { class: 'chart-label chart-label--ink', x: x0 - 8, y: base + 44, 'text-anchor': 'end', text: narrow ? 'Sèches' : 'Sèches :' }, dryMarks);
    for (const yr of D.rain.dry.years) {
      svg('line', { x1: xY(yr), x2: xY(yr), y1: base + 25, y2: base + 31, style: { stroke: 'var(--laterite)', strokeWidth: 2 } }, dryMarks);
      svg('text', { class: 'chart-label chart-label--ink', x: xY(yr), y: base + 44, 'text-anchor': 'middle', text: narrow ? `’${String(yr).slice(2)}` : String(yr) }, dryMarks);
    }

    // Tendance (dernière étape)
    const tr = D.rain.jjasTrend;
    const at = (yr, slope) => tr.intercept + tr.slope * 1959 + slope * (yr - 1959);
    const [ya, yb] = [YEARS[0], YEARS[YEARS.length - 1]];
    const band = [[ya, at(ya, tr.low)], [yb, at(yb, tr.low)], [yb, at(yb, tr.high)], [ya, at(ya, tr.high)]];
    svg('polygon', { class: 'trend-band', points: band.map(([a, b]) => `${xY(a)},${yY(b)}`).join(' ') }, root);
    const lx0 = xY(ya);
    const ly0 = yY(at(ya, tr.slope));
    const lx1 = xY(yb);
    const ly1 = yY(at(yb, tr.slope));
    const line = svg('line', { class: 'trend-line', x1: lx0, y1: ly0, x2: lx1, y2: ly1 }, root);
    line.style.setProperty('--len', String(Math.ceil(Math.hypot(lx1 - lx0, ly1 - ly0))));
    svg('text', {
      class: 'note note--trend halo',
      x: lx1,
      y: yY(3150),
      'text-anchor': 'end',
      text: `Tendance : ${fmt.signed(tr.slope * 10, 0)} mm par décennie`,
    }, root);

    crosshair(gY, root, {
      n: YEARS.length,
      xOf: (i) => xY(YEARS[i]),
      box: { x0, x1, y0: m.top, y1: base },
      label: 'Pluie de chaque mousson, une année à la fois (flèches gauche et droite)',
      content: (i) => ({
        title: `Mousson ${YEARS[i]}`,
        rows: [{ value: mmFmt(D.rain.jjas[i]), label: 'de juin à septembre' }, { value: pctFmt((D.rain.jjas[i] / D.rain.jjasMean) * 100), label: 'de la moyenne' }],
        note: dry.has(YEARS[i]) ? 'Mousson sèche' : undefined,
      }),
    });
  }

  function setMonsoonStep(k, instant = false) {
    monsoon.step = k;
    if (!monsoon.root) return;
    if (instant) instantly(monsoon.root, () => (monsoon.root.dataset.step = String(k)));
    else monsoon.root.dataset.step = String(k);
  }

  /* =======================================================================
     3. Août 2018 : la carte des districts, en trois états
     ======================================================================= */

  const FLOOD_STATES = [
    { key: 'departure', rampToken: '--rain-ramp', legend: 'Pluie d’août, écart à la normale', format: (v) => `${fmt.signed(v, 0)} %`, labels: ['Idukki', 'Thiruvananthapuram', 'Palakkad'] },
    { key: 'landslides', rampToken: '--toll-ramp', legend: 'Glissements de terrain', format: (v) => fmt.num(v), labels: ['Idukki', 'Wayanad', 'Malappuram'] },
    { key: 'fatalities', rampToken: '--toll-ramp', legend: 'Décès', format: (v) => fmt.num(v), labels: ['Thrissur', 'Ernakulam', 'Idukki', 'Alappuzha'] },
  ];
  const flood = { step: 2, root: null, el: null, paths: new Map(), labelGroups: [], legend: null, outline: null };

  function districtTip(d) {
    return {
      title: d.name,
      rows: [
        { value: mmFmt(d.actual), label: `de pluie (normale : ${fmt.num(d.normal)} mm)` },
        { value: `${fmt.signed(d.departure, 0)} %`, label: 'par rapport à la normale' },
        { value: fmt.num(d.landslides), label: 'glissements de terrain' },
        { value: fmt.num(d.fatalities), label: 'décès' },
        { value: fmt.num(d.houses), label: 'maisons détruites' },
      ],
    };
  }

  function renderFlood(el) {
    el.replaceChildren();
    flood.el = el;
    flood.paths.clear();
    const [W, H] = D.floods.viewBox;
    const LW = 190;
    const root = svg('svg', { viewBox: `0 0 ${W + LW} ${H}`, role: 'group', 'aria-label': 'Carte des quatorze districts du Kerala en août 2018' }, el);
    flood.root = root;
    const byName = new Map(D.floods.districts.map((d) => [d.name, d]));
    for (const d of D.floods.districts) {
      const path = svg('path', { class: 'district', d: d.path }, root);
      flood.paths.set(d.name, path);
      F.hover(path, () => districtTip(d), { label: d.name });
      path.addEventListener('pointerenter', () => outline(d.name));
      path.addEventListener('focus', () => outline(d.name));
      path.addEventListener('pointerleave', () => outline(null));
      path.addEventListener('blur', () => outline(null));
    }
    flood.outline = svg('path', { class: 'district-outline', visibility: 'hidden' }, root);
    function outline(name) {
      const d = name && byName.get(name);
      flood.outline.setAttribute('d', d ? d.path : '');
      flood.outline.setAttribute('visibility', d ? 'visible' : 'hidden');
    }

    // Étiquettes de chaque état, reliées au district par un trait
    flood.labelGroups = FLOOD_STATES.map((st) => {
      const g = svg('g', { class: 'map-label is-off' }, root);
      const items = st.labels.map((name) => byName.get(name)).sort((a, b) => a.cy - b.cy);
      let previous = -Infinity;
      for (const d of items) {
        const ly = Math.max(d.cy, previous + 34);
        previous = ly;
        svg('path', { class: 'leader', d: `M${d.cx},${d.cy}L${W + 6},${ly}H${W + 14}` }, g);
        svg('text', { class: 'note', x: W + 18, y: ly - 3, text: d.name }, g);
        svg('text', { class: 'note note--soft', x: W + 18, y: ly + 13, text: st.format(d[st.key]) }, g);
      }
      return g;
    });

    // Légende dans la mer d'Arabie
    const lg = svg('g', {}, root);
    const grad = svg('linearGradient', { id: 'flood-gradient' }, svg('defs', {}, root));
    const legendTitle = svg('text', { class: 'note note--soft', x: 4, y: H - 52 }, lg);
    svg('rect', { x: 4, y: H - 42, width: 120, height: 8, rx: 1, fill: 'url(#flood-gradient)' }, lg);
    const lo = svg('text', { class: 'chart-label', x: 4, y: H - 18 }, lg);
    const hi = svg('text', { class: 'chart-label', x: 124, y: H - 18, 'text-anchor': 'end' }, lg);
    flood.legend = { grad, legendTitle, lo, hi };

    applyFlood(flood.step, { instant: true });
  }

  function applyFlood(k, { instant = false, dry = false } = {}) {
    flood.step = k;
    if (!flood.root) return;
    const st = FLOOD_STATES[k];
    const colorAt = ramp(st.rampToken, flood.el);
    const values = D.floods.districts.map((d) => d[st.key]);
    const max = Math.max(...values);
    const order = [...D.floods.districts].sort((a, b) => a[st.key] - b[st.key]);
    const change = () => {
      order.forEach((d, rank) => {
        const path = flood.paths.get(d.name);
        path.style.transitionDelay = instant ? '0ms' : `${rank * 85}ms`;
        path.style.fill = dry ? colorAt(0) : colorAt(d[st.key] / max);
      });
      flood.labelGroups.forEach((g, i) => g.classList.toggle('is-off', dry || i !== k));
      const { grad, legendTitle, lo, hi } = flood.legend;
      grad.replaceChildren();
      for (let s = 0; s <= 10; s++) svg('stop', { offset: `${s * 10}%`, 'stop-color': colorAt(s / 10) }, grad);
      legendTitle.textContent = st.legend;
      lo.textContent = st.format(0);
      hi.textContent = st.format(max);
    };
    if (instant) instantly(flood.root, change);
    else change();
  }

  /* =======================================================================
     4. Le mois d'août depuis 1901 (barres qui montent)
     ======================================================================= */

  function renderAugust(el, width) {
    const narrow = width < 560;
    const height = Math.round(Math.min(340, Math.max(240, width * 0.36)));
    const m = { top: 40, right: narrow ? 6 : 12, bottom: 28, left: narrow ? 38 : 46 };
    const root = chart(el, width, height, 'Pluie du mois d’août au Kerala de 1901 à 2018', 'august');
    const years = [...YEARS, 2018];
    const values = [...D.aug2018.augustHistory, D.aug2018.imd.AUG.actual];
    const top3 = new Map(D.aug2018.augustTop);
    const band = F.scaleBand(years, [m.left, width - m.right], { paddingInner: 0.22, paddingOuter: 0.2 });
    const xOf = (yr) => band(yr) + band.bandwidth / 2;
    const y = F.scaleLinear([0, 1300], [height - m.bottom, m.top]);
    yAxis(root, y, [0, 400, 800, 1200], m.left, width - m.right, (t) => fmt.num(t));
    const fillOf = (yr) => (yr === 2018 ? 'var(--laterite)' : top3.has(yr) ? 'var(--ink-2)' : 'var(--context)');
    years.forEach((yr, i) => {
      const top = y(values[i]);
      const bar = svg('path', { class: 'grow', d: columnPath(band(yr), top, band.bandwidth, y(0) - top, 1.5), style: { fill: fillOf(yr) } }, root);
      bar.style.setProperty('--i', String(i));
    });
    svg('line', { class: 'baseline', x1: m.left, x2: width - m.right, y1: y(0), y2: y(0) }, root);
    yearTicks(root, xOf, narrow ? [1920, 1960, 2000] : [1910, 1930, 1950, 1970, 1990, 2010], height - 8);
    svg('text', { class: 'note halo', x: xOf(1931) + 8, y: y(1199.2) + 4, text: `1931 · ${fmt.num(1199)} mm` }, root);
    for (const yr of [1907, 1923]) svg('text', { class: 'note note--soft halo', x: xOf(yr), y: y(top3.get(yr)) - 7, 'text-anchor': 'middle', text: String(yr) }, root);
    svg('text', {
      class: 'note halo',
      x: xOf(2018),
      y: y(values[values.length - 1]) - 10,
      'text-anchor': 'end',
      text: `2018 · ${fmt.num(values[values.length - 1])} mm, ${D.aug2018.augustRank}\u1d49 mois d\u2019août`,
    }, root);
    crosshair(root, root, {
      n: years.length,
      xOf: (i) => xOf(years[i]),
      box: { x0: m.left, x1: width - m.right, y0: m.top, y1: height - m.bottom },
      label: 'Pluie du mois d’août, une année à la fois',
      content: (i) => ({
        title: `Août ${years[i]}`,
        rows: [{ value: mmFmt(values[i]), label: 'sur l’ensemble de l’État' }],
        note: years[i] === 2018 ? 'Chiffre du rapport de l’IMD' : undefined,
      }),
    });
  }

  /* =======================================================================
     5. Bandes de réchauffement (pleine largeur, peintes de gauche à droite)
     ======================================================================= */

  function renderStripes(el, width) {
    const narrow = width < 560;
    const height = narrow ? 150 : 230;
    const label = 26;
    const root = chart(el, width, height, 'Bandes de réchauffement : écart annuel à la température moyenne de l’Inde, 1901–2017', 'stripes-chart');
    const T = D.temperature;
    const anomalies = T.annual.map((v) => v - T.mean);
    const limit = Math.max(...anomalies.map(Math.abs));
    const diverging = ramp('--diverging-ramp', el);
    const w = width / T.years.length;
    T.years.forEach((yr, i) => {
      const r = svg('rect', { class: 'stripe', x: i * w, y: 0, width: w + 0.6, height: height - label, fill: diverging(0.5 + anomalies[i] / (2 * limit)) }, root);
      r.style.setProperty('--i', String(i));
    });
    const pad = Math.max(16, (width - 1180) / 2);
    svg('text', { class: 'chart-label chart-label--ink', x: pad, y: height - 8, text: '1901' }, root);
    svg('text', { class: 'chart-label chart-label--ink', x: width - pad, y: height - 8, 'text-anchor': 'end', text: '2017' }, root);
    svg('text', { class: 'chart-label', x: width / 2, y: height - 8, 'text-anchor': 'middle', text: `${fmt.num(T.mean, 1)} °C en moyenne` }, root);
    crosshair(root, root, {
      n: T.years.length,
      xOf: (i) => i * w + w / 2,
      box: { x0: 0, x1: width, y0: 0, y1: height - label },
      label: 'Température de l’Inde, une année à la fois',
      content: (i) => ({
        title: String(T.years[i]),
        rows: [
          { value: fmt.unit(T.annual[i], '°C', 2), label: 'température de l’année' },
          { value: `${fmt.signed(anomalies[i], 2)} °C`, label: 'par rapport à la moyenne' },
        ],
      }),
    });
  }

  /* =======================================================================
     6. Occupation du sol : 483 carrés d'un kilomètre carré
     ======================================================================= */

  const LAND_GROUPS = [
    { label: 'Rizières', token: '--paddy', key: true, rows: ['Rizières'] },
    { label: 'Hévéa (caoutchouc)', token: '--rubber', key: true, rows: ['Hévéa (caoutchouc)'] },
    { label: 'Zones bâties', token: '--built', key: true, rows: ['Zones bâties'] },
    { label: 'Jardins arborés et cocoteraies', token: '--gardens', rows: ['Cultures mixtes (jardins arborés)', 'Cocoteraies', 'Bananeraies', 'Cultures maraîchères'] },
    { label: 'Forêt', token: '--forest', rows: ['Forêt sempervirente', 'Forêt dense mixte', 'Forêt claire', "Plantations d'eucalyptus"] },
    { label: 'Eau', token: '--water', rows: ['Rivières', 'Étangs et réservoirs villageois', 'Barrages-réservoirs'] },
    { label: 'Broussailles, rochers, sables', token: '--other', rows: ['Broussailles', 'Terrains rocheux', 'Sablières et friches industrielles', 'Marais'] },
  ];
  const CELLS = 483;
  const COLS = 23;
  const land = { year: 2, cells: [], legend: [], buttons: [], timers: [], root: null };

  /** Surface de chaque groupe (km²) et nombre de carrés, au plus fort reste, pour une année. */
  function landCounts(yearIndex) {
    const byLabel = new Map(D.landUse.rows.map((r) => [r.label, r.values[yearIndex] || 0]));
    const km2 = LAND_GROUPS.map((g) => g.rows.reduce((sum, label) => sum + (byLabel.get(label) || 0), 0));
    const total = km2.reduce((a, b) => a + b, 0);
    const exact = km2.map((v) => (v / total) * CELLS);
    const counts = exact.map(Math.floor);
    let left = CELLS - counts.reduce((a, b) => a + b, 0);
    exact
      .map((v, i) => [v - Math.floor(v), i])
      .sort((a, b) => b[0] - a[0])
      .forEach(([, i]) => {
        if (left > 0) {
          counts[i] += 1;
          left -= 1;
        }
      });
    return { km2, counts };
  }

  function renderLandUse(el, width) {
    el.replaceChildren();
    const side = width >= 760;
    const plot = html('div', { class: 'waffle__plot' }, el);
    const legend = html('ul', { class: 'waffle__legend' }, el);
    const avail = side ? Math.min(560, width - 300) : width;
    const cell = Math.max(8, Math.min(24, Math.floor((avail + 3) / COLS)));
    const gap = cell >= 14 ? 3 : 2;
    const rows = Math.ceil(CELLS / COLS);
    const W = COLS * cell - gap;
    const H = rows * cell - gap;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Occupation du sol du bassin de la Neyyar, un carré par kilomètre carré' }, plot);
    land.root = root;
    land.cells = [];
    for (let i = 0; i < CELLS; i++) {
      const c = svg('rect', { class: 'cell', x: (i % COLS) * cell, y: Math.floor(i / COLS) * cell, width: cell - gap, height: cell - gap, rx: 1.5 }, root);
      c.style.setProperty('--i', String(i));
      land.cells.push(c);
    }
    land.legend = LAND_GROUPS.map((g) => {
      const li = html('li', { class: g.key ? 'is-key' : null }, legend);
      html('span', { class: 'waffle__swatch', style: { background: `var(${g.token})` } }, li);
      html('span', { text: g.label }, li);
      return html('span', { class: 'waffle__value' }, li);
    });
    root.addEventListener('pointermove', (e) => {
      const p = toLocal(root, e);
      const i = Math.floor(p.y / cell) * COLS + Math.floor(p.x / cell);
      if (i < 0 || i >= CELLS || p.x < 0 || p.x > W) return F.tip.hide();
      const g = land.assignment[i];
      const { km2 } = landCounts(land.year);
      F.tip.show(e, { title: `${LAND_GROUPS[g].label}, ${D.landUse.years[land.year]}`, rows: [{ value: `${fmt.num(km2[g], 1)} km²`, label: 'dans le bassin' }] });
    });
    root.addEventListener('pointerleave', () => F.tip.hide());
    applyYear(land.year, true);
  }

  function applyYear(k, instant = false) {
    land.year = k;
    const { km2, counts } = landCounts(k);
    land.assignment = [];
    counts.forEach((count, g) => {
      for (let j = 0; j < count; j++) land.assignment.push(g);
    });
    const change = () => {
      land.cells.forEach((c, i) => {
        c.style.fill = `var(${LAND_GROUPS[land.assignment[i]].token})`;
      });
    };
    if (land.root && instant) instantly(land.root, change);
    else if (land.root) change();
    land.legend.forEach((span, g) => {
      span.textContent = `${fmt.num(km2[g], km2[g] < 20 ? 1 : 0)} km²`;
    });
    land.buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === k)));
  }

  function setupYears() {
    const holder = document.getElementById('landuse-years');
    if (!holder) return;
    land.buttons = D.landUse.years.map((yr, i) => {
      const b = html('button', { type: 'button', 'aria-pressed': String(i === land.year), text: String(yr) }, holder);
      b.addEventListener('click', () => {
        land.timers.forEach(clearTimeout);
        applyYear(i);
      });
      return b;
    });
  }

  /* =======================================================================
     Détails : variabilité, répartition des mois, saisons
     ======================================================================= */

  function renderCv(el, width) {
    const height = 260;
    const m = { top: 14, right: 104, bottom: 26, left: 42 };
    const root = chart(el, width, height, 'Coefficient de variation sur 30 ans');
    const cv = D.rain.variability.rollingCv;
    const x = F.scaleLinear([1901, 2017], [m.left, width - m.right]);
    const y = F.scaleLinear([0.12, 0.23], [height - m.bottom, m.top]);
    yAxis(root, y, [0.12, 0.15, 0.18, 0.21], m.left, width - m.right, (t) => fmt.num(t, 2));
    yearTicks(root, x, [1920, 1960, 2000], height - 6);
    for (const [key, label, token] of [['annual', 'Année entière', '--context'], ['jjas', 'Mousson', '--rain']]) {
      const d = cv.years.map((yr, i) => `${i ? 'L' : 'M'}${x(yr).toFixed(1)},${y(cv[key][i]).toFixed(1)}`).join('');
      svg('path', { class: 'series-line', d, style: { stroke: `var(${token})`, fill: 'none', strokeWidth: 2 } }, root);
      const last = cv[key][cv[key].length - 1];
      svg('text', { class: 'chart-label chart-label--ink', x: x(cv.years[cv.years.length - 1]) + 8, y: y(last), dy: '0.32em', text: label }, root);
    }
    crosshair(root, root, {
      n: cv.years.length,
      xOf: (i) => x(cv.years[i]),
      box: { x0: m.left, x1: width - m.right, y0: m.top, y1: height - m.bottom },
      label: 'Variabilité sur 30 ans',
      content: (i) => ({
        title: `${cv.years[i] - 15}–${cv.years[i] + 14}`,
        rows: [
          { value: fmt.num(cv.jjas[i], 3), label: 'mousson' },
          { value: fmt.num(cv.annual[i], 3), label: 'année entière' },
        ],
      }),
    });
  }

  function renderShares(el, width) {
    const rowH = 24;
    const m = { top: 26, right: 52, bottom: 24, left: 50 };
    const height = m.top + rowH * 12 + m.bottom;
    const root = chart(el, width, height, 'Part de chaque mois dans la pluie de l’année');
    const { early, late, p, periods } = D.rain.shares;
    const x = F.scaleLinear([0, 0.26], [m.left, width - m.right]);
    const grid = svg('g', { class: 'grid' }, root);
    const axis = svg('g', { class: 'axis' }, root);
    for (const t of [0, 0.1, 0.2]) {
      svg('line', { x1: x(t), x2: x(t), y1: m.top - 4, y2: height - m.bottom }, grid);
      svg('text', { x: x(t), y: height - 6, 'text-anchor': 'middle', text: fmt.pct(t) }, axis);
    }
    svg('text', { class: 'chart-label', x: width - 2, y: 10, 'text-anchor': 'end', text: 'p' }, root);
    svg('circle', { cx: m.left + 4, cy: 8, r: 4, style: { fill: 'var(--context)' } }, root);
    svg('text', { class: 'chart-label chart-label--ink', x: m.left + 12, y: 8, dy: '0.32em', text: periods[0] }, root);
    svg('circle', { cx: m.left + 104, cy: 8, r: 4, style: { fill: 'var(--rain)' } }, root);
    svg('text', { class: 'chart-label chart-label--ink', x: m.left + 112, y: 8, dy: '0.32em', text: periods[1] }, root);
    D.rain.months.forEach((name, i) => {
      const cy = m.top + rowH * i + rowH / 2;
      svg('text', { class: 'chart-label chart-label--ink', x: m.left - 8, y: cy, dy: '0.32em', 'text-anchor': 'end', text: name }, root);
      svg('line', { x1: x(early[i]), x2: x(late[i]), y1: cy, y2: cy, style: { stroke: 'var(--line)', strokeWidth: 3 } }, root);
      svg('circle', { cx: x(early[i]), cy, r: 4.5, style: { fill: 'var(--context)' } }, root);
      svg('circle', { cx: x(late[i]), cy, r: 4.5, style: { fill: 'var(--rain)' } }, root);
      svg('text', { class: 'chart-label', x: width - 2, y: cy, dy: '0.32em', 'text-anchor': 'end', text: fmt.num(p[i], 2) }, root);
    });
  }

  function renderSeasons(el, width) {
    const T = D.temperature;
    const rows = [
      { label: 'Année entière', v: T.trend.slope * 100, low: T.trend.low * 100, high: T.trend.high * 100 },
      ...T.seasons.map((s) => ({ label: s.label, v: s.perCentury, low: s.low, high: s.high })),
    ];
    const rowH = 30;
    const m = { top: 4, right: 64, bottom: 24, left: 104 };
    const height = m.top + rowH * rows.length + m.bottom;
    const root = chart(el, width, height, 'Réchauffement par saison');
    const x = F.scaleLinear([0, 2.1], [m.left, width - m.right]);
    const warm = ramp('--diverging-ramp', el)(0.86);
    const axis = svg('g', { class: 'axis' }, root);
    for (const t of [0, 1, 2]) svg('text', { x: x(t), y: height - 6, 'text-anchor': 'middle', text: `${fmt.num(t)} °C` }, axis);
    rows.forEach((r, i) => {
      const cy = m.top + i * rowH + rowH / 2;
      svg('text', { class: 'chart-label chart-label--ink', x: m.left - 8, y: cy, dy: '0.32em', 'text-anchor': 'end', text: r.label }, root);
      svg('path', { d: barPath(m.left, cy - 7, x(r.v) - m.left, 14), fill: warm }, root);
      svg('line', { x1: x(r.low), x2: x(r.high), y1: cy, y2: cy, style: { stroke: 'var(--ink)', strokeWidth: 1.5 } }, root);
      svg('text', { class: 'chart-label chart-label--ink', x: x(r.high) + 6, y: cy, dy: '0.32em', text: `${fmt.signed(r.v, 1)} °C` }, root);
    });
  }

  /* =======================================================================
     Vues tableau, navigation et montage
     ======================================================================= */

  function addTables() {
    const months = D.rain.months;
    tableAfter(document.querySelector('#fig-clock .clock__caption'), {
      summary: 'Voir les données du cadran',
      caption: 'Pluie mensuelle au Kerala, 1901–2017 (mm)',
      columns: [{ key: 'year', label: 'Année' }, ...months.map((name, m) => ({ key: `m${m}`, label: name, num: true, format: (v) => fmt.num(v, 1) }))],
      rows: YEARS.map((year, i) => Object.fromEntries([['year', year], ...months.map((_, m) => [`m${m}`, D.rain.monthly[i][m]])])),
    });
    tableAfter(document.getElementById('source-monsoon'), {
      caption: 'Pluie de la mousson (juin–septembre)',
      columns: [
        { key: 'year', label: 'Année' },
        { key: 'value', label: 'Juin–sept. (mm)', num: true, format: (v) => fmt.num(v, 1) },
        { key: 'dry', label: 'Mousson sèche' },
      ],
      rows: YEARS.map((year, i) => ({ year, value: D.rain.jjas[i], dry: D.rain.dry.years.includes(year) ? 'oui' : '' })),
    });
    tableAfter(document.querySelector('#aout-2018 .scrolly + .source'), {
      caption: 'Inondations d’août 2018 par district',
      columns: [
        { key: 'name', label: 'District' },
        { key: 'actual', label: 'Pluie (mm)', num: true, format: (v) => fmt.num(v, 1) },
        { key: 'departure', label: 'Écart', num: true, format: (v) => `${fmt.signed(v, 0)} %` },
        { key: 'landslides', label: 'Glissements', num: true },
        { key: 'fatalities', label: 'Décès', num: true },
        { key: 'houses', label: 'Maisons détruites', num: true },
      ],
      rows: D.floods.districts,
    });
    tableAfter(document.querySelector('#fig-august figcaption'), {
      caption: 'Pluie du mois d’août',
      columns: [{ key: 'year', label: 'Année' }, { key: 'value', label: 'Août (mm)', num: true, format: (v) => fmt.num(v, 1) }],
      rows: [...YEARS.map((year, i) => ({ year, value: D.aug2018.augustHistory[i] })), { year: '2018 (IMD)', value: D.aug2018.imd.AUG.actual }],
    });
    const T = D.temperature;
    tableAfter(document.querySelector('#chaleur .source'), {
      caption: 'Température annuelle de l’Inde',
      columns: [
        { key: 'year', label: 'Année' },
        { key: 'value', label: '°C', num: true, format: (v) => fmt.num(v, 2) },
        { key: 'gap', label: 'Écart (°C)', num: true, format: (v) => fmt.signed(v, 2) },
      ],
      rows: T.years.map((year, i) => ({ year, value: T.annual[i], gap: T.annual[i] - T.mean })),
    });
    tableAfter(document.querySelector('#fig-landuse figcaption'), {
      caption: 'Occupation du sol du bassin de la Neyyar (km²)',
      columns: [{ key: 'label', label: 'Classe' }, ...D.landUse.years.map((yr, i) => ({ key: `y${i}`, label: String(yr), num: true, format: (v) => (v === null ? 'non relevé' : fmt.num(v, 2)) }))],
      rows: D.landUse.rows.map((r) => ({ label: r.label, y0: r.values[0], y1: r.values[1], y2: r.values[2] })),
    });
  }

  function setupScrollSpy() {
    const links = [...document.querySelectorAll('.sitenav a')];
    const targets = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
    if (!('IntersectionObserver' in window) || !targets.length) return;
    const visible = new Map();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        const active = targets.find((t) => visible.get(t.id));
        for (const a of links) {
          if (active && a.getAttribute('href') === `#${active.id}`) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        }
      },
      { rootMargin: '-45% 0px -50% 0px' }
    );
    targets.forEach((t) => io.observe(t));
  }

  function setupMotion() {
    // Récit de la mousson : à l'approche, retour au premier état ; puis une étape à la fois
    const monsoonSteps = document.getElementById('scrolly-monsoon');
    if (monsoonSteps) {
      scrollSteps(monsoonSteps, (k) => setMonsoonStep(k));
      reveal(monsoonSteps, { reset: () => setMonsoonStep(0, true), play: () => {}, threshold: 0 });
    }
    // Août 2018 : les districts se remplissent l'un après l'autre
    const floodSteps = document.getElementById('scrolly-flood');
    if (floodSteps) {
      scrollSteps(floodSteps, (k) => applyFlood(k));
      reveal(floodSteps, { reset: () => applyFlood(0, { instant: true, dry: true }), play: () => {}, threshold: 0 });
    }
    // Barres d'août qui montent, bandes peintes, sols qui changent
    const august = document.getElementById('august');
    reveal(august, { reset: () => august.firstElementChild && august.firstElementChild.classList.add('is-reset'), play: () => august.firstElementChild && august.firstElementChild.classList.remove('is-reset') });
    const stripes = document.getElementById('stripes');
    reveal(stripes, { reset: () => stripes.firstElementChild && stripes.firstElementChild.classList.add('is-reset'), play: () => stripes.firstElementChild && stripes.firstElementChild.classList.remove('is-reset') });
    reveal(document.getElementById('landuse'), {
      reset: () => applyYear(0, true),
      play: () => {
        land.timers = [setTimeout(() => applyYear(1), 1300), setTimeout(() => applyYear(2), 3000)];
      },
    });
  }

  mount('clock', renderClock);
  mount('monsoon', renderMonsoon);
  mount('map', renderFlood);
  mount('august', renderAugust);
  mount('stripes', renderStripes);
  mount('landuse', renderLandUse);
  mount('cv', renderCv);
  mount('shares', renderShares);
  mount('seasons', renderSeasons);
  setupYears();
  addTables();
  setupScrollSpy();
  setupMotion();
})();
