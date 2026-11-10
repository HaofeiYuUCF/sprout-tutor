/* SPROUT Web Lab: a small live plot of the readings a board prints.
 *
 * It reads lines such as "raw=512 temp_c=24.8 fan=ON" and draws one number over time, with
 * ON/OFF values as strips under the curve. No library: one canvas, redrawn on new data.
 */
(function (global) {
  "use strict";

  const PAIR = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?|ON|OFF)(?![A-Za-z0-9_.])/g;
  const MAX_ROWS = 240;
  const PREFERRED = ["temp_c", "moisture", "vwc"];     // plotted first when present

  /** "raw=512 temp_c=24.8 fan=ON" -> { numbers: {raw: 512, temp_c: 24.8}, flags: {fan: true} } */
  function parseLine(line) {
    const numbers = {}, flags = {};
    let found = false;
    for (const m of String(line).matchAll(PAIR)) {
      found = true;
      if (m[2] === "ON" || m[2] === "OFF") flags[m[1]] = m[2] === "ON";
      else numbers[m[1]] = Number(m[2]);
    }
    return found ? { numbers, flags } : null;
  }

  function niceRange(lo, hi) {
    if (lo === hi) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.12;
    return [lo - pad, hi + pad];
  }

  function create(box) {
    const canvas = box.querySelector("canvas");
    const select = box.querySelector("select");
    const legend = box.querySelector(".plot-legend");
    let rows = [], numeric = [], flagNames = [], chosen = null, pending = 0;

    function fieldsChanged() {
      select.replaceChildren(...numeric.map((k) => {
        const o = document.createElement("option");
        o.value = k;
        o.textContent = k;
        return o;
      }));
      if (!numeric.includes(chosen)) chosen = PREFERRED.find((k) => numeric.includes(k)) || numeric[0] || null;
      if (chosen) select.value = chosen;
      select.hidden = numeric.length < 2;
    }

    function push(line) {
      const p = parseLine(line);
      if (!p) return;
      rows.push(p);
      if (rows.length > MAX_ROWS) rows.shift();
      let changed = false;
      for (const k of Object.keys(p.numbers)) if (!numeric.includes(k)) { numeric.push(k); changed = true; }
      for (const k of Object.keys(p.flags)) if (!flagNames.includes(k)) { flagNames.push(k); changed = true; }
      if (changed) fieldsChanged();
      if (!numeric.length && !flagNames.length) return;
      box.hidden = false;
      schedule();
    }

    // A timer, not requestAnimationFrame: the plot must also fill in while the tab is in the background.
    function schedule() { if (!pending) pending = setTimeout(draw, 60); }

    function reset() {
      rows = []; numeric = []; flagNames = []; chosen = null;
      box.hidden = true;
      legend.textContent = "";
    }

    function draw() {
      pending = 0;
      if (box.hidden || !canvas.clientWidth) return;
      const css = getComputedStyle(document.body);
      const color = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
      const dpr = global.devicePixelRatio || 1;
      const W = canvas.clientWidth, H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      const g = canvas.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.font = "11px system-ui, sans-serif";

      const left = 44, right = 8, top = 12;
      const stripH = 10, stripGap = 4;
      const bottom = 8 + (flagNames.length ? 6 : 0) + flagNames.length * (stripH + stripGap);
      const plotH = Math.max(20, H - top - bottom), plotW = W - left - right;
      const x = (i) => left + (rows.length < 2 ? plotW : (i / (rows.length - 1)) * plotW);

      const values = chosen ? rows.map((r) => r.numbers[chosen]) : [];
      const present = values.filter((v) => typeof v === "number" && isFinite(v));
      if (present.length) {
        const [lo, hi] = niceRange(Math.min(...present), Math.max(...present));
        const y = (v) => top + plotH - ((v - lo) / (hi - lo)) * plotH;
        g.strokeStyle = color("--line", "#ddd");
        g.fillStyle = color("--muted", "#666");
        g.lineWidth = 1;
        for (let t = 0; t <= 2; t++) {          // three grid lines with their values
          const v = lo + ((hi - lo) * t) / 2, yy = Math.round(y(v)) + 0.5;
          g.beginPath(); g.moveTo(left, yy); g.lineTo(W - right, yy); g.stroke();
          g.textAlign = "right"; g.textBaseline = "middle";
          g.fillText(Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1), left - 6, yy);
        }
        g.strokeStyle = color("--accent", "#2a7");
        g.lineWidth = 2;
        g.beginPath();
        let started = false;
        values.forEach((v, i) => {
          if (typeof v !== "number" || !isFinite(v)) return;
          if (started) g.lineTo(x(i), y(v)); else { g.moveTo(x(i), y(v)); started = true; }
        });
        g.stroke();
        const last = present[present.length - 1];
        legend.textContent = `${chosen}: ${last} now · lowest ${Math.min(...present)} · highest ${Math.max(...present)} · newest on the right`;
      } else {
        legend.textContent = flagNames.length ? "ON and OFF over time · newest on the right" : "";
      }

      flagNames.forEach((name, n) => {          // ON/OFF strips under the curve
        const yy = top + plotH + 12 + n * (stripH + stripGap);
        g.fillStyle = color("--muted", "#666");
        g.textAlign = "right"; g.textBaseline = "middle";
        g.fillText(name, left - 6, yy + stripH / 2);
        g.fillStyle = color("--line", "#ddd");
        g.fillRect(left, yy, plotW, stripH);
        g.fillStyle = color("--accent", "#2a7");
        const step = rows.length < 2 ? plotW : plotW / (rows.length - 1);
        g.save();
        g.beginPath(); g.rect(left, yy, plotW, stripH); g.clip();
        rows.forEach((r, i) => { if (r.flags[name]) g.fillRect(x(i) - step / 2, yy, Math.max(1, step), stripH); });
        g.restore();
      });
    }

    select.addEventListener("change", () => { chosen = select.value; draw(); });
    global.addEventListener("resize", schedule);
    return { push, reset, redraw: schedule };
  }

  global.SproutPlot = { create, parseLine };
})(window);
