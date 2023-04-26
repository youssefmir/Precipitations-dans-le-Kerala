/* ==========================================================================
   Utilitaires du site (aucune dépendance)
   Expose `window.Frame` :
     fmt        formats numériques français (espaces fines, virgule décimale)
     svg/html   création d'éléments (attributs + textContent, jamais innerHTML)
     scaleLinear / scaleBand / niceTicks / niceDomain   échelles
     tip.show / tip.hide / hover   infobulle unique, souris + clavier
     dataTable  vue tableau repliable (jumeau accessible d'un graphique)
     legend     légende HTML (carré, trait ou point)
     onResize   rendu responsive (ResizeObserver, une fois par frame)
     onTheme    rappel quand le thème clair/sombre change
     cssVar     lecture d'un token CSS
     reducedMotion  préférence « mouvement réduit »
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------- Formats ---------- */
  const cache = new Map();
  function nf(min, max, extra) {
    const key = `${min}|${max}|${JSON.stringify(extra || {})}`;
    if (!cache.has(key)) {
      cache.set(key, new Intl.NumberFormat('fr-FR', { minimumFractionDigits: min, maximumFractionDigits: max, ...extra }));
    }
    return cache.get(key);
  }
  const NNBSP = ' ';
  const MINUS = '−';
  const fmt = {
    /** 12 345,6 */
    num(x, digits = 0) {
      return Number.isFinite(x) ? nf(digits, digits).format(x).replace('-', MINUS) : '–';
    },
    /** +1,2 / −0,4 / ±0 */
    signed(x, digits = 0) {
      if (!Number.isFinite(x)) return '–';
      const s = nf(digits, digits).format(Math.abs(x));
      if (Number(s.replace(/\s/g, '').replace(',', '.')) === 0) return `±${s}`;
      return (x > 0 ? '+' : MINUS) + s;
    },
    /** 0.123 → 12 % */
    pct(x, digits = 0) {
      return Number.isFinite(x) ? `${nf(digits, digits).format(x * 100).replace('-', MINUS)}${NNBSP}%` : '–';
    },
    /** 12 300 → 12,3 k */
    compact(x) {
      return Number.isFinite(x) ? nf(0, 1, { notation: 'compact' }).format(x) : '–';
    },
    /** valeur + unité séparées par une espace fine insécable */
    unit(x, unit, digits = 0) {
      return `${fmt.num(x, digits)}${NNBSP}${unit}`;
    },
  };

  /* ---------- Éléments ---------- */
  const SVGNS = 'http://www.w3.org/2000/svg';
  function setAttrs(node, attrs) {
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') node.textContent = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    return node;
  }
  function svg(tag, attrs, parent) {
    const node = setAttrs(document.createElementNS(SVGNS, tag), attrs);
    if (parent) parent.appendChild(node);
    return node;
  }
  function html(tag, attrs, parent) {
    const node = setAttrs(document.createElement(tag), attrs);
    if (parent) parent.appendChild(node);
    return node;
  }

  /* ---------- Échelles ---------- */
  function niceStep(span, count) {
    const raw = span / Math.max(1, count);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / mag;
    const step = norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1;
    return step * mag;
  }
  function niceTicks(a, b, count = 5) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (lo === hi) return [lo];
    const step = niceStep(hi - lo, count);
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
    return out;
  }
  function niceDomain(a, b, count = 5) {
    const step = niceStep(b - a, count);
    return [Math.floor(a / step + 1e-9) * step, Math.ceil(b / step - 1e-9) * step];
  }
  function scaleLinear(domain, range) {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    const k = (r1 - r0) / (d1 - d0 || 1);
    const s = (v) => r0 + (v - d0) * k;
    s.invert = (p) => d0 + (p - r0) / k;
    s.domain = domain;
    s.range = range;
    s.ticks = (count = 5) => niceTicks(d0, d1, count);
    return s;
  }
  function scaleBand(keys, range, { paddingInner = 0.2, paddingOuter = 0.1 } = {}) {
    const [r0, r1] = range;
    const n = keys.length;
    const step = (r1 - r0) / Math.max(1, n - paddingInner + paddingOuter * 2);
    const bandwidth = step * (1 - paddingInner);
    const index = new Map(keys.map((k, i) => [k, i]));
    const s = (key) => r0 + step * paddingOuter + step * index.get(key);
    s.bandwidth = bandwidth;
    s.step = step;
    s.domain = keys;
    return s;
  }

  /* ---------- Infobulle ---------- */
  let tipNode = null;
  function tipEl() {
    if (!tipNode) {
      tipNode = html('div', { class: 'tip', role: 'status', 'aria-live': 'polite' }, document.body);
      tipNode.hidden = true;
    }
    return tipNode;
  }
  /**
   * content = { title?, rows: [{ value, label?, color?, kind?: 'line'|'dot'|'box' }], note? }
   * anchor  = événement pointeur (position souris) ou élément / événement focus (position de l'élément)
   */
  function showTip(anchor, content) {
    if (!content) return hideTip();
    const t = tipEl();
    t.replaceChildren();
    if (content.title) html('div', { class: 'tip__title', text: content.title }, t);
    for (const r of content.rows || []) {
      const row = html('div', { class: 'tip__row' }, t);
      if (r.color) html('i', { class: `tip__key tip__key--${r.kind || 'line'}`, style: { background: r.color } }, row);
      html('b', { class: 'tip__value', text: r.value }, row);
      if (r.label) html('span', { class: 'tip__label', text: r.label }, row);
    }
    if (content.note) html('div', { class: 'tip__note', text: content.note }, t);
    t.hidden = false;

    let x;
    let y;
    const isPointer = anchor && typeof anchor.clientX === 'number' && !/^focus/.test(anchor.type || '');
    if (isPointer) {
      x = anchor.clientX;
      y = anchor.clientY;
    } else {
      const el = (anchor && anchor.target) || anchor;
      const r = el.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top;
    }
    const pad = 14;
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    let left = x + pad;
    let top = y - h - pad;
    if (left + w > innerWidth - 8) left = x - w - pad;
    if (left < 8) left = 8;
    if (top < 8) top = y + pad;
    if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - h - 8);
    t.style.left = `${left}px`;
    t.style.top = `${top}px`;
  }
  function hideTip() {
    if (tipNode) tipNode.hidden = true;
  }
  /**
   * Branche survol + focus clavier sur un élément. getContent(event) renvoie le contenu de l'infobulle.
   * label : nom accessible (aria-label) de la marque.
   */
  function hover(el, getContent, { label, focusable = true } = {}) {
    if (focusable) el.setAttribute('tabindex', '0');
    if (label) el.setAttribute('aria-label', label);
    const show = (e) => {
      el.classList.add('is-hot');
      showTip(e, getContent(e));
    };
    const hide = () => {
      el.classList.remove('is-hot');
      hideTip();
    };
    el.addEventListener('pointerenter', show);
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerleave', hide);
    el.addEventListener('focus', show);
    el.addEventListener('blur', hide);
    return el;
  }
  addEventListener('scroll', hideTip, { passive: true });

  /* ---------- Vue tableau ---------- */
  /** columns = [{ key, label, num?: bool, format?: (v, row) => string }] */
  function dataTable(parent, { columns, rows, summary = 'Voir les données', caption }) {
    const details = html('details', { class: 'dataview' }, parent);
    html('summary', { text: summary }, details);
    const scroll = html('div', { class: 'dataview__scroll' }, details);
    const table = html('table', {}, scroll);
    if (caption) html('caption', { class: 'sr-only', text: caption }, table);
    const tr = html('tr', {}, html('thead', {}, table));
    for (const c of columns) html('th', { scope: 'col', class: c.num ? 'num' : null, text: c.label }, tr);
    const tbody = html('tbody', {}, table);
    for (const row of rows) {
      const line = html('tr', {}, tbody);
      for (const c of columns) {
        const v = row[c.key];
        const text = c.format ? c.format(v, row) : v === null || v === undefined ? '–' : v;
        html('td', { class: c.num ? 'num' : null, text }, line);
      }
    }
    return details;
  }

  /* ---------- Légende ---------- */
  /** items = [{ label, color, kind?: 'box'|'line'|'dot' }] */
  function legend(parent, items) {
    const ul = html('ul', { class: 'legend' }, parent);
    for (const it of items) {
      const li = html('li', {}, ul);
      const kind = it.kind || 'box';
      html('i', { class: `legend__key${kind === 'box' ? '' : ` legend__key--${kind}`}`, style: { background: it.color } }, li);
      html('span', { text: it.label }, li);
    }
    return ul;
  }

  /* ---------- Responsive & thème ---------- */
  function onResize(el, cb) {
    let width = -1;
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w === width || w === 0) return;
      width = w;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => cb(w));
    });
    ro.observe(el);
    return ro;
  }
  function onTheme(cb) {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', () => cb());
    new MutationObserver(() => cb()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  function cssVar(name, el = document.documentElement) {
    return getComputedStyle(el).getPropertyValue(name).trim();
  }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  global.Frame = {
    fmt,
    svg,
    html,
    scaleLinear,
    scaleBand,
    niceTicks,
    niceDomain,
    tip: { show: showTip, hide: hideTip },
    hover,
    dataTable,
    legend,
    onResize,
    onTheme,
    cssVar,
    reducedMotion,
  };
})(window);
