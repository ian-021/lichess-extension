// Lichess chess.com-style shapes
//
// Chessground (the board library Lichess uses) renders user arrows as <line> elements
// with an arrowhead marker, and square marks as <circle> elements, inside
// <svg class="cg-shapes"> with viewBox "-4 -4 8 8" (one square = one unit, origin at
// the board center). Each shape lives in <g cgHash="w,h,[true],[pendingErase],n,orig,[dest],brush,..."></g>.
//
// This script watches for those groups, hides the original line/circle, and appends a
// chess.com-style <path> (filled polygon) or <rect> inside the same group. Because the
// replacement sits inside the chessground-owned group, chessground removes it together
// with the original when the shape goes away.

(() => {
  'use strict';

  // ---- Tunables (all sizes are in squares; measured from chess.com) -----------------
  const CONFIG = {
    shaftWidth: 0.21,   // thickness of the arrow shaft
    headWidth: 0.47,    // width of the arrowhead at its base
    headLength: 0.35,   // length of the arrowhead
    startOffset: 0.36,  // gap between the origin square center and the arrow start (keeps it off the piece)
    tipOffset: 0.04,    // how far before the destination center the tip stops
    arrowOpacity: 0.8,
    highlightOpacity: 0.8,
    // Lichess brush -> chess.com color. Lichess picks the brush from the modifier keys:
    // none = green, shift = red, alt = blue, shift+alt = yellow.
    arrowColors: {
      green: '#ffaa00',  // chess.com default orange
      red: '#eb6150',
      blue: '#52a0e0',
      yellow: '#9bc85b',
    },
    highlightColors: {
      green: '#eb6150',  // chess.com default red
      red: '#ffaa00',
      blue: '#52a0e0',
      yellow: '#9bc85b',
    },
    // Lichess applies opacity .6 to the whole .cg-shapes layer; content.css resets it to 1.
    // Shapes we do not recolor (engine arrows etc.) get this factor to look unchanged.
    lichessLayerOpacity: 0.6,
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SVG_SELECTOR = 'svg.cg-shapes, svg.cg-shapes-below';
  const KEY_RE = /^[a-h][1-8]$/;

  // ---- Geometry ---------------------------------------------------------------------
  const key2pos = key => [key.charCodeAt(0) - 97, key.charCodeAt(1) - 49];

  function pos2user(pos, orientation, xScale, yScale) {
    const [f, r] = orientation === 'white' ? pos : [7 - pos[0], 7 - pos[1]];
    return [(f - 3.5) * xScale, (3.5 - r) * yScale];
  }

  const fmt = n => (Math.round(n * 1000) / 1000).toString();
  const pathFrom = pts => 'M' + pts.map(p => fmt(p[0]) + ',' + fmt(p[1])).join('L') + 'Z';
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];

  // Straight arrow: a single filled polygon (shaft + head).
  function straightArrowPath(from, to, scale) {
    const w = (CONFIG.shaftWidth * scale) / 2;
    const hw = (CONFIG.headWidth * scale) / 2;
    const hl = CONFIG.headLength * scale;
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const len = Math.hypot(dx, dy);
    const d = [dx / len, dy / len];
    const n = [-d[1], d[0]];
    const tip = add(to, d, -CONFIG.tipOffset);
    let start = add(from, d, CONFIG.startOffset);
    // Never let the shaft run backwards on very short arrows.
    const maxStart = Math.max(0, len - CONFIG.tipOffset - hl - 0.05);
    if (CONFIG.startOffset > maxStart) start = add(from, d, maxStart);
    const base = add(tip, d, -hl);
    return pathFrom([
      add(start, n, w),
      add(base, n, w),
      add(base, n, hw),
      tip,
      add(base, n, -hw),
      add(base, n, -w),
      add(start, n, -w),
    ]);
  }

  // Knight arrow: L-shape, long leg (two squares) first, then the one-square leg with the head.
  // d1 = unit vector of the long leg, d2 = unit vector of the short leg (perpendicular).
  function knightArrowPath(from, corner, to, scale) {
    const w = (CONFIG.shaftWidth * scale) / 2;
    const hw = (CONFIG.headWidth * scale) / 2;
    const hl = CONFIG.headLength * scale;
    const l1 = Math.hypot(corner[0] - from[0], corner[1] - from[1]);
    const l2 = Math.hypot(to[0] - corner[0], to[1] - corner[1]);
    const d1 = [(corner[0] - from[0]) / l1, (corner[1] - from[1]) / l1];
    const d2 = [(to[0] - corner[0]) / l2, (to[1] - corner[1]) / l2];
    const start = add(from, d1, CONFIG.startOffset);
    const tip = add(to, d2, -CONFIG.tipOffset);
    const base = add(tip, d2, -hl);
    return pathFrom([
      add(start, d2, -w),                  // outer side of leg 1
      add(add(corner, d1, w), d2, -w),     // outer (convex) corner
      add(base, d1, w),                    // outer side of leg 2, at head base
      add(base, d1, hw),
      tip,
      add(base, d1, -hw),
      add(base, d1, -w),                   // inner side of leg 2
      add(add(corner, d1, -w), d2, w),     // inner (concave) corner
      add(start, d2, w),                   // inner side of leg 1
    ]);
  }

  // ---- Hash parsing -----------------------------------------------------------------
  function parseHash(hash) {
    const tokens = hash.split(',');
    const width = parseFloat(tokens[0]);
    const height = parseFloat(tokens[1]);
    const keys = [];
    let brush = null;
    for (let i = 2; i < tokens.length; i++) {
      if (KEY_RE.test(tokens[i])) keys.push(tokens[i]);
      else if (keys.length && brush === null) brush = tokens[i];
    }
    if (!keys.length) return null;
    const ok = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
    return {
      orig: keys[0],
      dest: keys[1],
      brush,
      current: tokens[2] === 'true',
      pendingErase: tokens.includes('pendingErase'),
      xScale: ok ? Math.min(1, width / height) : 1,
      yScale: ok ? Math.min(1, height / width) : 1,
    };
  }

  function orientationOf(el) {
    const wrap = el.closest('.cg-wrap');
    return wrap && wrap.classList.contains('orientation-black') ? 'black' : 'white';
  }

  // ---- Conversion -------------------------------------------------------------------
  function convert(group, svg) {
    group.dataset.cc = '1';
    const hash = group.getAttribute('cgHash') || '';
    const info = parseHash(hash);
    if (!info) return;

    const line = group.querySelector('line');
    const circle = group.querySelector('circle');
    const originalEl = line || circle;
    if (!originalEl) return;

    const inMainLayer = svg.classList.contains('cg-shapes');
    const orientation = orientationOf(svg);
    const from = pos2user(key2pos(info.orig), orientation, info.xScale, info.yScale);
    const origOpacity = parseFloat(originalEl.getAttribute('opacity'));
    const origColor = originalEl.getAttribute('stroke') || '#15781B';

    // While the mouse button is held, chessground previews the shape being drawn (a circle on
    // the origin square, then an arrow that follows the cursor). chess.com shows nothing until
    // release, so hide the preview and draw nothing for in-progress shapes.
    if (info.current) {
      for (const child of Array.from(group.children)) child.style.display = 'none';
      return;
    }

    let el;
    let opacity;
    if (line && info.dest && info.dest !== info.orig) {
      const to = pos2user(key2pos(info.dest), orientation, info.xScale, info.yScale);
      const [f1, r1] = key2pos(info.orig);
      const [f2, r2] = key2pos(info.dest);
      const df = Math.abs(f2 - f1), dr = Math.abs(r2 - r1);
      const isKnight = (df === 2 && dr === 1) || (df === 1 && dr === 2);
      const scale = 1;
      let d;
      if (isKnight) {
        const cornerKey = df === 2
          ? String.fromCharCode(97 + f2) + String.fromCharCode(49 + r1)   // long leg is horizontal
          : String.fromCharCode(97 + f1) + String.fromCharCode(49 + r2);  // long leg is vertical
        const corner = pos2user(key2pos(cornerKey), orientation, info.xScale, info.yScale);
        d = knightArrowPath(from, corner, to, scale);
      } else {
        d = straightArrowPath(from, to, scale);
      }
      el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('d', d);
      el.setAttribute('class', 'cc-arrow');
      const color = CONFIG.arrowColors[info.brush];
      el.setAttribute('fill', color || origColor);
      opacity = color ? CONFIG.arrowOpacity : fallbackOpacity(origOpacity, inMainLayer);
    } else {
      el = document.createElementNS(SVG_NS, 'rect');
      el.setAttribute('x', fmt(from[0] - info.xScale / 2));
      el.setAttribute('y', fmt(from[1] - info.yScale / 2));
      el.setAttribute('width', fmt(info.xScale));
      el.setAttribute('height', fmt(info.yScale));
      el.setAttribute('class', 'cc-highlight');
      const color = CONFIG.highlightColors[info.brush];
      el.setAttribute('fill', color || origColor);
      opacity = color ? CONFIG.highlightOpacity : fallbackOpacity(origOpacity, inMainLayer);
    }
    if (info.pendingErase) opacity *= 0.6;
    el.setAttribute('opacity', fmt(opacity));

    // Hide every original child (line/circle, or the hilite wrapper group) and add ours.
    for (const child of Array.from(group.children)) child.style.display = 'none';
    group.appendChild(el);
  }

  function fallbackOpacity(origOpacity, inMainLayer) {
    const o = Number.isFinite(origOpacity) ? origOpacity : 1;
    return inMainLayer ? o * CONFIG.lichessLayerOpacity : o;
  }

  // ---- DOM observation --------------------------------------------------------------
  function processSvg(svg) {
    for (const g of svg.querySelectorAll('g[cgHash]:not([data-cc])')) convert(g, svg);
  }

  function scan(root) {
    if (root.matches && root.matches(SVG_SELECTOR)) processSvg(root);
    if (root.querySelectorAll) root.querySelectorAll(SVG_SELECTOR).forEach(processSvg);
  }

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const svg = node.closest(SVG_SELECTOR);
        if (svg) processSvg(svg);
        else scan(node);
      }
    }
  });

  scan(document.documentElement);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
