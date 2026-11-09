/* SPROUT Web Lab simulator (LED test): wire an LED on a breadboard and run the student's own
 * compiled program on an emulated ATmega328P (avr8js, MIT). Drawings and circuit logic are our own.
 *
 * The parts follow the selected card (LED, 220 ohm resistor, TMP36), read from the card's parts list.
 *
 * Circuit model: every pin and breadboard hole belongs to a base net (a breadboard column strip,
 * a power rail, or an UNO pin). Wires merge nets. The LED lights when its anode side reaches a
 * HIGH net and its cathode side a LOW net, directly or through the resistor. No analog physics:
 * missing resistors and shorts are reported as rule-based warnings.
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
  const UNO = { x: 20, y: 70, w: 340, h: 220 };
  const TOP = [["GND", 112], ["D13", 128], ["D12", 144], ["D11", 160], ["D10", 176], ["D9", 192],
    ["D8", 208], ["D7", 240], ["D6", 256], ["D5", 272], ["D4", 288], ["D3", 304], ["D2", 320]];
  const BOTTOM = [["5V", 144], ["GND", 160], ["GND", 176], ["A0", 240], ["A1", 256], ["A2", 272],
    ["A3", 288], ["A4", 304], ["A5", 320]];
  const LEGS = { led: [0, STEP], res: [0, STEP * 4], tmp: [0, STEP, STEP * 2] }; // leg x offsets
  const SPAN = (k) => LEGS[k][LEGS[k].length - 1];
  const HOME = { led: { x: 70, y: 410 }, res: { x: 140, y: 410 }, tmp: { x: 270, y: 410 } };
  const NAMES = { led: "LED", res: "resistor", tmp: "TMP36" };

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
  el("rect", { x: UNO.x, y: UNO.y, width: UNO.w, height: UNO.h, rx: 10, class: "uno" }, gBoard);
  el("rect", { x: UNO.x - 12, y: UNO.y + 30, width: 46, height: 40, rx: 3, class: "uno-usb" }, gBoard);
  el("rect", { x: UNO.x - 8, y: UNO.y + 150, width: 40, height: 42, rx: 4, class: "uno-jack" }, gBoard);
  el("rect", { x: 170, y: 190, width: 150, height: 36, rx: 3, class: "uno-chip" }, gBoard);
  el("text", { x: 245, y: 213, class: "uno-chip-label" }, gBoard).textContent = "ATmega328P";
  el("text", { x: 110, y: 170, class: "uno-name" }, gBoard).textContent = "UNO";
  el("rect", { x: 104, y: UNO.y + 6, width: 224, height: 18, rx: 2, class: "uno-header" }, gBoard);
  el("rect", { x: 136, y: UNO.y + UNO.h - 24, width: 192, height: 18, rx: 2, class: "uno-header" }, gBoard);
  const builtinLed = el("rect", { x: 124, y: UNO.y + 48, width: 10, height: 6, rx: 1, class: "uno-led" }, gBoard);
  el("text", { x: 140, y: UNO.y + 55, class: "uno-small" }, gBoard).textContent = "L";

  const addPin = (name, x, y, labelBelow, i) => {
    const id = `pin:${name}:${i}`;
    terms.set(id, { x, y, net: name, label: name });
    el("rect", { x: x - 5, y: y - 5, width: 10, height: 10, class: "term pin", "data-term": id }, gBoard);
    const t = el("text", { x, y: labelBelow ? y + 20 : y - 11, class: "pin-label" }, gBoard);
    t.textContent = name.replace(/^D/, "");
  };
  TOP.forEach(([n, x], i) => addPin(n, x, UNO.y + 15, true, i));
  BOTTOM.forEach(([n, x], i) => addPin(n, x, UNO.y + UNO.h - 15, false, 100 + i));
  el("text", { x: 216, y: UNO.y + 50, class: "uno-small" }, gBoard).textContent = "DIGITAL";
  el("text", { x: 280, y: UNO.y + UNO.h - 44, class: "uno-small" }, gBoard).textContent = "ANALOG IN";

  // Breadboard
  el("rect", { x: BBX - 26, y: 36, width: STEP * COLS + 32, height: 352, rx: 6, class: "bb" }, gBB);
  el("rect", { x: BBX - 26, y: 202, width: STEP * COLS + 32, height: 20, class: "bb-channel" }, gBB);
  for (const [k, y] of Object.entries(RAIL_Y)) {
    el("line", { x1: BBX - 10, y1: y + (k.endsWith("-") ? -9 : 9) * (k[0] === "T" ? 1 : 1),
      x2: BBX + STEP * (COLS - 1) + 10, y2: y + (k.endsWith("-") ? -9 : 9), class: k.endsWith("-") ? "rail-neg" : "rail-pos" }, gBB);
    el("text", { x: BBX - 18, y: y + 4, class: "bb-label" }, gBB).textContent = k.endsWith("-") ? "−" : "+";
  }
  for (const [r, y] of Object.entries(ROW_Y)) {
    el("text", { x: BBX - 18, y: y + 4, class: "bb-label" }, gBB).textContent = r;
  }
  const hole = (id, x, y, net, label) => {
    terms.set(id, { x, y, net, label });
    holeAt.set(`${x},${y}`, id);
    el("rect", { x: x - 4, y: y - 4, width: 8, height: 8, rx: 1.5, class: "term hole", "data-term": id }, gBB);
  };
  for (let c = 1; c <= COLS; c++) {
    const x = BBX + (c - 1) * STEP;
    if (c % 5 === 0 || c === 1) el("text", { x, y: 100, class: "bb-label" }, gBB).textContent = String(c);
    for (const [r, y] of Object.entries(ROW_Y)) {
      hole(`bb:${c}:${r}`, x, y, `col${c}${"abcde".includes(r) ? "T" : "B"}`, `${r}${c}`);
    }
    for (const [k, y] of Object.entries(RAIL_Y)) {
      hole(`rail:${k}:${c}`, x, y, `rail${k}`, `${k[0] === "T" ? "top" : "bottom"} ${k[1]} rail`);
    }
  }
  el("text", { x: 70, y: 352, class: "tray-label" }, gBoard).textContent = "Parts: drag onto the breadboard";

  // ------------------------------------------------------------------ parts
  let parts = {};
  let partEls = {};
  let scenario = { kinds: ["led", "res"], title: "LED test", cardId: null };

  function resetParts() {
    parts = {};
    for (const k of scenario.kinds) parts[k] = { kind: k, ...HOME[k], flipped: false, legs: null, lit: false };
  }

  function drawParts() {
    gParts.replaceChildren();
    for (const p of Object.values(parts)) {
      const g = el("g", { class: `part ${p.kind}${p.legs ? "" : " loose"}`, transform: `translate(${p.x},${p.y})`,
        "data-part": p.kind }, gParts);
      if (p.kind === "led") {
        const a = p.flipped ? STEP : 0;          // anode (long leg) x
        const k = p.flipped ? 0 : STEP;
        // Seen from above: the round body sits over its own two legs, so the holes in the
        // rows above and below stay free to click. The flat side of the rim marks the cathode.
        el("circle", { cx: STEP / 2, cy: 0, r: 13, class: "led-rim" }, g);
        el("line", { x1: k + (k ? 3 : -3), y1: -10, x2: k + (k ? 3 : -3), y2: 10, class: "led-flat" }, g);
        el("circle", { cx: STEP / 2, cy: 0, r: 10, class: `led-body${p.lit ? " lit" : ""}`,
          filter: p.lit ? "url(#sim-glow)" : "" }, g);
        el("text", { x: a + (a ? 12 : -12), y: 4, class: "led-plus" }, g).textContent = "+";
      } else if (p.kind === "tmp") {
        // TO-92 package seen from above: flat face toward the student. Legs: +Vs, Vout, GND.
        // Flipped = turned around, so +Vs and GND swap (the classic "sensor gets hot" mistake).
        const body = el("g", p.flipped ? { transform: `rotate(180 ${STEP} 0)` } : {}, g);
        el("path", { d: "M-8,7 L48,7 L48,-1 A28,13 0 0 0 -8,-1 Z", class: "tmp-body" }, body);
        el("text", { x: STEP, y: p.flipped ? 4 : 2, class: "tmp-label",
          transform: p.flipped ? `rotate(180 ${STEP} 0)` : "" }, g).textContent = "TMP36";
        const names = p.flipped ? ["GND", "Vout", "+Vs"] : ["+Vs", "Vout", "GND"];
        names.forEach((n, i) => {
          el("text", { x: LEGS.tmp[i], y: 21, class: "tmp-pin" }, g).textContent = n;
        });
      } else {
        el("line", { x1: 0, y1: 0, x2: SPAN("res"), y2: 0, class: "lead" }, g);
        el("rect", { x: 22, y: -7, width: 36, height: 14, rx: 6, class: "res-body" }, g);
        [["#d22", 29], ["#d22", 36], ["#7a4a12", 43], ["#c9a227", 51]].forEach(([c, x]) =>
          el("rect", { x, y: -7, width: 3.5, height: 14, fill: c }, g));
        el("text", { x: 40, y: -12, class: "res-label" }, g).textContent = "220 Ω";
      }
      if (p.kind !== "led") for (const lx of LEGS[p.kind]) el("circle", { cx: lx, cy: 0, r: 3, class: "leg-tip" }, g);
      // Invisible hit area for dragging: only the part itself, so neighbouring holes stay clickable.
      el("rect", { x: p.kind === "tmp" ? -9 : -6, y: p.kind === "tmp" ? -13 : -9,
        width: SPAN(p.kind) + (p.kind === "tmp" ? 18 : 12), height: p.kind === "tmp" ? 22 : 18,
        class: "part-hit" }, g);
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
      const clash = legs && legs.some((id) => taken.includes(id));
      if (legs && !clash) {
        p.x = best.x; p.y = best.y; p.legs = legs;
        return;
      }
    }
    p.legs = null;
  }

  // ------------------------------------------------------------------ wires
  let wires = [];
  let pending = null;      // terminal id where a new wire starts
  let selected = null;     // index of the selected wire
  const PALETTE = ["#e8862a", "#2f9e44", "#1c7ed6", "#c2a400", "#9c36b5"];
  let paletteIdx = 0;

  const wireColor = (a, b) => {
    const nets = [terms.get(a).net, terms.get(b).net];
    if (nets.some((n) => n === "GND" || n.endsWith("-"))) return "#222";
    if (nets.some((n) => n === "5V" || n.endsWith("+"))) return "#d6336c";
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
      el("path", { d: wirePath(w.a, w.b), class: `wire${selected === i ? " selected" : ""}`, stroke: w.color,
        "data-wire": String(i) }, gWires);
      for (const t of [w.a, w.b]) {
        const p = terms.get(t);
        el("circle", { cx: p.x, cy: p.y, r: 3.5, class: "wire-end", fill: w.color }, gWires);
      }
    });
    $("sim-delete").disabled = selected === null;
  }

  // ------------------------------------------------------------------ circuit logic
  function nets() {
    const parent = new Map();
    const find = (n) => {
      if (!parent.has(n)) parent.set(n, n);
      let r = n;
      while (parent.get(r) !== r) r = parent.get(r);
      while (parent.get(n) !== r) { const nx = parent.get(n); parent.set(n, r); n = nx; }
      return r;
    };
    const union = (a, b) => parent.set(find(a), find(b));
    for (const w of wires) union(terms.get(w.a).net, terms.get(w.b).net);
    return find;
  }

  /** Evaluate the LED loop. level(name) gives "H", "L" or null for base nets 5V/GND/Dn. */
  function evaluate(level) {
    const find = nets();
    const sources = ["5V", "GND", ...Array.from({ length: 12 }, (_, i) => `D${i + 2}`)];
    const pot = new Map();   // root -> Set of "H"/"L"
    const names = new Map(); // root -> source names in it
    for (const s of sources) {
      const r = find(s);
      if (!names.has(r)) names.set(r, []);
      names.get(r).push(s);
      const lv = level(s);
      if (!lv) continue;
      if (!pot.has(r)) pot.set(r, new Set());
      pot.get(r).add(lv);
    }
    for (let i = 0; i < 6; i++) {
      const r = find(`A${i}`);
      if (!names.has(r)) names.set(r, []);
      names.get(r).push(`A${i}`);
    }
    const potOf = (net) => pot.get(find(net)) || new Set();
    const shorts = [...pot.entries()].filter(([, s]) => s.has("H") && s.has("L")).map(([r]) => names.get(r));

    const led = parts.led, res = parts.res;
    const out = { placed: !!(led && led.legs), resPlaced: !!(res && res.legs), shorts, lit: false,
      noResistor: false, reversed: false, ledShorted: false, resShorted: false, signal: null,
      toGround: false, tmp: tmpState(find, names, potOf) };
    if (!led || !led.legs) return out;
    const [l1, l2] = led.legs.map((t) => terms.get(t).net);
    const anode = find(led.flipped ? l2 : l1), cathode = find(led.flipped ? l1 : l2);
    if (anode === cathode) { out.ledShorted = true; return out; }
    let r1 = null, r2 = null;
    if (res && res.legs) {
      [r1, r2] = res.legs.map((t) => find(terms.get(t).net));
      if (r1 === r2) { out.resShorted = true; r1 = r2 = null; }
    }
    const via = (n) => (r1 && n === r1 ? r2 : r2 && n === r2 ? r1 : null); // across the resistor
    const has = (n, lv) => n && potOf(n).has(lv);
    const srcName = (n) => (names.get(n) || []).find((s) => s !== "GND") || null;

    const direct = has(anode, "H") && has(cathode, "L");
    const withRes = (has(via(anode), "H") && has(cathode, "L")) || (has(anode, "H") && has(via(cathode), "L"));
    const backwards = (has(cathode, "H") && has(anode, "L")) ||
      (has(via(cathode), "H") && has(anode, "L")) || (has(cathode, "H") && has(via(anode), "L"));
    out.lit = (direct || withRes) && !shorts.length;
    out.noResistor = direct;
    out.reversed = !direct && !withRes && backwards;
    out.signal = srcName(anode) || srcName(via(anode)) || srcName(cathode) || srcName(via(cathode));
    out.toGround = has(cathode, "L") || has(via(cathode), "L") || has(anode, "L") || has(via(anode), "L");
    return out;
  }

  /** TMP36: is it powered the right way round, and which analog pin does Vout reach? */
  function tmpState(find, names, potOf) {
    const t = parts.tmp;
    if (!t) return null;
    const st = { placed: !!t.legs, powered: false, reversed: false, vs5v: false, gnd: false,
      outPin: null, outChannel: null, volts: 0 };
    if (!t.legs) return st;
    const [n0, n1, n2] = t.legs.map((id) => find(terms.get(id).net));
    const vs = t.flipped ? n2 : n0, gnd = t.flipped ? n0 : n2;
    const has5V = (n) => (names.get(n) || []).includes("5V");
    const hasGND = (n) => (names.get(n) || []).includes("GND");
    st.vs5v = has5V(vs);
    st.gnd = hasGND(gnd);
    st.powered = st.vs5v && st.gnd;
    st.reversed = hasGND(vs) && has5V(gnd);
    st.outPin = (names.get(n1) || []).find((x) => /^A\d$/.test(x)) || null;
    st.outChannel = st.outPin ? Number(st.outPin.slice(1)) : null;
    // TMP36: 10 mV per degree C with a 500 mV offset. Reversed, it heats up and reads near the top.
    st.volts = st.powered ? 0.5 + temperature() / 100 : st.reversed ? 4.4 : 0;
    return st;
  }

  function temperature() {
    const s = $("sim-temp");
    return s ? Number(s.value) : 24;
  }

  // ------------------------------------------------------------------ emulator
  let run = null; // { cpu, ports, usart, raf, last, driven:Set, serial, startedAt }

  function pinLevel(name) {
    if (name === "5V") return "H";
    if (name === "GND") return "L";
    if (!run) return null;
    const n = Number(name.slice(1));
    const port = n < 8 ? run.portD : run.portB;
    const s = port.pinState(n < 8 ? n : n - 8);
    return s === PinState.High ? "H" : s === PinState.Low ? "L" : null;
  }

  async function start() {
    stop();
    $("sim-run").disabled = true;
    setStatus("Compiling your sketch…");
    let compiled = null;
    try {
      compiled = await window.SproutLab.compile();
    } catch (e) {
      setStatus(`Could not compile: ${e.message}`);
    }
    $("sim-run").disabled = false;
    if (!compiled) {
      setStatus("Fix the compile errors shown under the editor, then run again.");
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
    run = { cpu, portB, portC, portD, usart, adc, driven: new Set(), adcRead: new Set(),
      startedAt: performance.now(), last: performance.now(), speed: 1 };
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
    setStatus("Running your program on a simulated UNO.");
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
    for (let n = 2; n <= 13; n++) if (pinLevel(`D${n}`) === "H") run.driven.add(`D${n}`);
    setAnalogInputs();
    refresh();
    run.raf = setTimeout(() => frame(performance.now()), 16); // timers keep running when the pane is not painted
  }

  /** Feed the TMP36 voltage to its analog pin; an unconnected analog pin reads near 0 V. */
  function setAnalogInputs() {
    if (!run) return;
    const t = evaluate(pinLevel).tmp;
    for (let ch = 0; ch < 6; ch++) run.adc.channelValues[ch] = Math.random() * 0.02;
    if (t && t.outChannel !== null) run.adc.channelValues[t.outChannel] = t.volts + (Math.random() - 0.5) * 0.004;
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
    // Wiring judged as if every digital pin could be HIGH.
    const s = evaluate((n) => (n === "GND" ? "L" : "H"));
    const hasLed = !!parts.led;
    if (hasLed && !s.placed) add("todo", "Put the LED on the breadboard (both legs in holes).");
    else if (hasLed && s.ledShorted) add("warn", "Both LED legs are in the same column strip, so the LED is bypassed. Move one leg to another column.");
    if (parts.res && !s.resPlaced) add("todo", "Put the 220 Ω resistor on the breadboard.");
    else if (parts.res && s.resShorted) add("warn", "Both resistor legs are in the same column strip, so it does nothing. Spread it across columns.");
    const t = s.tmp;
    if (t) {
      if (!t.placed) add("todo", "Put the TMP36 on the breadboard: three legs in three columns, flat side facing you.");
      else if (t.reversed) add("warn", "The TMP36 is backwards: 5V and GND are swapped. A real sensor gets hot, so unplug USB at once. Double-click it to turn it around.");
      else {
        if (!t.vs5v) add("todo", "Connect the TMP36's left leg (+Vs) to 5V.");
        if (!t.gnd) add("todo", "Connect the TMP36's right leg (GND) to GND.");
        if (!t.outPin) add("todo", "Connect the TMP36's middle leg (Vout) to an analog pin, for example A0.");
        if (t.powered && t.outPin) {
          add("ok", `TMP36 powered; Vout → ${t.outPin} reads about ${t.volts.toFixed(2)} V at ${temperature()} °C.`);
        }
      }
      if (run && t.outChannel !== null && performance.now() - run.startedAt > 2500 && run.adcRead.size &&
          !run.adcRead.has(t.outChannel)) {
        add("warn", `Your code reads ${[...run.adcRead].map((c) => `A${c}`).join(", ")}, but the sensor's Vout is wired to ${t.outPin}.`);
      }
    }
    for (const grp of s.shorts) {
      add("warn", `Short circuit: ${grp.filter((x) => x !== "GND").join(", ")} is wired straight to GND. On a real board this can damage the pin.`);
    }
    if (hasLed && s.placed && !s.ledShorted && !s.shorts.length) {
      if (s.reversed) add("warn", "The LED is backwards. The long leg (+) must face the pin side. Double-click the LED to flip it.");
      else if (s.lit && s.noResistor) add("warn", `The LED is wired from ${s.signal} to GND without the resistor. On a real board this could burn out the LED.`);
      else if (s.lit) add("ok", `Circuit complete: ${s.signal} → LED and resistor → GND. The LED lights when ${s.signal} is HIGH.`);
      else if (!s.signal) add("todo", "Connect the LED's long leg (+) side to a digital pin with a wire.");
      else if (!s.toGround) add("todo", "Connect the other side of the LED and resistor to GND.");
      else add("todo", "The loop is not complete yet: pin → resistor → LED → GND.");
    }
    if (run && s.lit && s.signal && s.signal !== "5V" && performance.now() - run.startedAt > 2500 &&
        !run.driven.has(s.signal)) {
      const others = [...run.driven].filter((d) => d !== "D13" || s.signal === "D13");
      add("warn", others.length
        ? `Your code switches ${others.join(", ")}, but the LED is wired to ${s.signal}. Match the wire or the code.`
        : `Your code never turns ${s.signal} HIGH. Check pinMode() and digitalWrite().`);
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
    if (parts.led && parts.led.lit !== live.lit) {
      parts.led.lit = live.lit;
      drawParts();
    }
    builtinLed.classList.toggle("on", !!run && pinLevel("D13") === "H");
    const now = performance.now();
    if (force || now - lastFeedback > 300) {
      lastFeedback = now;
      feedback();
      if (run) setStatus(`Running your program on a simulated UNO (speed ${Math.round(run.speed * 100)}%).`);
      else if (!force) setStatus("Stopped. Press Run to start your program.");
    }
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
    if (drag.moved) snap(drag.p);
    drag = null;
    drawParts();
    refresh(true);
  });

  svg.addEventListener("dblclick", (ev) => {
    const partEl = ev.target.closest("[data-part='led'], [data-part='tmp']");
    if (!partEl) return;
    const p = parts[partEl.dataset.part];
    p.flipped = !p.flipped;
    drawParts();
    refresh(true);
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

  // hover tooltip: name of the pin or hole under the pointer
  svg.addEventListener("mouseover", (ev) => {
    const termEl = ev.target.closest("[data-term]");
    $("sim-hover").textContent = termEl ? terms.get(termEl.dataset.term).label : "";
  });

  $("sim-run").addEventListener("click", start);
  $("sim-stop").addEventListener("click", stop);
  $("sim-delete").addEventListener("click", deleteSelected);
  function resetAll() {
    stop();
    wires = []; pending = null; selected = null;
    resetParts();
    drawParts(); drawWires(); refresh(true);
  }
  $("sim-reset").addEventListener("click", resetAll);

  /** Switch the parts to match a card ({cardId, title, parts: ["1 × TMP36 temperature sensor", ...]}). */
  function setScenario(card) {
    const list = (card && card.parts) || [];
    const kinds = [];
    if (list.some((x) => /TMP36/i.test(x))) kinds.push("tmp");
    if (list.some((x) => /\bLED\b/i.test(x))) kinds.push("led");
    if (list.some((x) => /resistor/i.test(x))) kinds.push("res");
    scenario = kinds.length
      ? { kinds, title: card.title, cardId: card.cardId }
      : { kinds: ["led", "res"], title: "LED test", cardId: null };
    $("sim-scenario").textContent = `${scenario.title} · parts: ${scenario.kinds.map((k) => NAMES[k]).join(", ")}`;
    $("sim-temp-box").hidden = !scenario.kinds.includes("tmp");
    resetAll();
  }
  document.addEventListener("sprout:card", (ev) => setScenario(ev.detail));
  $("sim-temp").addEventListener("input", () => {
    $("sim-temp-val").textContent = `${temperature()} °C`;
    refresh(true);
  });
  const example = $("sim-example");
  if (example) {
    example.addEventListener("click", () => {
      resetAll();
      wires = [{ a: "pin:GND:101", b: "rail:T-:2", color: "#222" }];
      if (parts.led) {
        // D8 → a5; LED c5(+) / c6; resistor b6–b10; a10 → top − rail.
        wires.push({ a: "pin:D8:6", b: "bb:5:a", color: PALETTE[0] },
          { a: "bb:10:a", b: "rail:T-:10", color: "#222" });
        Object.assign(parts.led, { x: BBX + 4 * STEP, y: ROW_Y.c, flipped: false });
        parts.led.legs = legTerms(parts.led);
        if (parts.res) {
          Object.assign(parts.res, { x: BBX + 5 * STEP, y: ROW_Y.b });
          parts.res.legs = legTerms(parts.res);
        }
      }
      if (parts.tmp) {
        // TMP36 in c14–c16: 5V → a14, A0 → a15, a16 → top − rail.
        wires.push({ a: "pin:5V:100", b: "bb:14:a", color: "#d6336c" },
          { a: "pin:A0:103", b: "bb:15:a", color: PALETTE[1] },
          { a: "bb:16:a", b: "rail:T-:16", color: "#222" });
        Object.assign(parts.tmp, { x: BBX + 13 * STEP, y: ROW_Y.c, flipped: false });
        parts.tmp.legs = legTerms(parts.tmp);
      }
      drawParts(); drawWires(); refresh(true);
    });
  }

  // test hook (read-only view of the circuit state)
  window.SproutSim = {
    state: () => ({ wires: wires.map((w) => [w.a, w.b]), kinds: scenario.kinds, running: !!run,
      lit: !!(parts.led && parts.led.lit), tmp: parts.tmp ? { ...parts.tmp } : null }),
    evaluate: () => evaluate(pinLevel),
    place: (kind, holeId, flipped) => {
      const t = terms.get(holeId);
      Object.assign(parts[kind], { x: t.x, y: t.y });
      if (flipped !== undefined) parts[kind].flipped = flipped;
      snap(parts[kind]);
      drawParts(); refresh(true);
      return !!parts[kind].legs;
    },
    wire: (a, b) => { wires.push({ a, b, color: wireColor(a, b) }); drawWires(); refresh(true); },
  };

  setScenario(window.SproutLab && window.SproutLab.currentCard ? window.SproutLab.currentCard() : null);
  setStatus("Press Run to start your program. You can wire the parts before or while it runs.");
}
