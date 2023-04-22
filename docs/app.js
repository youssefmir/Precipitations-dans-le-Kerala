/* ==========================================================================
   Mousson du Kerala — graphiques interactifs
   Données : window.SITE_DATA (docs/data.js, généré par scripts/build_site_data.py).
   Outils communs : window.Frame (frame.js). Aucune autre dépendance.
   ========================================================================== */
(function () {
  'use strict';

  const D = window.SITE_DATA;
  const F = window.Frame;
  const { fmt, svg, html } = F;

  /* ---------- Couleurs ---------- */

  function hexToRgb(hex) {
    const h = hex.trim().replace('#', '');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /** Rampe déclarée dans un token CSS (liste de couleurs) → fonction t ∈ [0, 1] → couleur. */
  function ramp(token) {
    const stops = F.cssVar(token).split(',').map(hexToRgb);
    const colorAt = (t) => {
      const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(x));
      const f = x - i;
      const rgb = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
      return `rgb(${rgb.join(', ')})`;
    };
    colorAt.stops = stops;
    return colorAt;
  }

  const color = (token) => F.cssVar(token);

  /* ---------- Montage : rendu initial, redimensionnement, thème ---------- */

  const renderers = [];
  function mount(id, render) {
    const el = document.getElementById(id);
    if (!el) return null;
    const run = () => {
      if (el.clientWidth > 0) render(el, el.clientWidth);
    };
    renderers.push(run);
    F.onResize(el, run);
    return el;
  }
  F.onTheme(() => renderers.forEach((run) => run()));

  /* ---------- Outils de dessin ---------- */

  const isNarrow = (width) => width < 560;

  /** Crée le SVG d'un graphique à l'échelle 1:1 (unités = pixels). */
  function chart(el, width, height, label) {
    el.replaceChildren();
    return svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': label }, el);
  }

  /** Barre verticale arrondie en haut, carrée à la base. */
  function columnPath(x, y, w, h, r = 2) {
    const rr = Math.max(0, Math.min(r, w / 2, h));
    return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
  }

  /** Barre horizontale arrondie à droite, carrée à la base. */
  function barPath(x, y, w, h, r = 4) {
    const rr = Math.max(0, Math.min(r, h / 2, w));
    return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
  }

  /** Grille horizontale et graduations de l'axe des ordonnées. */
  function yAxis(root, y, ticks, x0, x1, format) {
    const grid = svg('g', { class: 'grid' }, root);
    const axis = svg('g', { class: 'axis' }, root);
    for (const t of ticks) {
      svg('line', { x1: x0, x2: x1, y1: y(t), y2: y(t) }, grid);
      svg('text', { x: x0 - 8, y: y(t), dy: '0.32em', 'text-anchor': 'end', text: format(t) }, axis);
    }
  }

  /** Graduations d'années sous l'axe des abscisses. */
  function yearTicks(root, xOf, years, y) {
    const axis = svg('g', { class: 'axis' }, root);
    for (const year of years) {
      svg('text', { x: xOf(year), y, 'text-anchor': 'middle', text: String(year) }, axis);
    }
  }

  /** Convertit un événement pointeur en coordonnées du SVG. */
  function toLocal(root, evt) {
    const p = root.createSVGPoint();
    p.x = evt.clientX;
    p.y = evt.clientY;
    return p.matrixTransform(root.getScreenCTM().inverse());
  }

  /**
   * Couche de survol par position horizontale : réticule, infobulle, clavier (← →).
   * xOf(i) donne l'abscisse du i-ème point, content(i) le contenu de l'infobulle.
   */
  function crosshair(root, { n, xOf, box, content, label, start = n - 1 }) {
    const line = svg('line', { class: 'crosshair', y1: box.y0, y2: box.y1, visibility: 'hidden' }, root);
    const hit = svg('rect', {
      class: 'hit',
      x: box.x0,
      y: box.y0,
      width: box.x1 - box.x0,
      height: box.y1 - box.y0,
      tabindex: 0,
      'aria-label': label,
    }, root);
    let current = -1;
    const nearest = (px) => {
      let best = 0;
      for (let i = 1; i < n; i++) if (Math.abs(xOf(i) - px) < Math.abs(xOf(best) - px)) best = i;
      return best;
    };
    const show = (i, anchor) => {
      current = i;
      const x = xOf(i);
      line.setAttribute('x1', x);
      line.setAttribute('x2', x);
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

  /** Étiquettes d'années placées au-dessus des barres voisines, reliées par un trait si besoin. */
  function labelColumns(root, items, { xOf, y, values, years, window = 2 }) {
    const g = svg('g', {}, root);
    let previous = null; // dernière étiquette posée : on relève la suivante si elles se touchent
    for (const year of [...items].sort((a, b) => a - b)) {
      const i = years.indexOf(year);
      const value = values[i];
      let peak = value;
      for (let j = Math.max(0, i - window); j <= Math.min(values.length - 1, i + window); j++) peak = Math.max(peak, values[j]);
      let labelY = y(peak) - 8;
      if (previous && xOf(year) - previous.x < 34 && Math.abs(labelY - previous.y) < 13) labelY = previous.y - 13;
      previous = { x: xOf(year), y: labelY };
      if (y(value) - labelY > 14) svg('line', { class: 'leader', x1: xOf(year), x2: xOf(year), y1: y(value) - 2, y2: labelY + 3 }, g);
      svg('text', { class: 'chart-label chart-label--ink', x: xOf(year), y: labelY, 'text-anchor': 'middle', text: String(year) }, g);
    }
  }

  /** Droite de tendance et sa bande d'incertitude (pivot à l'année médiane). */
  function trendShape(root, trend, years, x, y) {
    const first = years[0];
    const last = years[years.length - 1];
    const pivot = (first + last) / 2;
    const level = trend.intercept + trend.slope * pivot;
    const at = (year, slope) => level + slope * (year - pivot);
    const band = [
      [first, at(first, trend.low)],
      [last, at(last, trend.low)],
      [last, at(last, trend.high)],
      [first, at(first, trend.high)],
    ];
    svg('polygon', { class: 'trend-band', points: band.map(([a, b]) => `${x(a)},${y(b)}`).join(' ') }, root);
    svg('line', { class: 'trend-line', x1: x(first), x2: x(last), y1: y(at(first, trend.slope)), y2: y(at(last, trend.slope)) }, root);
    return { endY: y(at(last, trend.slope)), endX: x(last) };
  }

  /* ---------- Vue tableau : ajoutée une seule fois sous chaque figure ---------- */

  function addTable(figureId, options) {
    const fig = document.getElementById(figureId);
    if (fig) F.dataTable(fig, options);
  }

  const YEARS = D.rain.years;
  const mmFmt = (v) => fmt.unit(v, 'mm');
  const pctFmt = (v, d = 0) => `${fmt.num(v, d)} %`;

  /* =======================================================================
     1. Le cadran de la mousson (en-tête)
     ======================================================================= */

  let clockAnimated = false;

  function renderClock(el, size) {
    el.replaceChildren();
    const S = 700;
    const C = S / 2;
    const R0 = 96;
    const R1 = 286;
    const k = S / size; // pixels → unités du dessin (textes lisibles à toute taille)
    const n = YEARS.length;
    const ringW = (R1 - R0) / n;
    const GAP = 12;
    const SECTOR = (360 - GAP) / 12;
    const MONTH_GAP = 0.9;
    const VMAX = 1550;
    const rain = ramp('--rain-ramp');
    const tOf = (v) => Math.sqrt(Math.max(0, v) / VMAX);
    const rad = (deg) => (deg * Math.PI) / 180;
    const pt = (r, deg) => [C + r * Math.sin(rad(deg)), C - r * Math.cos(rad(deg))];
    const monthStart = (m) => GAP / 2 + m * SECTOR + MONTH_GAP / 2;
    const monthEnd = (m) => monthStart(m) + SECTOR - MONTH_GAP;
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
    const animate = !clockAnimated && !F.reducedMotion;
    for (let i = 0; i < n; i++) {
      const ra = R0 + i * ringW;
      const rb = i === n - 1 ? R1 : ra + ringW + 0.6;
      for (let m = 0; m < 12; m++) {
        const cell = svg('path', { d: sector(ra, rb, monthStart(m), monthEnd(m)), fill: rain(tOf(D.rain.monthly[i][m])) }, cells);
        if (animate) cell.style.animationDelay = `${i * 9}ms`;
      }
    }
    if (animate) {
      cells.classList.add('is-animated');
      clockAnimated = true;
    }

    // Mois autour du cadran ; la mousson du sud-ouest en gras
    const labels = svg('g', {}, root);
    D.rain.months.forEach((name, m) => {
      const angle = (monthStart(m) + monthEnd(m)) / 2;
      const [x, y] = pt(R1 + 16, angle);
      const side = Math.sin(rad(angle));
      svg('text', {
        class: `clock-month${m >= 5 && m <= 8 ? ' clock-month--monsoon' : ''}`,
        x,
        y,
        'text-anchor': side > 0.35 ? 'start' : side < -0.35 ? 'end' : 'middle',
        dy: '0.35em',
        style: { fontSize: `${13 * Math.min(k, 1.7)}px` },
        text: name,
      }, labels);
    });

    // Repères d'années dans l'interstice du haut
    const yearsAxis = svg('g', {}, root);
    for (const year of [1901, 1950, 2000]) {
      const i = YEARS.indexOf(year);
      svg('text', {
        class: 'clock-year',
        x: C,
        y: C - (R0 + (i + 0.5) * ringW),
        'text-anchor': 'middle',
        dy: '0.35em',
        style: { fontSize: `${11 * Math.min(k, 1.7)}px` },
        text: String(year),
      }, yearsAxis);
    }

    // Lecture au centre
    const centre = svg('g', { 'text-anchor': 'middle' }, root);
    const big = svg('text', { class: 'clock-centre__year', x: C, y: C - 6, style: { fontSize: `${38 * Math.min(k, 1.4)}px` }, text: '117' }, centre);
    const line1 = svg('text', { class: 'clock-centre__label', x: C, y: C + 20, style: { fontSize: `${12.5 * Math.min(k, 1.6)}px` }, text: 'ans de mousson' }, centre);
    const line2 = svg('text', { class: 'clock-centre__value', x: C, y: C + 42, style: { fontSize: `${14 * Math.min(k, 1.6)}px` }, text: '1901 → 2017' }, centre);

    const ring = svg('circle', { class: 'clock-ring', cx: C, cy: C, r: 0, visibility: 'hidden' }, root);
    const focus = svg('path', { class: 'clock-focus', visibility: 'hidden' }, root);
    const means = D.rain.climatology;
    let current = null;

    const select = (i, m, anchor) => {
      current = [i, m];
      const value = D.rain.monthly[i][m];
      const ra = R0 + i * ringW;
      focus.setAttribute('d', sector(ra, ra + ringW, monthStart(m), monthEnd(m)));
      focus.setAttribute('visibility', 'visible');
      ring.setAttribute('r', ra + ringW / 2);
      ring.setAttribute('visibility', 'visible');
      big.textContent = String(YEARS[i]);
      line1.textContent = D.rain.months[m];
      line2.textContent = mmFmt(value);
      F.tip.show(anchor || focus, {
        title: `${D.rain.months[m]} ${YEARS[i]}`,
        rows: [
          { value: mmFmt(value), label: 'de pluie' },
          { value: `${fmt.num(value / means[m], 1)} ×`, label: 'la moyenne de ce mois' },
        ],
      });
    };
    const reset = () => {
      current = null;
      focus.setAttribute('visibility', 'hidden');
      ring.setAttribute('visibility', 'hidden');
      big.textContent = '117';
      line1.textContent = 'ans de mousson';
      line2.textContent = '1901 → 2017';
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
      const [di, dm] = moves[e.key];
      select(Math.max(0, Math.min(n - 1, i + di)), (m + dm + 12) % 12);
    });

    renderRampLegend(document.getElementById('clock-ramp'), rain, VMAX);
  }

  /** Légende de la rampe du cadran (échelle en racine carrée, graduée en mm). */
  function renderRampLegend(el, rain, vmax) {
    if (!el) return;
    el.replaceChildren();
    const W = 320;
    const H = 30;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', 'aria-hidden': 'true' }, el);
    const grad = svg('linearGradient', { id: 'clock-gradient' }, svg('defs', {}, root));
    for (let s = 0; s <= 20; s++) svg('stop', { offset: `${s * 5}%`, 'stop-color': rain(s / 20) }, grad);
    svg('rect', { x: 0, y: 0, width: W, height: 9, rx: 4.5, fill: 'url(#clock-gradient)' }, root);
    const axis = svg('g', { class: 'axis' }, root);
    for (const v of [0, 100, 400, 900, 1500]) {
      const x = Math.sqrt(v / vmax) * W;
      svg('text', {
        x: Math.min(W - 2, Math.max(2, x)),
        y: 25,
        'text-anchor': v === 0 ? 'start' : v === 1500 ? 'end' : 'middle',
        text: v === 1500 ? '1 500 mm' : fmt.num(v),
      }, axis);
    }
  }

  /* ---------- Légendes HTML (créées une fois, couleurs en tokens CSS) ---------- */

  const DASH = (token) => `repeating-linear-gradient(90deg, var(${token}) 0 5px, transparent 5px 9px)`;
  let trendLegendLabel = null;

  /** Insère une légende entre l'en-tête et le graphique d'une figure. */
  function addLegend(figureId, items) {
    const fig = document.getElementById(figureId);
    const plot = fig && fig.querySelector('.fig__plot');
    if (!plot) return null;
    const list = F.legend(fig, items);
    fig.insertBefore(list, plot);
    return list;
  }

  function trendText() {
    const trend = D.rain.trend[trendMethod];
    const name = trendMethod === 'sen' ? 'pente de Sen' : 'moindres carrés';
    return `Tendance (${name}) : ${fmt.signed(trend.slope * 10, 0)} mm par décennie`;
  }

  function updateTrendLegend() {
    if (trendLegendLabel) trendLegendLabel.textContent = trendText();
  }

  function addLegends() {
    const annual = addLegend('fig-annual', [
      { label: 'Pluie annuelle', color: 'var(--rain)' },
      { label: 'Année extrême (à plus de deux écarts-types)', color: 'var(--ink-2)' },
      { label: trendText(), color: 'var(--ink)', kind: 'line' },
    ]);
    if (annual) trendLegendLabel = annual.lastElementChild.lastElementChild;
    addLegend('fig-jjas', [
      { label: 'Pluie de la saison', color: 'var(--rain)' },
      { label: `Mousson sèche : ${D.rain.dry.years.join(', ')}`, color: 'var(--dry)' },
      { label: 'Seuil : 70 % de la moyenne', color: DASH('--dry'), kind: 'line' },
      { label: `Tendance : ${fmt.signed(D.rain.jjasTrend.slope * 10, 0)} mm par décennie`, color: 'var(--ink)', kind: 'line' },
    ]);
    addLegend('fig-cv', [
      { label: 'Mousson (juin–sept.)', color: 'var(--rain)', kind: 'line' },
      { label: 'Année entière', color: 'var(--context)', kind: 'line' },
    ]);
    addLegend('fig-landuse', [
      { label: 'Rizières', color: 'var(--dry)', kind: 'line' },
      { label: 'Hévéa', color: 'var(--rubber)', kind: 'line' },
      { label: 'Zones bâties', color: 'var(--ink-2)', kind: 'line' },
      { label: 'Autres classes', color: 'var(--context)', kind: 'line' },
    ]);
    addLegend('fig-august', [
      { label: 'Août 2018 (IMD)', color: 'var(--rain)' },
      { label: 'Les trois mois d\u2019août plus pluvieux', color: 'var(--ink-2)' },
      { label: 'Autres années', color: 'var(--context)' },
    ]);
  }

  /* =======================================================================
     2. Pluie annuelle et tendance
     ======================================================================= */

  let trendMethod = 'sen';

  function renderAnnual(el, width) {
    const narrow = isNarrow(width);
    const height = Math.round(Math.min(380, Math.max(260, width * 0.34)));
    const m = { top: 30, right: narrow ? 8 : 16, bottom: 28, left: narrow ? 40 : 48 };
    const root = chart(el, width, height, 'Pluie annuelle au Kerala de 1901 à 2017, avec la droite de tendance');
    const values = D.rain.annual;
    const band = F.scaleBand(YEARS, [m.left, width - m.right], { paddingInner: 0.22, paddingOuter: 0.2 });
    const xOf = (year) => band(year) + band.bandwidth / 2;
    const y = F.scaleLinear([0, 4600], [height - m.bottom, m.top]);
    yAxis(root, y, [0, 1000, 2000, 3000, 4000], m.left, width - m.right, (t) => fmt.num(t));
    const outliers = new Set(D.rain.outliers);
    const bars = svg('g', {}, root);
    YEARS.forEach((year, i) => {
      const top = y(values[i]);
      svg('path', {
        d: columnPath(band(year), top, band.bandwidth, y(0) - top),
        style: { fill: outliers.has(year) ? color('--ink-2') : color('--rain') },
      }, bars);
    });
    svg('line', { class: 'baseline', x1: m.left, x2: width - m.right, y1: y(0), y2: y(0) }, root);
    yearTicks(root, xOf, narrow ? [1920, 1960, 2000] : [1910, 1930, 1950, 1970, 1990, 2010], height - 8);

    trendShape(root, D.rain.trend[trendMethod], YEARS, xOf, y);
    updateTrendLegend();
    labelColumns(root, D.rain.outliers, { xOf, y, values, years: YEARS });

    const mean = D.rain.mean;
    crosshair(root, {
      n: YEARS.length,
      xOf: (i) => xOf(YEARS[i]),
      box: { x0: m.left, x1: width - m.right, y0: m.top, y1: height - m.bottom },
      label: 'Pluie annuelle, une année à la fois (flèches gauche et droite)',
      content: (i) => ({
        title: String(YEARS[i]),
        rows: [
          { value: mmFmt(values[i]), label: 'de pluie dans l’année', color: outliers.has(YEARS[i]) ? color('--ink-2') : color('--rain'), kind: 'box' },
          { value: `${fmt.signed(((values[i] - mean) / mean) * 100, 0)} %`, label: 'par rapport à la moyenne' },
        ],
      }),
    });
  }

  function setupTrendToggle() {
    const buttons = { sen: document.getElementById('trend-sen'), ols: document.getElementById('trend-ols') };
    for (const [method, button] of Object.entries(buttons)) {
      if (!button) continue;
      button.addEventListener('click', () => {
        trendMethod = method;
        for (const [other, b] of Object.entries(buttons)) b.setAttribute('aria-pressed', String(other === method));
        const el = document.getElementById('annual');
        renderAnnual(el, el.clientWidth);
        updateTrendLegend();
      });
    }
  }

  /* =======================================================================
     3. Saisonnalité : climatologie et moussons sèches
     ======================================================================= */

  const MONSOON = new Set([5, 6, 7, 8]);

  function renderClimatology(el, width) {
    const height = 300;
    const m = { top: 54, right: 8, bottom: 26, left: 8 };
    const root = chart(el, width, height, 'Pluie moyenne de chaque mois, la mousson mise en avant');
    const values = D.rain.climatology;
    const months = D.rain.months;
    const band = F.scaleBand(months, [m.left, width - m.right], { paddingInner: 0.28, paddingOuter: 0.1 });
    const barW = Math.min(24, band.bandwidth);
    const xOf = (name) => band(name) + band.bandwidth / 2;
    const y = F.scaleLinear([0, 720], [height - m.bottom, m.top]);
    const narrow = band.bandwidth < 22;
    months.forEach((name, i) => {
      const top = y(values[i]);
      const g = svg('g', { class: 'mark' }, root);
      svg('path', {
        d: columnPath(xOf(name) - barW / 2, top, barW, y(0) - top, 4),
        style: { fill: MONSOON.has(i) ? color('--rain') : color('--context') },
      }, g);
      svg('text', { class: 'chart-label', x: xOf(name), y: top - 6, 'text-anchor': 'middle', text: fmt.num(values[i]) }, g);
      svg('text', {
        class: 'chart-label',
        x: xOf(name),
        y: height - 8,
        'text-anchor': 'middle',
        text: narrow ? name.slice(0, 1).toUpperCase() : name,
      }, root);
      F.hover(g, () => ({
        title: name,
        rows: [
          { value: mmFmt(values[i]), label: 'en moyenne (1901–2017)' },
          { value: pctFmt((values[i] / D.rain.mean) * 100, 0), label: 'de la pluie annuelle' },
        ],
      }), { label: `${name} : ${mmFmt(values[i])} en moyenne` });
    });
    svg('line', { class: 'baseline', x1: m.left, x2: width - m.right, y1: y(0), y2: y(0) }, root);
    // Accolade au-dessus de la mousson
    const x0 = xOf(months[5]) - barW / 2;
    const x1 = xOf(months[8]) + barW / 2;
    const yb = m.top - 26;
    svg('path', { class: 'leader', fill: 'none', d: `M${x0},${yb + 6}V${yb}H${x1}V${yb + 6}` }, root);
    svg('text', {
      class: 'chart-label chart-label--strong',
      x: (x0 + x1) / 2,
      y: yb - 8,
      'text-anchor': 'middle',
      text: `${Math.round(D.rain.jjasShare * 100)} % de l’année`,
    }, root);
  }

  function renderJjas(el, width) {
    const narrow = isNarrow(width);
    const height = Math.round(Math.min(340, Math.max(250, width * 0.4)));
    const m = { top: 26, right: narrow ? 8 : 12, bottom: 28, left: narrow ? 40 : 46 };
    const root = chart(el, width, height, 'Pluie de la mousson de juin à septembre, avec les moussons sèches');
    const values = D.rain.jjas;
    const dry = new Set(D.rain.dry.years);
    const band = F.scaleBand(YEARS, [m.left, width - m.right], { paddingInner: 0.22, paddingOuter: 0.2 });
    const xOf = (year) => band(year) + band.bandwidth / 2;
    const y = F.scaleLinear([0, 3600], [height - m.bottom, m.top]);
    yAxis(root, y, [0, 1000, 2000, 3000], m.left, width - m.right, (t) => fmt.num(t));
    YEARS.forEach((year, i) => {
      const top = y(values[i]);
      svg('path', {
        d: columnPath(band(year), top, band.bandwidth, y(0) - top),
        style: { fill: dry.has(year) ? color('--dry') : color('--rain') },
      }, root);
    });
    svg('line', { class: 'baseline', x1: m.left, x2: width - m.right, y1: y(0), y2: y(0) }, root);
    const yT = y(D.rain.dry.threshold);
    svg('line', { class: 'threshold', x1: m.left, x2: width - m.right, y1: yT, y2: yT }, root);
    trendShape(root, D.rain.jjasTrend, YEARS, xOf, y);
    yearTicks(root, xOf, narrow ? [1920, 1960, 2000] : [1910, 1930, 1950, 1970, 1990, 2010], height - 8);
    crosshair(root, {
      n: YEARS.length,
      xOf: (i) => xOf(YEARS[i]),
      box: { x0: m.left, x1: width - m.right, y0: m.top, y1: height - m.bottom },
      label: 'Pluie de la mousson, une année à la fois (flèches gauche et droite)',
      content: (i) => ({
        title: String(YEARS[i]),
        rows: [
          { value: mmFmt(values[i]), label: 'de juin à septembre', color: dry.has(YEARS[i]) ? color('--dry') : color('--rain'), kind: 'box' },
          { value: pctFmt((values[i] / D.rain.jjasMean) * 100, 0), label: 'de la moyenne' },
        ],
        note: dry.has(YEARS[i]) ? 'Mousson sèche (moins de 70 % de la moyenne)' : undefined,
      }),
    });
  }

  /* =======================================================================
     4. Variabilité et répartition des mois
     ======================================================================= */

  function renderCv(el, width) {
    const height = 280;
    const m = { top: 18, right: 92, bottom: 28, left: 44 };
    const root = chart(el, width, height, 'Coefficient de variation sur 30 ans, année entière et mousson');
    const cv = D.rain.variability.rollingCv;
    const years = cv.years;
    const x = F.scaleLinear([1901, 2017], [m.left, width - m.right]);
    const y = F.scaleLinear([0.12, 0.23], [height - m.bottom, m.top]);
    yAxis(root, y, [0.12, 0.15, 0.18, 0.21], m.left, width - m.right, (t) => fmt.num(t, 2));
    yearTicks(root, x, isNarrow(width) ? [1920, 1960, 2000] : [1920, 1940, 1960, 1980, 2000], height - 8);
    const series = [
      { key: 'annual', label: 'Année entière', token: '--context' },
      { key: 'jjas', label: 'Mousson', token: '--rain' },
    ];
    for (const s of series) {
      const d = years.map((yr, i) => `${i ? 'L' : 'M'}${x(yr).toFixed(1)},${y(cv[s.key][i]).toFixed(1)}`).join('');
      svg('path', { class: 'series-line', d, style: { stroke: color(s.token) } }, root);
      const last = cv[s.key][cv[s.key].length - 1];
      svg('circle', { cx: x(years[years.length - 1]), cy: y(last), r: 4, style: { fill: color(s.token), stroke: color('--bg'), strokeWidth: 2 } }, root);
      svg('text', { class: 'chart-label chart-label--ink', x: x(years[years.length - 1]) + 9, y: y(last), dy: '0.32em', text: s.label }, root);
    }
    crosshair(root, {
      n: years.length,
      xOf: (i) => x(years[i]),
      box: { x0: m.left, x1: width - m.right, y0: m.top, y1: height - m.bottom },
      label: 'Variabilité sur 30 ans, une année à la fois',
      content: (i) => ({
        title: `${years[i] - 15}–${years[i] + 14}`,
        rows: series.map((s) => ({ value: fmt.num(cv[s.key][i], 3), label: s.label, color: color(s.token) })),
      }),
    });
  }

  function renderShares(el, width) {
    const months = D.rain.months;
    const rowH = 26;
    const m = { top: 30, right: 66, bottom: 26, left: 52 };
    const height = m.top + rowH * 12 + m.bottom;
    const root = chart(el, width, height, 'Part de chaque mois dans la pluie annuelle, 1901–1930 et 1988–2017');
    const { early, late, p, periods } = D.rain.shares;
    const x = F.scaleLinear([0, 0.26], [m.left, width - m.right]);
    const grid = svg('g', { class: 'grid' }, root);
    const axis = svg('g', { class: 'axis' }, root);
    for (const t of [0, 0.05, 0.1, 0.15, 0.2, 0.25]) {
      svg('line', { x1: x(t), x2: x(t), y1: m.top - 6, y2: height - m.bottom }, grid);
      svg('text', { x: x(t), y: height - 8, 'text-anchor': 'middle', text: fmt.pct(t) }, axis);
    }
    svg('text', { class: 'chart-label', x: width - 4, y: m.top - 14, 'text-anchor': 'end', text: 'p' }, root);
    months.forEach((name, i) => {
      const cy = m.top + rowH * i + rowH / 2;
      const g = svg('g', { class: 'mark' }, root);
      svg('rect', { class: 'hit', x: 0, y: cy - rowH / 2, width, height: rowH }, g);
      svg('text', { class: 'chart-label chart-label--ink', x: m.left - 10, y: cy, dy: '0.32em', 'text-anchor': 'end', text: name }, g);
      svg('line', { x1: x(early[i]), x2: x(late[i]), y1: cy, y2: cy, style: { stroke: color('--line'), strokeWidth: 3, strokeLinecap: 'round' } }, g);
      svg('circle', { cx: x(early[i]), cy, r: 4.5, style: { fill: color('--context'), stroke: color('--bg'), strokeWidth: 2 } }, g);
      svg('circle', { cx: x(late[i]), cy, r: 4.5, style: { fill: color('--rain'), stroke: color('--bg'), strokeWidth: 2 } }, g);
      svg('text', { class: 'chart-label', x: width - 4, y: cy, dy: '0.32em', 'text-anchor': 'end', text: fmt.num(p[i], 2) }, g);
      F.hover(g, () => ({
        title: name,
        rows: [
          { value: fmt.pct(early[i], 1), label: periods[0], color: color('--context'), kind: 'dot' },
          { value: fmt.pct(late[i], 1), label: periods[1], color: color('--rain'), kind: 'dot' },
        ],
        note: `Mann-Whitney : p = ${fmt.num(p[i], 3)}${p[i] < 0.05 ? '' : ' (non significatif)'}`,
      }), { label: `${name} : ${fmt.pct(early[i], 1)} puis ${fmt.pct(late[i], 1)}` });
    });
    // Légende
    const legend = svg('g', {}, root);
    [[periods[0], '--context'], [periods[1], '--rain']].forEach(([label, token], j) => {
      const lx = m.left + j * 104;
      svg('circle', { cx: lx + 5, cy: 11, r: 4.5, style: { fill: color(token) } }, legend);
      svg('text', { class: 'chart-label chart-label--ink', x: lx + 14, y: 11, dy: '0.32em', text: label }, legend);
    });
  }

  /* =======================================================================
     5. Août 2018 : carte, classement, histoire du mois d'août
     ======================================================================= */

  const METRICS = [
    { key: 'departure', button: 'Écart à la normale', sub: 'écart à la pluie normale d’août (%)', rampToken: '--rain-ramp', format: (v) => `${fmt.signed(v, 0)} %`, min: 0 },
    { key: 'actual', button: 'Pluie', sub: 'pluie observée en août 2018 (mm)', rampToken: '--rain-ramp', format: mmFmt, min: 300 },
    { key: 'fatalities', button: 'Décès', sub: 'décès', rampToken: '--toll-ramp', format: (v) => fmt.num(v), min: 0 },
    { key: 'landslides', button: 'Glissements', sub: 'glissements de terrain', rampToken: '--toll-ramp', format: (v) => fmt.num(v), min: 0 },
    { key: 'houses', button: 'Maisons détruites', sub: 'maisons entièrement détruites', rampToken: '--toll-ramp', format: (v) => fmt.num(v), min: 0 },
    { key: 'camps', button: 'Camps', sub: 'camps de secours', rampToken: '--toll-ramp', format: (v) => fmt.num(v), min: 0 },
  ];
  let metric = METRICS[0];
  let hotDistrict = null;
  const districtEls = { map: new Map(), bars: new Map(), outline: null };

  function setHot(name) {
    hotDistrict = name;
    for (const group of [districtEls.map, districtEls.bars]) {
      for (const [key, node] of group) node.classList.toggle('is-hot', key === name);
    }
    // Contour du district survolé, dessiné au-dessus de ses voisins
    const district = name && D.floods.districts.find((d) => d.name === name);
    if (districtEls.outline) {
      districtEls.outline.setAttribute('d', district ? district.path : '');
      districtEls.outline.setAttribute('visibility', district ? 'visible' : 'hidden');
    }
  }

  function districtTip(d) {
    return {
      title: d.name,
      rows: [
        { value: mmFmt(d.actual), label: `de pluie (normale : ${fmt.num(d.normal)} mm)` },
        { value: `${fmt.signed(d.departure, 0)} %`, label: 'par rapport à la normale' },
        { value: fmt.num(d.fatalities), label: 'décès' },
        { value: fmt.num(d.landslides), label: 'glissements de terrain' },
        { value: fmt.num(d.houses), label: 'maisons détruites' },
      ],
    };
  }

  function scaleFor(values) {
    const max = Math.max(...values);
    const lo = metric.min;
    return (v) => (v - lo) / (max - lo || 1);
  }

  function renderMap(el, width) {
    const [W, H] = D.floods.viewBox;
    el.replaceChildren();
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': `Carte du Kerala par district : ${metric.sub}` }, el);
    const values = D.floods.districts.map((d) => d[metric.key]);
    const t = scaleFor(values);
    const fill = ramp(metric.rampToken);
    districtEls.map.clear();
    for (const d of D.floods.districts) {
      const path = svg('path', { class: 'district', d: d.path, style: { fill: fill(t(d[metric.key])) } }, root);
      districtEls.map.set(d.name, path);
      F.hover(path, () => districtTip(d), { label: `${d.name} : ${metric.format(d[metric.key])}` });
      path.addEventListener('pointerenter', () => setHot(d.name));
      path.addEventListener('focus', () => setHot(d.name));
      path.addEventListener('pointerleave', () => setHot(null));
      path.addEventListener('blur', () => setHot(null));
    }
    districtEls.outline = svg('path', { class: 'district-outline', visibility: 'hidden' }, root);
    // Légende (dégradé, min et max), dans la mer d'Arabie
    const lx = 8;
    const ly = H - 64;
    const grad = svg('linearGradient', { id: 'map-gradient' }, svg('defs', {}, root));
    for (let s = 0; s <= 10; s++) svg('stop', { offset: `${s * 10}%`, 'stop-color': fill(s / 10) }, grad);
    svg('text', { class: 'chart-label chart-label--ink', x: lx, y: ly, text: metric.button }, root);
    svg('rect', { x: lx, y: ly + 8, width: 110, height: 8, rx: 4, fill: 'url(#map-gradient)' }, root);
    svg('text', { class: 'chart-label', x: lx, y: ly + 30, text: metric.format(metric.min) }, root);
    svg('text', { class: 'chart-label', x: lx + 110, y: ly + 30, 'text-anchor': 'end', text: metric.format(Math.max(...values)) }, root);
    if (hotDistrict) setHot(hotDistrict);
  }

  function renderRanking(el, width) {
    const rows = [...D.floods.districts].sort((a, b) => b[metric.key] - a[metric.key]);
    const rowH = 26;
    const narrow = isNarrow(width);
    const m = { top: 4, right: 64, bottom: 4, left: narrow ? 118 : 132 };
    const height = m.top + rowH * rows.length + m.bottom;
    const root = chart(el, width, height, `Classement des districts : ${metric.sub}`);
    const max = Math.max(...rows.map((d) => d[metric.key]));
    const x = F.scaleLinear([0, max], [m.left, width - m.right]);
    const barColor = color(metric.rampToken === '--toll-ramp' ? '--toll' : '--rain');
    districtEls.bars.clear();
    rows.forEach((d, i) => {
      const y0 = m.top + i * rowH;
      const g = svg('g', { class: 'bar-row' }, root);
      svg('rect', { class: 'hit', x: 0, y: y0, width, height: rowH }, g);
      svg('text', { class: 'chart-label chart-label--ink', x: m.left - 10, y: y0 + rowH / 2, dy: '0.32em', 'text-anchor': 'end', text: d.name }, g);
      const w = Math.max(0, x(d[metric.key]) - m.left);
      svg('path', { class: 'bar-row__bar', d: barPath(m.left, y0 + 5, w, rowH - 10, 4), style: { fill: barColor } }, g);
      svg('text', { class: 'chart-label', x: m.left + w + 6, y: y0 + rowH / 2, dy: '0.32em', text: metric.format(d[metric.key]) }, g);
      districtEls.bars.set(d.name, g);
      F.hover(g, () => districtTip(d), { label: `${d.name} : ${metric.format(d[metric.key])}` });
      g.addEventListener('pointerenter', () => setHot(d.name));
      g.addEventListener('focus', () => setHot(d.name));
      g.addEventListener('pointerleave', () => setHot(null));
      g.addEventListener('blur', () => setHot(null));
    });
    svg('line', { class: 'baseline', x1: m.left, x2: m.left, y1: m.top, y2: height - m.bottom }, root);
    if (hotDistrict) setHot(hotDistrict);
  }

  function setupMetricToggle() {
    const seg = document.getElementById('metric-seg');
    if (!seg) return;
    const buttons = METRICS.map((mt) => {
      const b = html('button', { type: 'button', 'aria-pressed': String(mt === metric), text: mt.button }, seg);
      b.addEventListener('click', () => {
        metric = mt;
        buttons.forEach((other, i) => other.setAttribute('aria-pressed', String(METRICS[i] === mt)));
        document.getElementById('map-sub').textContent = mt.sub;
        for (const id of ['map', 'ranking']) {
          const el = document.getElementById(id);
          (id === 'map' ? renderMap : renderRanking)(el, el.clientWidth);
        }
      });
      return b;
    });
  }

  function renderAugust(el, width) {
    const narrow = isNarrow(width);
    const height = Math.round(Math.min(320, Math.max(240, width * 0.42)));
    const m = { top: 26, right: narrow ? 8 : 12, bottom: 28, left: narrow ? 40 : 46 };
    const root = chart(el, width, height, 'Pluie du mois d’août au Kerala de 1901 à 2018');
    const years = [...YEARS, 2018];
    const values = [...D.aug2018.augustHistory, D.aug2018.imd.AUG.actual];
    const top3 = new Set(D.aug2018.augustTop.map(([yr]) => yr));
    const band = F.scaleBand(years, [m.left, width - m.right], { paddingInner: 0.22, paddingOuter: 0.2 });
    const xOf = (year) => band(year) + band.bandwidth / 2;
    const y = F.scaleLinear([0, 1300], [height - m.bottom, m.top]);
    yAxis(root, y, [0, 400, 800, 1200], m.left, width - m.right, (t) => fmt.num(t));
    const fillFor = (year) => (year === 2018 ? color('--rain') : top3.has(year) ? color('--ink-2') : color('--context'));
    years.forEach((year, i) => {
      const top = y(values[i]);
      svg('path', { d: columnPath(band(year), top, band.bandwidth, y(0) - top), style: { fill: fillFor(year) } }, root);
    });
    svg('line', { class: 'baseline', x1: m.left, x2: width - m.right, y1: y(0), y2: y(0) }, root);
    yearTicks(root, xOf, narrow ? [1920, 1960, 2000] : [1910, 1930, 1950, 1970, 1990, 2010], height - 8);
    labelColumns(root, [...top3, 2018], { xOf, y, values, years });
    crosshair(root, {
      n: years.length,
      xOf: (i) => xOf(years[i]),
      box: { x0: m.left, x1: width - m.right, y0: m.top, y1: height - m.bottom },
      label: 'Pluie du mois d’août, une année à la fois',
      content: (i) => ({
        title: `Août ${years[i]}`,
        rows: [{ value: mmFmt(values[i]), label: 'de pluie sur l’État', color: fillFor(years[i]), kind: 'box' }],
        note: years[i] === 2018 ? `Chiffre de l’IMD · ${D.aug2018.augustRank}e mois d’août depuis 1901` : undefined,
      }),
    });
  }

  /* =======================================================================
     6. Températures : bandes de réchauffement et saisons
     ======================================================================= */

  function renderStripes(el, width) {
    const narrow = isNarrow(width);
    const height = narrow ? 120 : 150;
    const m = { top: 0, right: 0, bottom: 26, left: 0 };
    const root = chart(el, width, height, 'Bandes de réchauffement : écart annuel à la température moyenne de 1901 à 2017');
    const T = D.temperature;
    const anomalies = T.annual.map((v) => v - T.mean);
    const limit = Math.max(...anomalies.map(Math.abs));
    const diverging = ramp('--diverging-ramp');
    const x = F.scaleLinear([T.years[0], T.years[T.years.length - 1] + 1], [m.left, width - m.right]);
    const w = x(T.years[0] + 1) - x(T.years[0]);
    T.years.forEach((year, i) => {
      svg('rect', { x: x(year), y: m.top, width: w + 0.6, height: height - m.bottom - m.top, fill: diverging(0.5 + anomalies[i] / (2 * limit)) }, root);
    });
    yearTicks(root, (yr) => x(yr) + w / 2, narrow ? [1901, 1960, 2017] : [1901, 1925, 1950, 1975, 2000, 2017], height - 8);
    crosshair(root, {
      n: T.years.length,
      xOf: (i) => x(T.years[i]) + w / 2,
      box: { x0: 0, x1: width, y0: m.top, y1: height - m.bottom },
      label: 'Température annuelle, une année à la fois',
      content: (i) => ({
        title: String(T.years[i]),
        rows: [
          { value: fmt.unit(T.annual[i], '°C', 2), label: 'température annuelle' },
          { value: `${fmt.signed(anomalies[i], 2)} °C`, label: 'par rapport à la moyenne 1901–2017' },
        ],
      }),
    });
  }

  function renderSeasons(el, width) {
    const T = D.temperature;
    const rows = [
      { label: 'Année entière', perCentury: T.trend.slope * 100, low: T.trend.low * 100, high: T.trend.high * 100 },
      ...T.seasons.map((s) => ({ label: s.label, perCentury: s.perCentury, low: s.low, high: s.high })),
    ];
    const rowH = 34;
    const m = { top: 6, right: 70, bottom: 26, left: isNarrow(width) ? 98 : 116 };
    const height = m.top + rowH * rows.length + m.bottom;
    const root = chart(el, width, height, 'Réchauffement par saison, en degrés par siècle');
    const x = F.scaleLinear([0, 2.1], [m.left, width - m.right]);
    const grid = svg('g', { class: 'grid' }, root);
    const axis = svg('g', { class: 'axis' }, root);
    for (const t of [0, 0.5, 1, 1.5, 2]) {
      svg('line', { x1: x(t), x2: x(t), y1: m.top, y2: height - m.bottom }, grid);
      svg('text', { x: x(t), y: height - 8, 'text-anchor': 'middle', text: `${fmt.num(t, 1)} °C` }, axis);
    }
    const warm = ramp('--diverging-ramp')(0.88);
    rows.forEach((r, i) => {
      const y0 = m.top + i * rowH;
      const cy = y0 + rowH / 2;
      const g = svg('g', { class: 'mark' }, root);
      svg('rect', { class: 'hit', x: 0, y: y0, width, height: rowH }, g);
      svg('text', { class: `chart-label ${i === 0 ? 'chart-label--strong' : 'chart-label--ink'}`, x: m.left - 10, y: cy, dy: '0.32em', 'text-anchor': 'end', text: r.label }, g);
      svg('path', { d: barPath(m.left, cy - 8, x(r.perCentury) - m.left, 16, 4), fill: warm }, g);
      svg('line', { x1: x(r.low), x2: x(r.high), y1: cy, y2: cy, style: { stroke: color('--ink'), strokeWidth: 1.5 } }, g);
      for (const v of [r.low, r.high]) svg('line', { x1: x(v), x2: x(v), y1: cy - 5, y2: cy + 5, style: { stroke: color('--ink'), strokeWidth: 1.5 } }, g);
      svg('text', { class: 'chart-label chart-label--ink', x: x(r.high) + 8, y: cy, dy: '0.32em', text: `${fmt.signed(r.perCentury, 1)} °C` }, g);
      F.hover(g, () => ({
        title: r.label,
        rows: [
          { value: `${fmt.signed(r.perCentury, 2)} °C`, label: 'par siècle (pente de Sen)' },
          { value: `${fmt.num(r.low, 2)} à ${fmt.num(r.high, 2)} °C`, label: 'intervalle de confiance à 95 %' },
        ],
      }), { label: `${r.label} : ${fmt.signed(r.perCentury, 1)} degrés par siècle` });
    });
    svg('line', { class: 'baseline', x1: m.left, x2: m.left, y1: m.top, y2: height - m.bottom }, root);
  }

  /* =======================================================================
     7. Occupation du sol
     ======================================================================= */

  const FOREST_CLASSES = new Set(['Forêt sempervirente', 'Forêt dense mixte', 'Forêt claire', 'Plantations d’eucalyptus', "Plantations d'eucalyptus"]);
  const MIXED = 'Cultures mixtes (jardins arborés)';

  function landUseSeries() {
    const L = D.landUse;
    const series = L.rows
      .filter((r) => !FOREST_CLASSES.has(r.label) && r.label !== MIXED)
      .map((r) => ({ label: r.label, values: r.values }));
    series.push({ label: 'Forêt (toutes classes)', values: L.forestTotal });
    const style = {
      Rizières: { token: '--dry', strong: true },
      'Hévéa (caoutchouc)': { token: '--rubber', strong: true },
      'Zones bâties': { token: '--ink-2', strong: true },
      'Forêt (toutes classes)': { token: '--context', labelled: true },
    };
    return series.map((s) => ({ ...s, ...(style[s.label] || { token: '--context' }) }));
  }

  function renderLandUse(el, width) {
    const L = D.landUse;
    const narrow = isNarrow(width);
    const height = 340;
    const m = { top: 14, right: narrow ? 120 : 190, bottom: 28, left: 40 };
    const root = chart(el, width, height, 'Occupation du sol dans le bassin de la Neyyar en 1914, 1967 et 2007');
    const x = F.scaleLinear([L.years[0], L.years[2]], [m.left + 6, width - m.right]);
    const y = F.scaleLinear([0, 125], [height - m.bottom, m.top]);
    yAxis(root, y, [0, 25, 50, 75, 100, 125], m.left, width - m.right + 6, (t) => fmt.num(t));
    yearTicks(root, x, L.years, height - 8);
    const series = landUseSeries();
    const ordered = [...series.filter((s) => !s.strong), ...series.filter((s) => s.strong)];
    const ends = [];
    for (const s of ordered) {
      const pts = L.years.map((yr, i) => [yr, s.values[i]]).filter(([, v]) => v !== null);
      const d = pts.map(([yr, v], i) => `${i ? 'L' : 'M'}${x(yr).toFixed(1)},${y(v).toFixed(1)}`).join('');
      const g = svg('g', { class: 'mark' }, root);
      svg('path', { class: 'hit', d, style: { stroke: 'transparent', strokeWidth: 14, fill: 'none' } }, g);
      svg('path', { class: 'series-line', d, style: { stroke: color(s.token), strokeWidth: s.strong ? 2.5 : 1.2 } }, g);
      for (const [yr, v] of pts) {
        svg('circle', { cx: x(yr), cy: y(v), r: s.strong ? 4.5 : 2.5, style: { fill: color(s.token), stroke: color('--bg'), strokeWidth: 2 } }, g);
      }
      F.hover(g, () => ({
        title: s.label,
        rows: L.years.map((yr, i) => ({ value: s.values[i] === null ? 'non relevé' : `${fmt.num(s.values[i], 1)} km²`, label: String(yr) })),
      }), { label: `${s.label} : ${s.values.map((v) => (v === null ? 'non relevé' : `${fmt.num(v, 1)} km²`)).join(', ')}` });
      if (s.strong || s.labelled) ends.push({ s, v: pts[pts.length - 1][1], yr: pts[pts.length - 1][0] });
    }
    // Étiquettes de fin de ligne, écartées si elles se chevauchent
    ends.sort((a, b) => a.v - b.v);
    let previous = Infinity;
    for (const e of ends) {
      const target = Math.min(y(e.v), previous - 16);
      previous = target;
      const lx = x(e.yr) + 12;
      if (Math.abs(target - y(e.v)) > 2) svg('line', { class: 'leader', x1: x(e.yr) + 5, x2: lx - 3, y1: y(e.v), y2: target }, root);
      svg('text', {
        class: `chart-label ${e.s.strong ? 'chart-label--strong' : 'chart-label--ink'}`,
        x: lx,
        y: target,
        dy: '0.32em',
        text: narrow ? e.s.label.replace(' (caoutchouc)', '').replace(' (toutes classes)', '') : `${e.s.label} · ${fmt.num(e.v, 1)} km²`,
      }, root);
    }
  }

  /* =======================================================================
     Vues tableau (une fois) et montage
     ======================================================================= */

  function addTables() {
    const months = D.rain.months;
    addTable('fig-annual', {
      caption: 'Pluie annuelle au Kerala',
      columns: [
        { key: 'year', label: 'Année' },
        { key: 'value', label: 'Pluie (mm)', num: true, format: (v) => fmt.num(v, 1) },
        { key: 'gap', label: 'Écart à la moyenne', num: true, format: (v) => `${fmt.signed(v, 0)} %` },
      ],
      rows: YEARS.map((year, i) => ({ year, value: D.rain.annual[i], gap: ((D.rain.annual[i] - D.rain.mean) / D.rain.mean) * 100 })),
    });
    addTable('fig-climatology', {
      caption: 'Pluie moyenne mensuelle',
      columns: [
        { key: 'month', label: 'Mois' },
        { key: 'value', label: 'Pluie moyenne (mm)', num: true, format: (v) => fmt.num(v, 1) },
      ],
      rows: months.map((month, i) => ({ month, value: D.rain.climatology[i] })),
    });
    addTable('fig-jjas', {
      caption: 'Pluie de la mousson',
      columns: [
        { key: 'year', label: 'Année' },
        { key: 'value', label: 'Juin–sept. (mm)', num: true, format: (v) => fmt.num(v, 1) },
        { key: 'dry', label: 'Mousson sèche' },
      ],
      rows: YEARS.map((year, i) => ({ year, value: D.rain.jjas[i], dry: D.rain.dry.years.includes(year) ? 'oui' : '' })),
    });
    const cv = D.rain.variability.rollingCv;
    addTable('fig-cv', {
      caption: 'Coefficient de variation sur 30 ans',
      columns: [
        { key: 'year', label: 'Centre de la fenêtre' },
        { key: 'annual', label: 'Année entière', num: true, format: (v) => fmt.num(v, 3) },
        { key: 'jjas', label: 'Mousson', num: true, format: (v) => fmt.num(v, 3) },
      ],
      rows: cv.years.map((year, i) => ({ year, annual: cv.annual[i], jjas: cv.jjas[i] })),
    });
    const S = D.rain.shares;
    addTable('fig-shares', {
      caption: 'Part de chaque mois',
      columns: [
        { key: 'month', label: 'Mois' },
        { key: 'early', label: S.periods[0], num: true, format: (v) => fmt.pct(v, 1) },
        { key: 'late', label: S.periods[1], num: true, format: (v) => fmt.pct(v, 1) },
        { key: 'p', label: 'p (Mann-Whitney)', num: true, format: (v) => fmt.num(v, 3) },
      ],
      rows: months.map((month, i) => ({ month, early: S.early[i], late: S.late[i], p: S.p[i] })),
    });
    addTable('fig-map', {
      caption: 'Inondations d’août 2018 par district',
      columns: [
        { key: 'name', label: 'District' },
        { key: 'actual', label: 'Pluie (mm)', num: true, format: (v) => fmt.num(v, 1) },
        { key: 'normal', label: 'Normale (mm)', num: true, format: (v) => fmt.num(v, 1) },
        { key: 'departure', label: 'Écart', num: true, format: (v) => `${fmt.signed(v, 0)} %` },
        { key: 'fatalities', label: 'Décès', num: true },
        { key: 'landslides', label: 'Glissements', num: true },
        { key: 'houses', label: 'Maisons détruites', num: true },
        { key: 'camps', label: 'Camps', num: true },
      ],
      rows: D.floods.districts,
    });
    addTable('fig-august', {
      caption: 'Pluie du mois d’août',
      columns: [
        { key: 'year', label: 'Année' },
        { key: 'value', label: 'Août (mm)', num: true, format: (v) => fmt.num(v, 1) },
      ],
      rows: [...YEARS.map((year, i) => ({ year, value: D.aug2018.augustHistory[i] })), { year: '2018 (IMD)', value: D.aug2018.imd.AUG.actual }],
    });
    const T = D.temperature;
    addTable('fig-stripes', {
      caption: 'Température annuelle de l’Inde',
      columns: [
        { key: 'year', label: 'Année' },
        { key: 'value', label: 'Température (°C)', num: true, format: (v) => fmt.num(v, 2) },
        { key: 'gap', label: 'Écart à la moyenne (°C)', num: true, format: (v) => fmt.signed(v, 2) },
      ],
      rows: T.years.map((year, i) => ({ year, value: T.annual[i], gap: T.annual[i] - T.mean })),
    });
    addTable('fig-seasons', {
      caption: 'Réchauffement par saison',
      columns: [
        { key: 'label', label: 'Saison' },
        { key: 'perCentury', label: '°C par siècle', num: true, format: (v) => fmt.signed(v, 2) },
        { key: 'low', label: 'IC bas', num: true, format: (v) => fmt.num(v, 2) },
        { key: 'high', label: 'IC haut', num: true, format: (v) => fmt.num(v, 2) },
      ],
      rows: T.seasons,
    });
    const L = D.landUse;
    addTable('fig-landuse', {
      caption: 'Occupation du sol (km²)',
      columns: [{ key: 'label', label: 'Classe' }, ...L.years.map((yr, i) => ({ key: `y${i}`, label: String(yr), num: true, format: (v) => (v === null ? 'non relevé' : fmt.num(v, 2)) }))],
      rows: L.rows.map((r) => ({ label: r.label, y0: r.values[0], y1: r.values[1], y2: r.values[2] })),
    });
  }

  /** Surligne dans la barre de navigation la section en cours de lecture. */
  function setupScrollSpy() {
    const links = [...document.querySelectorAll('.sitenav a')];
    const targets = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
    if (!('IntersectionObserver' in window) || !targets.length) return;
    const visible = new Map();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
      const active = targets.find((t) => visible.get(t.id));
      for (const a of links) {
        if (active && a.getAttribute('href') === `#${active.id}`) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    targets.forEach((t) => observer.observe(t));
  }

  mount('clock', renderClock);
  mount('annual', renderAnnual);
  mount('climatology', renderClimatology);
  mount('jjas', renderJjas);
  mount('cv', renderCv);
  mount('shares', renderShares);
  mount('map', renderMap);
  mount('ranking', renderRanking);
  mount('august', renderAugust);
  mount('stripes', renderStripes);
  mount('seasons', renderSeasons);
  mount('landuse', renderLandUse);
  addLegends();
  setupTrendToggle();
  setupMetricToggle();
  addTables();
  setupScrollSpy();
})();
