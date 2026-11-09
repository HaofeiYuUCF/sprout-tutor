/* SPROUT Web Lab simulator: wire the card's parts on a breadboard and run the student's own
 * compiled program on an emulated ATmega328P (avr8js, MIT). Drawings and circuit rules are our own.
 *
 * Parts (from the ELEGOO starter kit) follow the selected card's parts list: LED, 220 ohm / 1k /
 * 10k resistors, 10k NTC thermistor, PN2222 transistor, 1N4007 diode, DC fan motor, active buzzer.
 *
 * Circuit model: every pin and breadboard hole belongs to a base net (a breadboard column strip,
 * a power rail, or an UNO pin). Wires merge nets. Each output is judged by a small rule set
 * (LED loop, transistor fan switch, buzzer polarity) and the thermistor divider gives a voltage
 * on its analog pin. There is no current physics: missing resistors, missing diodes and shorts
 * are reported as rule-based warnings.
 */
import {
  CPU, avrInstruction, AVRTimer, timer0Config, timer1Config, timer2Config,
  AVRIOPort, portBConfig, portCConfig, portDConfig, AVRUSART, usart0Config, PinState,
  AVRADC, adcConfig,
} from "./vendor/avr8js/index.js";

const NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);
const svg = $("sim-svg");
if (svg) init();

function init() {
  // ------------------------------------------------------------------ geometry
  const STEP = 20;
  const COLS = 24;
  const BBX = 430;                       // x of column 1
  const ROW_Y = { a: 112, b: 132, c: 152, d: 172, e: 192, f: 232, g: 252, h: 272, i: 292, j: 312 };
  const RAIL_Y = { "T-": 58, "T+": 78, "B+": 346, "B-": 366 };
  const UNO = { x: 20, y: 130, w: 340, h: 220 };   // below a two-row parts tray
  const TOP = [["GND", 112], ["D13", 128], ["D12", 144], ["D11", 160], ["D10", 176], ["D9", 192],
    ["D8", 208], ["D7", 240], ["D6", 256], ["D5", 272], ["D4", 288], ["D3", 304], ["D2", 320]];
  const BOTTOM = [["5V", 144], ["GND", 160], ["GND", 176], ["A0", 240], ["A1", 256], ["A2", 272],
    ["A3", 288], ["A4", 304], ["A5", 320]];
  const LEGS = {                                       // leg x offsets from the first leg
    led: [0, STEP], r220: [0, STEP * 4], r1k: [0, STEP * 4], r10k: [0, STEP * 4],
    thm: [0, STEP * 2], npn: [0, STEP, STEP * 2], diode: [0, STEP * 2], motor: [0, STEP * 2], buzzer: [0, STEP],
  };
  const SPAN = (k) => LEGS[k][LEGS[k].length - 1];
  const ORDER = ["led", "r220", "thm", "r10k", "r1k", "npn", "diode", "motor", "buzzer"];
  const NAMES = { led: "LED", r220: "220 Ω resistor", r1k: "1k resistor", r10k: "10k resistor",
    thm: "thermistor", npn: "transistor", diode: "diode", motor: "fan motor", buzzer: "buzzer" };
  const RES = { r220: { ohms: 220, label: "220 Ω", bands: ["#d22", "#d22", "#7a4a12"] },
    r1k: { ohms: 1000, label: "1k", bands: ["#7a4a12", "#111", "#d22"] },
    r10k: { ohms: 10000, label: "10k", bands: ["#7a4a12", "#111", "#e8862a"] } };
  const FLIPPABLE = new Set(["led", "npn", "diode", "buzzer"]);

  const terms = new Map();   // id -> { x, y, net, label }
  const holeAt = new Map();  // "x,y" -> hole id (breadboard and rails only)

  const el = (tag, attrs = {}, parent = null) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };

  // ------------------------------------------------------------------ static drawing
  const defs = el("defs", {}, svg);
  const glow = el("filter", { id: "sim-glow", x: "-100%", y: "-100%", width: "300%", height: "300%" }, defs);
  el("feGaussianBlur", { stdDeviation: "5", result: "b" }, glow);
  const merge = el("feMerge", {}, glow);
  el("feMergeNode", { in: "b" }, merge);
  el("feMergeNode", { in: "SourceGraphic" }, merge);

  const gBoard = el("g", { class: "sim-board" }, svg);
  const gBB = el("g", { class: "sim-bb" }, svg);
  const gWires = el("g", { class: "sim-wires" }, svg);
  const gParts = el("g", { class: "sim-parts" }, svg);
  const gOverlay = el("g", { class: "sim-overlay", "pointer-events": "none" }, svg);

  // UNO (simplified, our own drawing)
  const U = UNO.y;
  el("rect", { x: UNO.x, y: U, width: UNO.w, height: UNO.h, rx: 10, class: "uno" }, gBoard);
  el("rect", { x: UNO.x - 12, y: U + 30, width: 46, height: 40, rx: 3, class: "uno-usb" }, gBoard);
  el("rect", { x: UNO.x - 8, y: U + 150, width: 40, height: 42, rx: 4, class: "uno-jack" }, gBoard);
  el("rect", { x: 170, y: U + 120, width: 150, height: 36, rx: 3, class: "uno-chip" }, gBoard);
  el("text", { x: 245, y: U + 143, class: "uno-chip-label" }, gBoard).textContent = "ATmega328P";
  el("text", { x: 110, y: U + 100, class: "uno-name" }, gBoard).textContent = "UNO";
  el("rect", { x: 104, y: U + 6, width: 224, height: 18, rx: 2, class: "uno-header" }, gBoard);
  el("rect", { x: 136, y: U + UNO.h - 24, width: 192, height: 18, rx: 2, class: "uno-header" }, gBoard);
  const builtinLed = el("rect", { x: 124, y: U + 48, width: 10, height: 6, rx: 1, class: "uno-led" }, gBoard);
  el("text", { x: 140, y: U + 55, class: "uno-small" }, gBoard).textContent = "L";

  const addPin = (name, x, y, labelBelow, i) => {
    const id = `pin:${name}:${i}`;
    terms.set(id, { x, y, net: name, label: `UNO ${name}` });
    el("rect", { x: x - 5, y: y - 5, width: 10, height: 10, class: "term pin", "data-term": id }, gBoard);
    const t = el("text", { x, y: labelBelow ? y + 20 : y - 11, class: "pin-label" }, gBoard);
    t.textContent = name.replace(/^D/, "");
  };
  TOP.forEach(([n, x], i) => addPin(n, x, U + 15, true, i));
  BOTTOM.forEach(([n, x], i) => addPin(n, x, U + UNO.h - 15, false, 100 + i));
  el("text", { x: 216, y: U + 50, class: "uno-small" }, gBoard).textContent = "DIGITAL";
  el("text", { x: 280, y: U + UNO.h - 44, class: "uno-small" }, gBoard).textContent = "ANALOG IN";
  el("text", { x: 20, y: 40, class: "tray-label" }, gBoard).textContent = "Parts:";

  // Breadboard
  el("rect", { x: BBX - 26, y: 36, width: STEP * COLS + 32, height: 352, rx: 6, class: "bb" }, gBB);
  el("rect", { x: BBX - 26, y: 202, width: STEP * COLS + 32, height: 20, class: "bb-channel" }, gBB);
  for (const [k, y] of Object.entries(RAIL_Y)) {
    const neg = k.endsWith("-");
    el("line", { x1: BBX - 10, y1: y + (neg ? -9 : 9), x2: BBX + STEP * (COLS - 1) + 10, y2: y + (neg ? -9 : 9),
      class: neg ? "rail-neg" : "rail-pos" }, gBB);
    el("text", { x: BBX - 18, y: y + 4, class: "bb-label" }, gBB).textContent = neg ? "−" : "+";
  }
  for (const [r, y] of Object.entries(ROW_Y)) el("text", { x: BBX - 18, y: y + 4, class: "bb-label" }, gBB).textContent = r;
  const hole = (id, x, y, net, label) => {
    terms.set(id, { x, y, net, label });
    holeAt.set(`${x},${y}`, id);
    el("rect", { x: x - 4, y: y - 4, width: 8, height: 8, rx: 1.5, class: "term hole", "data-term": id }, gBB);
  };
  for (let c = 1; c <= COLS; c++) {
    const x = BBX + (c - 1) * STEP;
    if (c % 5 === 0 || c === 1) el("text", { x, y: 100, class: "bb-label" }, gBB).textContent = String(c);
    for (const [r, y] of Object.entries(ROW_Y)) hole(`bb:${c}:${r}`, x, y, `col${c}${"abcde".includes(r) ? "T" : "B"}`, `hole ${r}${c}`);
    for (const [k, y] of Object.entries(RAIL_Y)) hole(`rail:${k}:${c}`, x, y, `rail${k}`, `${k[0] === "T" ? "top" : "bottom"} ${k[1] === "+" ? "+ (5V)" : "− (GND)"} rail`);
  }

  // ------------------------------------------------------------------ parts
  let parts = {};
  let partEls = {};
  let home = {};
  let scenario = { kinds: ["led", "r220"], title: "LED test", cardId: null };

  /** Two rows above the UNO; each part gets a slot wide enough for its legs. */
  function layoutTray(kinds) {
    const out = {};
    let x = 70, row = 0;
    for (const k of kinds) {
      const w = SPAN(k) + 34;
      if (x + SPAN(k) > 390 && row === 0) { row = 1; x = 70; }
      out[k] = { x, y: row === 0 ? 34 : 86 };
      x += w;
    }
    return out;
  }

  function resetParts() {
    home = layoutTray(scenario.kinds);
    parts = {};
    for (const k of scenario.kinds) parts[k] = { kind: k, ...home[k], flipped: false, legs: null, on: false };
  }

  function drawParts() {
    gParts.replaceChildren();
    partEls = {};
    for (const p of Object.values(parts)) {
      const g = el("g", { class: `part ${p.kind}${p.legs ? "" : " loose"}`, transform: `translate(${p.x},${p.y})`,
        "data-part": p.kind }, gParts);
      const span = SPAN(p.kind);
      if (p.kind === "led") {
        const a = p.flipped ? STEP : 0;          // anode (long leg)
        const k = p.flipped ? 0 : STEP;
        el("circle", { cx: STEP / 2, cy: 0, r: 13, class: "led-rim" }, g);
        el("line", { x1: k + (k ? 3 : -3), y1: -10, x2: k + (k ? 3 : -3), y2: 10, class: "led-flat" }, g);
        el("circle", { cx: STEP / 2, cy: 0, r: 10, class: `led-body${p.on ? " lit" : ""}`, filter: p.on ? "url(#sim-glow)" : "" }, g);
        el("text", { x: a + (a ? 12 : -12), y: 4, class: "led-plus" }, g).textContent = "+";
      } else if (RES[p.kind]) {
        const r = RES[p.kind];
        el("line", { x1: 0, y1: 0, x2: span, y2: 0, class: "lead" }, g);
        el("rect", { x: 22, y: -7, width: 36, height: 14, rx: 6, class: "res-body" }, g);
        [...r.bands, "#c9a227"].forEach((c, i) => el("rect", { x: 28 + i * 7, y: -7, width: 3.5, height: 14, fill: c }, g));
        el("text", { x: 40, y: -11, class: "part-label" }, g).textContent = r.label;
      } else if (p.kind === "thm") {
        el("polyline", { points: `0,0 14,-6 26,-6 ${span},0`, class: "lead", fill: "none" }, g);
        el("circle", { cx: STEP, cy: -7, r: 7, class: "thm-bead" }, g);
        el("text", { x: STEP, y: -17, class: "part-label" }, g).textContent = "thermistor";
      } else if (p.kind === "npn") {
        const body = el("g", p.flipped ? { transform: `rotate(180 ${STEP} 0)` } : {}, g);
        el("path", { d: "M-8,7 L48,7 L48,-1 A28,13 0 0 0 -8,-1 Z", class: "npn-body" }, body);
        el("text", { x: STEP, y: p.flipped ? 4 : 2, class: "npn-label", transform: p.flipped ? `rotate(180 ${STEP} 0)` : "" }, g).textContent = "PN2222";
        (p.flipped ? ["C", "B", "E"] : ["E", "B", "C"]).forEach((n, i) => {
          el("text", { x: LEGS.npn[i], y: 21, class: "pin-tag" }, g).textContent = n;
        });
      } else if (p.kind === "diode") {
        el("line", { x1: 0, y1: 0, x2: span, y2: 0, class: "lead" }, g);
        el("rect", { x: 8, y: -6, width: 24, height: 12, rx: 2, class: "diode-body" }, g);
        el("rect", { x: p.flipped ? 10 : 26, y: -6, width: 4, height: 12, class: "diode-band" }, g); // stripe = cathode
      } else if (p.kind === "motor") {
        el("rect", { x: -6, y: -11, width: span + 12, height: 20, rx: 9, class: "motor-body" }, g);
        const at = el("g", { transform: `translate(${STEP},-1)` }, g);  // position; the inner group spins
        const fan = el("g", { class: `motor-fan${p.on ? " spin" : ""}` }, at);
        for (const a of [0, 120, 240]) el("ellipse", { cx: 0, cy: -6, rx: 3, ry: 6, transform: `rotate(${a})`, class: "fan-blade" }, fan);
        el("circle", { cx: 0, cy: 0, r: 2, class: "fan-hub" }, fan);
      } else if (p.kind === "buzzer") {
        el("circle", { cx: STEP / 2, cy: 0, r: 12, class: `buzzer-body${p.on ? " on" : ""}` }, g);
        el("circle", { cx: STEP / 2, cy: 0, r: 3, class: "buzzer-hole" }, g);
        el("text", { x: (p.flipped ? STEP : 0) + (p.flipped ? 13 : -13), y: 4, class: "led-plus" }, g).textContent = "+";
        if (p.on) for (const r of [17, 23]) el("path", { d: `M${STEP / 2 + r * 0.7},${-r * 0.7} A${r},${r} 0 0 1 ${STEP / 2 + r * 0.7},${r * 0.7}`, class: "buzz-wave" }, g);
      }
      if (["r220", "r1k", "r10k", "thm", "npn", "diode", "motor"].includes(p.kind)) {
        for (const lx of LEGS[p.kind]) el("circle", { cx: lx, cy: 0, r: 3, class: "leg-tip" }, g);
      }
      // Invisible hit area: only the part itself, so the holes in the rows above and below stay clickable.
      el("rect", { x: -9, y: -13, width: span + 18, height: 22, class: "part-hit" }, g);
      partEls[p.kind] = g;
    }
  }

  function legTerms(p, x = p.x, y = p.y) {
    const ids = LEGS[p.kind].map((dx) => holeAt.get(`${x + dx},${y}`));
    return ids.every(Boolean) ? ids : null;
  }

  function snap(p) {
    let best = null;
    let bestD = 14 * 14;
    for (const id of holeAt.values()) {
      const t = terms.get(id);
      const d = (t.x - p.x) ** 2 + (t.y - p.y) ** 2;
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best) {
      const legs = legTerms(p, best.x, best.y);
      const taken = Object.values(parts).filter((q) => q !== p && q.legs).flatMap((q) => q.legs);
      if (legs && !legs.some((id) => taken.includes(id))) {
        p.x = best.x; p.y = best.y; p.legs = legs;
        return;
      }
    }
    p.legs = null;
  }

  // ------------------------------------------------------------------ save / restore
  function serialize() {
    const ps = {};
    for (const [k, q] of Object.entries(parts)) ps[k] = { x: q.x, y: q.y, flipped: !!q.flipped };
    return { v: 2, parts: ps, wires: wires.map((w) => [w.a, w.b, w.color]), temp: temperature() };
  }

  function applySaved(saved) {
    if (!saved || typeof saved !== "object") return;
    for (const [k, q] of Object.entries(saved.parts || {})) {
      const part = parts[k];
      if (!part || typeof q.x !== "number" || typeof q.y !== "number") continue;
      Object.assign(part, { x: q.x, y: q.y, flipped: !!q.flipped });
      part.legs = legTerms(part);
      if (!part.legs) Object.assign(part, home[k]); // a loose part goes back to the tray
    }
    wires = (saved.wires || []).filter((w) => Array.isArray(w) && terms.has(w[0]) && terms.has(w[1]))
      .map(([a, b, color]) => ({ a, b, color: typeof color === "string" ? color : wireColor(a, b) }));
    if (typeof saved.temp === "number" && $("sim-temp")) {
      $("sim-temp").value = String(saved.temp);
      $("sim-temp-val").textContent = `${temperature()} °C`;
    }
    drawParts(); drawWires(); refresh(true);
  }

  function notifyChange() {
    document.dispatchEvent(new CustomEvent("sprout:simchange", { detail: serialize() }));
  }

  // ------------------------------------------------------------------ wires
  let wires = [];
  let pending = null;
  let selected = null;
  const PALETTE = ["#e8862a", "#2f9e44", "#1c7ed6", "#c2a400", "#9c36b5"];
  let paletteIdx = 0;

  const wireColor = (a, b) => {
    const ns = [terms.get(a).net, terms.get(b).net];
    if (ns.some((n) => n === "GND" || n.endsWith("-"))) return "#222";
    if (ns.some((n) => n === "5V" || n.endsWith("+"))) return "#d6336c";
    return PALETTE[paletteIdx++ % PALETTE.length];
  };

  function wirePath(a, b) {
    const p = terms.get(a), q = terms.get(b);
    const sag = Math.min(60, Math.hypot(q.x - p.x, q.y - p.y) / 4);
    return `M${p.x},${p.y} C${p.x},${p.y - sag} ${q.x},${q.y - sag} ${q.x},${q.y}`;
  }

  function drawWires() {
    gWires.replaceChildren();
    wires.forEach((w, i) => {
      el("path", { d: wirePath(w.a, w.b), class: "wire-shadow" }, gWires);
      el("path", { d: wirePath(w.a, w.b), class: `wire${selected === i ? " selected" : ""}`, stroke: w.color, "data-wire": String(i) }, gWires);
      for (const t of [w.a, w.b]) {
        const p = terms.get(t);
        el("circle", { cx: p.x, cy: p.y, r: 3.5, class: "wire-end", fill: w.color }, gWires);
      }
    });
    $("sim-delete").disabled = selected === null;
  }

  // ------------------------------------------------------------------ circuit rules
  function nets() {
    const parent = new Map();
    const find = (n) => {
      if (!parent.has(n)) parent.set(n, n);
      let r = n;
      while (parent.get(r) !== r) r = parent.get(r);
      while (parent.get(n) !== r) { const nx = parent.get(n); parent.set(n, r); n = nx; }
      return r;
    };
    for (const w of wires) parent.set(find(terms.get(w.a).net), find(terms.get(w.b).net));
    return find;
  }

  const thermistorOhms = (tC) => 10000 * Math.exp(3950 * (1 / (tC + 273.15) - 1 / 298.15));
  function temperature() { const s = $("sim-temp"); return s ? Number(s.value) : 24; }

  /** Judge every part. level(name) gives "H", "L" or null for 5V, GND and D2-D13. */
  function evaluate(level) {
    const find = nets();
    const sources = ["5V", "GND", ...Array.from({ length: 12 }, (_, i) => `D${i + 2}`)];
    const pot = new Map();
    const names = new Map();
    const addName = (s) => {
      const r = find(s);
      if (!names.has(r)) names.set(r, []);
      names.get(r).push(s);
      return r;
    };
    for (const s of sources) {
      const r = addName(s);
      const lv = level(s);
      if (!lv) continue;
      if (!pot.has(r)) pot.set(r, new Set());
      pot.get(r).add(lv);
    }
    for (let i = 0; i < 6; i++) addName(`A${i}`);
    const shorts = [...pot.entries()].filter(([, s]) => s.has("H") && s.has("L")).map(([r]) => names.get(r));
    const has = (n, lv) => !!n && (pot.get(n) || new Set()).has(lv);
    const nameIn = (n, re) => (names.get(n) || []).find((x) => re.test(x)) || null;
    const legNet = (p, i) => find(terms.get(p.legs[i]).net);
    const placed = (k) => !!(parts[k] && parts[k].legs);
    // nets on the other side of each placed resistor (r -> {a, b})
    const resistors = ["r220", "r1k", "r10k"].filter(placed).map((k) => ({ k, a: legNet(parts[k], 0), b: legNet(parts[k], 1) }));
    const across = (n, kinds) => resistors.filter((r) => (!kinds || kinds.includes(r.k)) && r.a !== r.b)
      .flatMap((r) => (r.a === n ? [r.b] : r.b === n ? [r.a] : []));
    const out = { shorts, led: null, therm: null, fan: null, buzzer: null };

    // --- LED with a series resistor
    if (parts.led) {
      const s = { placed: placed("led"), lit: false, noResistor: false, reversed: false, shorted: false, signal: null, toGround: false };
      if (s.placed) {
        const anode = legNet(parts.led, parts.led.flipped ? 1 : 0), cathode = legNet(parts.led, parts.led.flipped ? 0 : 1);
        if (anode === cathode) s.shorted = true;
        else {
          const viaA = across(anode), viaK = across(cathode);
          const direct = has(anode, "H") && has(cathode, "L");
          const withRes = (viaA.some((n) => has(n, "H")) && has(cathode, "L")) || (has(anode, "H") && viaK.some((n) => has(n, "L")));
          const back = (has(cathode, "H") && has(anode, "L")) || (viaK.some((n) => has(n, "H")) && has(anode, "L")) ||
            (has(cathode, "H") && viaA.some((n) => has(n, "L")));
          s.lit = (direct || withRes) && !shorts.length;
          s.noResistor = direct;
          s.reversed = !direct && !withRes && back;
          const sig = (n) => nameIn(n, /^(D\d+|5V)$/);
          s.signal = sig(anode) || viaA.map(sig).find(Boolean) || sig(cathode) || viaK.map(sig).find(Boolean) || null;
          s.toGround = [anode, cathode, ...viaA, ...viaK].some((n) => has(n, "L"));
        }
      }
      out.led = s;
    }

    // --- thermistor divider: 5V -> thermistor -> A pin -> 10k -> GND
    if (parts.thm) {
      const s = { placed: placed("thm"), partner: placed("r10k"), outPin: null, outChannel: null, volts: 0, state: "open" };
      if (s.placed) {
        const t0 = legNet(parts.thm, 0), t1 = legNet(parts.thm, 1);
        const rt = thermistorOhms(temperature());
        const is5 = (n) => (names.get(n) || []).includes("5V");
        const isG = (n) => (names.get(n) || []).includes("GND");
        let f0 = null, f1 = null;
        if (s.partner) { f0 = legNet(parts.r10k, 0); f1 = legNet(parts.r10k, 1); }
        const shared = s.partner ? [t0, t1].find((n) => n === f0 || n === f1) : null;
        if (shared) {
          const tOther = shared === t0 ? t1 : t0, fOther = shared === f0 ? f1 : f0;
          s.outPin = nameIn(shared, /^A\d$/);
          if (is5(tOther) && isG(fOther)) { s.state = "ok"; s.volts = 5 * 10000 / (10000 + rt); }
          else if (isG(tOther) && is5(fOther)) { s.state = "swapped"; s.volts = 5 * rt / (10000 + rt); }
          else if (is5(tOther)) { s.state = "no_ground"; s.volts = 5; }
          else if (isG(fOther)) { s.state = "no_5v"; s.volts = 0; }
        } else {
          const pinNet = [t0, t1].find((n) => nameIn(n, /^A\d$/));
          if (pinNet) {
            s.outPin = nameIn(pinNet, /^A\d$/);
            const other = pinNet === t0 ? t1 : t0;
            if (is5(other)) { s.state = "no_partner"; s.volts = 5; }
          }
        }
        s.outChannel = s.outPin ? Number(s.outPin.slice(1)) : null;
      }
      out.therm = s;
    }

    // --- fan: pin -> 1k -> base; motor between 5V and collector; emitter to GND; diode across motor
    if (parts.motor) {
      const s = { placed: placed("motor"), npn: placed("npn"), spinning: false, signal: null, problem: null, diode: "missing" };
      if (s.placed) {
        const m0 = legNet(parts.motor, 0), m1 = legNet(parts.motor, 1);
        const is5 = (n) => (names.get(n) || []).includes("5V");
        const pinOn = (n) => nameIn(n, /^D\d+$/);
        if ((pinOn(m0) && has(m1, "L")) || (pinOn(m1) && has(m0, "L"))) s.problem = "motor_on_pin";
        if (s.npn && !s.problem) {
          const flip = parts.npn.flipped;
          const E = legNet(parts.npn, flip ? 2 : 0), B = legNet(parts.npn, 1), C = legNet(parts.npn, flip ? 0 : 2);
          const viaB = across(B, ["r1k", "r220", "r10k"]);
          s.signal = pinOn(B) || viaB.map(pinOn).find(Boolean) || null;
          const baseHigh = has(B, "H") || viaB.some((n) => has(n, "H"));
          const motorOnC = (is5(m0) && m1 === C) || (is5(m1) && m0 === C);
          const motorOnE = (is5(m0) && m1 === E) || (is5(m1) && m0 === E);
          if (s.signal && pinOn(B)) s.problem = "no_base_resistor";
          if (has(C, "L") && !has(E, "L") && (motorOnE || baseHigh)) s.problem = s.problem || "transistor_reversed";
          if (parts.diode && parts.diode.legs) {
            const anode = legNet(parts.diode, parts.diode.flipped ? 1 : 0), cathode = legNet(parts.diode, parts.diode.flipped ? 0 : 1);
            const motorNets = [m0, m1];
            if (motorNets.includes(anode) && motorNets.includes(cathode) && anode !== cathode) {
              s.diode = is5(cathode) ? "ok" : "reversed";
            }
          }
          const on = baseHigh && has(E, "L") && motorOnC && s.problem !== "transistor_reversed";
          s.spinning = on && s.diode !== "reversed" && !shorts.length;
          s.wired = motorOnC && !!s.signal && (has(E, "L") || (names.get(E) || []).includes("GND"));
        }
      }
      out.fan = s;
    }

    // --- active buzzer: + leg on the pin side, - leg on GND
    if (parts.buzzer) {
      const s = { placed: placed("buzzer"), on: false, reversed: false, signal: null };
      if (s.placed) {
        const plus = legNet(parts.buzzer, parts.buzzer.flipped ? 1 : 0), minus = legNet(parts.buzzer, parts.buzzer.flipped ? 0 : 1);
        s.on = has(plus, "H") && has(minus, "L") && !shorts.length;
        s.reversed = !s.on && has(minus, "H") && has(plus, "L");
        s.signal = nameIn(plus, /^D\d+$/) || nameIn(minus, /^D\d+$/);
        s.toGround = has(minus, "L") || has(plus, "L");
      }
      out.buzzer = s;
    }
    return out;
  }

  // ------------------------------------------------------------------ emulator
  let run = null;

  function pinLevel(name) {
    if (name === "5V") return "H";
    if (name === "GND") return "L";
    if (!run) return null;
    const n = Number(name.slice(1));
    const port = n < 8 ? run.portD : run.portB;
    const s = port.pinState(n < 8 ? n : n - 8);
    return s === PinState.High ? "H" : s === PinState.Low ? "L" : null;
  }

  async function start(test = null) {
    stop();
    for (const id of ["sim-run", "sim-test"]) $(id).disabled = true;
    setStatus(test ? "Preparing the wiring test…" : "Checking your code…");
    let compiled = null;
    try {
      compiled = test ? await window.SproutLab.compileCode(test.code) : await window.SproutLab.compile();
    } catch (e) {
      setStatus(`Could not prepare the program: ${e.message}`);
    }
    for (const id of ["sim-run", "sim-test"]) $(id).disabled = false;
    if (!compiled) {
      setStatus(test ? "The wiring test could not start. Ask your instructor."
        : "Your code has a problem. See the red message under your code, fix it, then run again.");
      return;
    }
    const image = window.SproutUpload.parseIntelHex(compiled.hex);
    const prog = new Uint16Array(0x4000);
    new Uint8Array(prog.buffer).set(image);
    const cpu = new CPU(prog);
    new AVRTimer(cpu, timer0Config);
    new AVRTimer(cpu, timer1Config);
    new AVRTimer(cpu, timer2Config);
    const portB = new AVRIOPort(cpu, portBConfig);
    const portC = new AVRIOPort(cpu, portCConfig);
    const portD = new AVRIOPort(cpu, portDConfig);
    const usart = new AVRUSART(cpu, usart0Config, 16e6);
    const adc = new AVRADC(cpu, adcConfig);
    run = { cpu, portB, portC, portD, usart, adc, driven: new Set(), adcRead: new Set(), test,
      seen: { led: false, fan: false, buzzer: false }, startedAt: performance.now(), last: performance.now(), speed: 1 };
    const readChannel = adc.onADCRead;
    adc.onADCRead = (input) => {
      if (typeof input.channel === "number") run.adcRead.add(input.channel);
      readChannel(input);
    };
    usart.onByteTransmit = (b) => {
      const ch = String.fromCharCode(b);
      const pre = $("sim-serial");
      pre.textContent = (pre.textContent + ch).slice(-4000);
      pre.scrollTop = pre.scrollHeight;
      window.SproutLab.feedSerial(ch);
    };
    $("sim-serial").textContent = "";
    window.SproutLab.resetSerial();
    $("sim-stop").disabled = false;
    setStatus(test ? "Wiring test running." : "Running your program on a simulated UNO.");
    if (!test && window.SproutLab.simStarted) window.SproutLab.simStarted();
    run.raf = setTimeout(() => frame(performance.now()), 0);
  }

  function frame(now) {
    if (!run) return;
    const ms = Math.min(50, now - run.last);
    run.last = now;
    const target = run.cpu.cycles + Math.round(ms * 16000);
    const t0 = performance.now();
    const begin = run.cpu.cycles;
    let n = 0;
    while (run.cpu.cycles < target) {
      avrInstruction(run.cpu);
      run.cpu.tick();
      if (++n % 20000 === 0 && performance.now() - t0 > 30) break; // stay responsive on slow machines
    }
    const want = ms * 16000;
    if (want > 0) run.speed = 0.9 * run.speed + 0.1 * Math.min(1, (run.cpu.cycles - begin) / want);
    for (let d = 2; d <= 13; d++) if (pinLevel(`D${d}`) === "H") run.driven.add(`D${d}`);
    setAnalogInputs();
    refresh();
    run.raf = setTimeout(() => frame(performance.now()), 16); // timers keep running when the pane is not painted
  }

  function setAnalogInputs() {
    if (!run) return;
    const t = evaluate(pinLevel).therm;
    for (let ch = 0; ch < 6; ch++) run.adc.channelValues[ch] = Math.random() * 0.02;
    if (t && t.outChannel !== null) run.adc.channelValues[t.outChannel] = Math.min(5, t.volts + (Math.random() - 0.5) * 0.004);
  }

  function stop() {
    if (run) clearTimeout(run.raf);
    run = null;
    $("sim-stop").disabled = true;
    refresh(true);
    setStatus("Stopped. Press Run to start your program.");
  }

  // ------------------------------------------------------------------ feedback
  function setStatus(text) { $("sim-status").textContent = text; }

  function feedback() {
    const items = [];
    const add = (kind, text) => items.push([kind, text]);
    const s = evaluate((n) => (n === "GND" ? "L" : "H"));   // wiring judged as if every pin could be HIGH
    for (const grp of s.shorts) add("warn", `Short circuit: ${grp.filter((x) => x !== "GND").join(", ")} is wired straight to GND. On a real board this can damage the pin.`);
    const res = (k, why) => {
      if (parts[k] && !parts[k].legs && scenario.kinds.includes(k)) add("todo", `Put the ${NAMES[k]} on the breadboard${why ? ` (${why})` : ""}.`);
    };

    if (s.led) {
      const l = s.led;
      // In the fan card the LED is only the first test: once the fan is wired, stop asking for it.
      if (!l.placed) { if (!(s.fan && s.fan.wired)) add("todo", "Put the LED on the breadboard (both legs in holes)."); }
      else if (l.shorted) add("warn", "Both LED legs are in the same column, so the LED is bypassed. Move one leg to another column.");
      else if (!s.shorts.length) {
        if (l.reversed) add("warn", "The LED is backwards. The long leg (+) must face the pin side. Double-click it to turn it around.");
        else if (l.lit && l.noResistor) add("warn", `The LED is wired from ${l.signal} without a resistor. On a real board this could burn out the LED.`);
        else if (l.lit) add("ok", `LED circuit complete: ${l.signal} → resistor → LED → GND. It lights when ${l.signal} is HIGH.`);
        else if (!l.signal) add("todo", "Connect the LED's long leg (+) side to a digital pin, through the 220 Ω resistor.");
        else if (!l.toGround) add("todo", "Connect the other side of the LED to GND.");
      }
      if (scenario.kinds.includes("r220") && !parts.motor) res("r220", "it protects the LED");
    }

    if (s.therm) {
      const t = s.therm;
      if (!t.placed) add("todo", "Put the thermistor on the breadboard (two legs, either way round).");
      else if (!t.partner) add("todo", "Put the 10k resistor on the breadboard: the thermistor needs it to make a voltage.");
      else if (t.state === "ok" && t.outPin) add("ok", `Thermistor divider on ${t.outPin}: about ${t.volts.toFixed(2)} V at ${temperature()} °C.`);
      else if (t.state === "ok") add("todo", "Connect the column shared by the thermistor and the 10k resistor to an analog pin, for example A0.");
      else if (t.state === "swapped") add("warn", "The thermistor and the 10k resistor have swapped places, so the reading will go down when it warms. Put the thermistor on the 5V side.");
      else if (t.state === "no_partner" || t.state === "no_ground") add("warn", "The reading will be stuck at the top: the 10k resistor must connect the A pin's column to GND.");
      else if (t.state === "no_5v") add("todo", "Connect the thermistor's other leg to 5V.");
      else add("todo", "Build the divider: 5V → thermistor → a column with a wire to A0 → 10k resistor → GND.");
    }

    if (s.fan) {
      const f = s.fan;
      if (!f.placed) add("todo", "Put the fan motor on the breadboard.");
      else if (f.problem === "motor_on_pin") add("warn", "Never wire the motor straight to a pin: a pin cannot give that much current. Switch it with the transistor.");
      else if (!f.npn) add("todo", "Put the transistor on the breadboard, flat face toward you: E, B, C from left to right.");
      else {
        if (f.problem === "transistor_reversed") add("warn", "The transistor is turned around: the emitter (E) must go to GND and the collector (C) to the motor. Double-click it to turn it.");
        if (f.problem === "no_base_resistor") add("warn", `The pin goes straight to the transistor's base. Put the 1k resistor between ${f.signal} and the middle leg.`);
        if (f.diode === "reversed") add("warn", "The diode is backwards: when the fan turns on it shorts 5V to GND. Its stripe must be on the 5V side. Double-click it to turn it.");
        if (f.wired && !f.problem) {
          if (f.diode === "ok") add("ok", `Fan circuit complete: ${f.signal} → 1k → transistor; motor between 5V and the collector; diode across the motor. The fan spins when ${f.signal} is HIGH.`);
          else if (f.diode === "missing") add("warn", "The fan will run, but put the diode across the motor (stripe on the 5V side). It protects the transistor and the UNO.");
        } else if (!f.problem) {
          if (!f.signal) add("todo", "Connect a digital pin (pin 9 in the card) to the transistor's middle leg (B) through the 1k resistor.");
          else add("todo", "Finish the fan circuit: one motor lead to 5V, the other to the transistor's right leg (C), and the left leg (E) to GND.");
        }
      }
      res("r1k", "between the pin and the transistor");
      if (!f.wired) res("diode", "across the motor");
    }

    if (s.buzzer) {
      const b = s.buzzer;
      if (!b.placed) add("todo", "Put the buzzer on the breadboard.");
      else if (b.reversed) add("warn", "The buzzer is backwards: its long leg (+) must face the pin, the short leg GND. Double-click it to turn it around.");
      else if (b.on) add("ok", `Buzzer wired: ${b.signal} → buzzer + ; buzzer − → GND.`);
      else if (!b.signal) add("todo", "Connect the buzzer's long leg (+) to a digital pin (pin 8 in the card).");
      else if (!b.toGround) add("todo", "Connect the buzzer's short leg to GND.");
    }

    // run-time checks: the code drives / reads a different pin than the wiring
    if (run && !run.test && performance.now() - run.startedAt > 2500) {
      const outputs = [[s.led && s.led.lit && s.led.signal, "LED"], [s.fan && s.fan.wired && s.fan.signal, "fan"],
        [s.buzzer && s.buzzer.on && s.buzzer.signal, "buzzer"]];
      for (const [pin, what] of outputs) {
        if (pin && pin !== "5V" && !run.driven.has(pin) && run.driven.size) {
          add("warn", `Your code switches ${[...run.driven].join(", ")}, but the ${what} is wired to ${pin}. Match the wire or the code.`);
        }
      }
      const th = s.therm;
      if (th && th.outChannel !== null && run.adcRead.size && !run.adcRead.has(th.outChannel)) {
        add("warn", `Your code reads ${[...run.adcRead].map((c) => `A${c}`).join(", ")}, but the thermistor is wired to ${th.outPin}.`);
      }
    }
    // wiring-test results go first
    if (run && run.test && performance.now() - run.startedAt > 1500) {
      const t = run.test;
      const top = [];
      if (t.led) top.push(run.seen.led ? ["ok", `Wiring test: the LED on ${t.led} blinks. Your LED wiring works.`] : ["warn", `Wiring test: ${t.led} blinks, but the LED never lit.`]);
      if (t.fan) top.push(run.seen.fan ? ["ok", `Wiring test: the fan on ${t.fan} turns on and off. Your fan wiring works.`] : ["warn", `Wiring test: ${t.fan} switches, but the fan never turned.`]);
      if (t.buzzer) top.push(run.seen.buzzer ? ["ok", `Wiring test: the buzzer on ${t.buzzer} beeps. Your buzzer wiring works.`] : ["warn", `Wiring test: ${t.buzzer} switches, but the buzzer never sounded.`]);
      if (t.analog) top.push(s.therm && s.therm.state === "ok" ? ["ok", `Wiring test: the thermistor on ${t.analog} reports a temperature (see the messages). Move the slider to watch it change.`]
        : ["warn", "Wiring test: the thermistor is not giving a sensible reading yet. Check the tips below."]);
      items.unshift(...top);
    }
    $("sim-feedback").replaceChildren(...items.map(([k, t]) => {
      const li = document.createElement("li");
      li.className = k;
      li.textContent = `${k === "ok" ? "✓" : k === "warn" ? "⚠" : "○"} ${t}`;
      return li;
    }));
  }

  let lastFeedback = 0;
  function refresh(force = false) {
    const live = evaluate(pinLevel);
    const states = { led: !!(live.led && live.led.lit), motor: !!(live.fan && live.fan.spinning), buzzer: !!(live.buzzer && live.buzzer.on) };
    let changed = false;
    for (const [k, on] of Object.entries(states)) {
      if (parts[k] && parts[k].on !== on) { parts[k].on = on; changed = true; }
    }
    if (run) {
      if (states.led) run.seen.led = true;
      if (states.motor) run.seen.fan = true;
      if (states.buzzer) run.seen.buzzer = true;
    }
    if (changed) drawParts();
    builtinLed.classList.toggle("on", !!run && pinLevel("D13") === "H");
    const now = performance.now();
    if (force || now - lastFeedback > 300) {
      lastFeedback = now;
      feedback();
      if (run) setStatus(run.test ? "Wiring test running. Press Stop when you are done."
        : `Running your program on a simulated UNO (speed ${Math.round(run.speed * 100)}%).`);
    }
  }

  // ------------------------------------------------------------------ wiring test
  /** A tiny program that switches every wired output together and reports the thermistor. */
  function wiringTest() {
    const s = evaluate((n) => (n === "GND" ? "L" : "H"));
    const digital = (p) => (p && /^D\d+$/.test(p) ? p : null);
    const t = {
      led: s.led && s.led.lit ? digital(s.led.signal) : null,
      fan: s.fan && s.fan.wired && !s.fan.problem ? digital(s.fan.signal) : null,
      buzzer: s.buzzer && s.buzzer.on ? digital(s.buzzer.signal) : null,
      analog: s.therm && s.therm.outPin && s.therm.state === "ok" ? s.therm.outPin : null,
    };
    const pins = [...new Set([t.led, t.fan, t.buzzer].filter(Boolean).map((p) => p.slice(1)))];
    if (!pins.length && !t.analog) return null;
    const lines = ["void setup() {", "  Serial.begin(9600);", ...pins.map((n) => `  pinMode(${n}, OUTPUT);`), "}", "void loop() {",
      ...pins.map((n) => `  digitalWrite(${n}, HIGH);`)];
    if (t.analog) {
      lines.push(`  int raw = analogRead(${t.analog});`,
        "  float r = 10000.0 * (1023.0 / raw - 1.0);",
        "  float c = 1.0 / (1.0 / 298.15 + log(r / 10000.0) / 3950.0) - 273.15;",
        `  Serial.print("${t.analog} raw="); Serial.print(raw); Serial.print(" about "); Serial.print(c, 1); Serial.println(" C");`);
    } else {
      lines.push('  Serial.println("outputs on");');
    }
    lines.push("  delay(700);", ...pins.map((n) => `  digitalWrite(${n}, LOW);`));
    if (!t.analog) lines.push('  Serial.println("outputs off");');
    lines.push("  delay(700);", "}");
    t.code = lines.join("\n");
    return t;
  }

  function testWiring() {
    const t = wiringTest();
    if (!t) {
      setStatus("Wire a part first. The test needs at least one output connected to a pin and GND, or the thermistor divider connected to an analog pin.");
      refresh(true);
      return;
    }
    start(t);
  }

  /** A static copy of the student's board, used as the build picture on the real-board step. */
  function snapshot() {
    if (!Object.values(parts).some((q) => q.legs) && !wires.length) return null;
    const clone = svg.cloneNode(true);
    clone.removeAttribute("id");
    clone.setAttribute("aria-label", "Your wiring from the simulator");
    clone.querySelectorAll(".rubber").forEach((n) => n.remove());
    clone.querySelectorAll("[id]").forEach((n) => n.setAttribute("id", `${n.id}-copy`));
    clone.querySelectorAll("[filter]").forEach((n) => n.removeAttribute("filter"));
    clone.querySelectorAll(".spin").forEach((n) => n.classList.remove("spin"));
    return clone;
  }

  // ------------------------------------------------------------------ interaction
  const pt = (ev) => {
    const p = svg.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  };
  let drag = null;
  let rubber = null;

  svg.addEventListener("pointerdown", (ev) => {
    const partEl = ev.target.closest("[data-part]");
    if (partEl) {
      const p = parts[partEl.dataset.part];
      const q = pt(ev);
      drag = { p, dx: q.x - p.x, dy: q.y - p.y, moved: false };
      svg.setPointerCapture(ev.pointerId);
      return;
    }
    const wireEl = ev.target.closest("[data-wire]");
    if (wireEl) {
      selected = Number(wireEl.dataset.wire);
      pending = null;
      drawWires();
      drawRubber(null);
      return;
    }
    const termEl = ev.target.closest("[data-term]");
    if (termEl) {
      const id = termEl.dataset.term;
      if (!pending) {
        pending = id;
        selected = null;
        drawWires();
      } else if (id !== pending) {
        wires.push({ a: pending, b: id, color: wireColor(pending, id) });
        pending = null;
        drawWires();
        refresh(true);
        notifyChange();
      }
      drawRubber(ev);
      return;
    }
    pending = null;
    selected = null;
    drawWires();
    drawRubber(null);
  });

  svg.addEventListener("pointermove", (ev) => {
    if (drag) {
      const q = pt(ev);
      drag.p.x = Math.round(q.x - drag.dx);
      drag.p.y = Math.round(q.y - drag.dy);
      drag.moved = true;
      drag.p.legs = null;
      partEls[drag.p.kind].setAttribute("transform", `translate(${drag.p.x},${drag.p.y})`);
      partEls[drag.p.kind].classList.add("loose");
      return;
    }
    if (pending) drawRubber(ev);
  });

  svg.addEventListener("pointerup", () => {
    if (!drag) return;
    const moved = drag.moved;
    if (moved) snap(drag.p);
    drag = null;
    drawParts();
    refresh(true);
    if (moved) notifyChange();
  });

  svg.addEventListener("dblclick", (ev) => {
    const partEl = ev.target.closest("[data-part]");
    if (!partEl || !FLIPPABLE.has(partEl.dataset.part)) return;
    const p = parts[partEl.dataset.part];
    p.flipped = !p.flipped;
    drawParts();
    refresh(true);
    notifyChange();
  });

  function drawRubber(ev) {
    if (rubber) { rubber.remove(); rubber = null; }
    if (!pending || !ev) return;
    const a = terms.get(pending);
    const q = pt(ev);
    rubber = el("line", { x1: a.x, y1: a.y, x2: q.x, y2: q.y, class: "rubber" }, gOverlay);
  }

  function deleteSelected() {
    if (selected === null) return;
    wires.splice(selected, 1);
    selected = null;
    drawWires();
    refresh(true);
    notifyChange();
  }

  document.addEventListener("keydown", (ev) => {
    if (ev.target.closest && ev.target.closest("textarea, input, select")) return;
    if ((ev.key === "Delete" || ev.key === "Backspace") && selected !== null) {
      ev.preventDefault();
      deleteSelected();
    } else if (ev.key === "Escape") {
      pending = null; selected = null; drawWires(); drawRubber(null);
    }
  });

  // hover tooltip: the pin, hole or part under the pointer
  svg.addEventListener("mouseover", (ev) => {
    const termEl = ev.target.closest("[data-term]");
    const partEl = ev.target.closest("[data-part]");
    $("sim-hover").textContent = termEl ? terms.get(termEl.dataset.term).label
      : partEl ? `${NAMES[partEl.dataset.part]}${FLIPPABLE.has(partEl.dataset.part) ? " (double-click to turn around)" : ""}` : "";
  });

  $("sim-run").addEventListener("click", () => start());
  $("sim-test").addEventListener("click", testWiring);
  $("sim-stop").addEventListener("click", stop);
  $("sim-delete").addEventListener("click", deleteSelected);
  function resetAll() {
    stop();
    wires = []; pending = null; selected = null;
    resetParts();
    drawParts(); drawWires(); refresh(true);
  }
  $("sim-reset").addEventListener("click", () => { resetAll(); notifyChange(); });

  /** Switch the parts to match a card ({cardId, title, parts: ["1 × Thermistor (10k NTC)", ...], sim}). */
  function setScenario(card) {
    const list = (card && card.parts) || [];
    const want = {
      led: /\bLED\b/i, r220: /220 ohm/i, thm: /thermistor/i, r10k: /10k ohm/i, r1k: /(^|\D)1k ohm/i,
      npn: /transistor/i, diode: /diode/i, motor: /motor/i, buzzer: /buzzer/i,
    };
    const kinds = ORDER.filter((k) => list.some((x) => want[k].test(x)));
    scenario = kinds.length ? { kinds, title: card.title, cardId: card.cardId }
      : { kinds: ["led", "r220"], title: "LED test", cardId: null };
    $("sim-scenario").textContent = `${scenario.title} · parts: ${scenario.kinds.map((k) => NAMES[k]).join(", ")}`;
    $("sim-temp-box").hidden = !scenario.kinds.includes("thm");
    resetAll();
    if (card && card.sim) applySaved(card.sim);
  }
  document.addEventListener("sprout:card", (ev) => setScenario(ev.detail));
  $("sim-temp").addEventListener("input", () => {
    $("sim-temp-val").textContent = `${temperature()} °C`;
    refresh(true);
  });
  $("sim-temp").addEventListener("change", notifyChange);
  document.addEventListener("sprout:mode", (ev) => { if (ev.detail !== "sim" && run) stop(); });

  // ------------------------------------------------------------------ example wiring (test mode)
  const place = (k, col, row, flipped = false) => {
    if (!parts[k]) return;
    Object.assign(parts[k], { x: BBX + (col - 1) * STEP, y: ROW_Y[row], flipped });
    parts[k].legs = legTerms(parts[k]);
  };
  const W = (a, b) => wires.push({ a, b, color: wireColor(a, b) });
  const example = $("sim-example");
  if (example) {
    example.addEventListener("click", () => {
      resetAll();
      W("pin:GND:101", "rail:T-:2");
      W("pin:5V:100", "rail:T+:3");
      if (parts.motor) {
        // D9 -> a3; 1k c3-c7; PN2222 e6 e7 e8 (E B C); motor d8-d10; diode b8-b10 (stripe on 10); a6 -> GND; a10 -> 5V
        place("r1k", 3, "c"); place("npn", 6, "e"); place("motor", 8, "d"); place("diode", 8, "b");
        W("pin:D9:5", "bb:3:a"); W("bb:6:a", "rail:T-:6"); W("bb:10:a", "rail:T+:10");
      } else if (parts.led) {
        // D9 -> a5; LED c5(+) c6; 220 b6-b10; a10 -> GND
        place("led", 5, "c"); place("r220", 6, "b");
        W("pin:D9:5", "bb:5:a"); W("bb:10:a", "rail:T-:10");
      }
      if (parts.thm) {
        // 5V -> a14; thermistor c14-c16; 10k b16-b20; A0 -> a16; a20 -> GND
        place("thm", 14, "c"); place("r10k", 16, "b");
        W("bb:14:a", "rail:T+:14"); W("pin:A0:103", "bb:16:a"); W("bb:20:a", "rail:T-:20");
      }
      if (parts.buzzer) {
        // D8 -> a22; buzzer c22(+) c23; a23 -> GND
        place("buzzer", 22, "c");
        W("pin:D8:6", "bb:22:a"); W("bb:23:a", "rail:T-:23");
      }
      drawParts(); drawWires(); refresh(true);
      notifyChange();
    });
  }

  // test hooks
  window.SproutSim = {
    state: () => ({ wires: wires.map((w) => [w.a, w.b]), kinds: scenario.kinds, running: !!run,
      lit: !!(parts.led && parts.led.on), spinning: !!(parts.motor && parts.motor.on), beeping: !!(parts.buzzer && parts.buzzer.on) }),
    evaluate: () => evaluate(pinLevel),
    serialize: () => serialize(),
    snapshot: () => snapshot(),
    testWiring: () => testWiring(),
    place: (kind, holeId, flipped) => {
      const t = terms.get(holeId);
      if (!parts[kind] || !t) return false;
      Object.assign(parts[kind], { x: t.x, y: t.y });
      if (flipped !== undefined) parts[kind].flipped = flipped;
      snap(parts[kind]);
      drawParts(); refresh(true); notifyChange();
      return !!parts[kind].legs;
    },
    wire: (a, b) => { W(a, b); drawWires(); refresh(true); notifyChange(); },
  };

  setScenario(window.SproutLab && window.SproutLab.currentCard ? window.SproutLab.currentCard() : null);
  setStatus("Press Run to start your program. You can wire the parts before or while it runs.");
}
