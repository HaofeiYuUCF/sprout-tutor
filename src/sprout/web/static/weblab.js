/* SPROUT Web Lab: a guided page for first-time students.
 *
 * Screens: sign in with a student code -> choose a card -> work through the card one step at a
 * time (meet the project, wire it in the simulator, write the code, try it in the simulator,
 * build it, send it to the real board and check, think about it). Each step shows only the tools
 * it needs, with the instructions right above them. The tutor is a drawer that is always one
 * click away. Code compiles on the server; uploads go from the browser over Web Serial; ladder
 * rules, guardrails and the API key stay on the server.
 */
(function () {
  "use strict";
  const { parseIntelHex, Stk500Uploader, WebSerialTransport, UNO } = window.SproutUpload;
  const $ = (id) => document.getElementById(id);
  const LEARNER_ID = /^l_[a-z0-9]{3,12}$/;
  const REGIONS = ["info", "editor", "todo", "sim", "simside", "check", "buildref", "board", "reflect"];

  // ------------------------------------------------------------------ steps
  const STEPS = [
    { id: "intro", short: "Meet the project", title: "Meet the project", regions: ["info"],
      text: (c) => `${c.title}: read why it matters for growers, and check that you have the parts.`,
      tips: [] },
    { id: "wire", short: "Wire it", title: "Wire it in the simulator", regions: ["sim", "simside"],
      mode: "sim", cardKind: "simulate", tutorStep: "simulate",
      tips: ["Drag a part onto the breadboard. It snaps into the holes.",
        "Hover over a hole: every hole connected to it lights up green.",
        "To add a wire, click a pin or a hole, then click another one.",
        "Double-click the LED or the sensor to turn it around."] },
    { id: "code", short: "Write the code", title: "Write the code", regions: ["editor", "todo"],
      cardKind: "code", tutorStep: "code",
      tips: ["Every instruction ends with a semicolon ;",
        "Lines that start with // are notes for people. The board ignores them.",
        "Press “Check my code” often. If something is wrong, click the red message to jump to that line."] },
    { id: "simrun", short: "Try it", title: "Try your code in the simulator",
      regions: ["editor", "sim", "simside", "check"], mode: "sim", tutorStep: "simulate",
      text: () => "Press “Run my code”. Your program runs on the simulated board with your wiring. " +
        "Compare what happens with the card, then press “Check my work”.",
      tips: ["Nothing happens? Read the wiring tips and the messages from the board.",
        "You can change the code and run it again as often as you like."] },
    { id: "build", short: "Build it", title: "Build it on your real board", regions: ["buildref"],
      cardKind: "build", tutorStep: "build",
      text: () => "Copy your simulator wiring onto your real breadboard. Tick each item on the right as you go.",
      tips: ["Keep the USB cable unplugged while you build, and unplug it again before you change anything.",
        "Copy your simulator picture: same holes, same pins."] },
    { id: "upload", short: "Send & check", title: "Send your code to your board and check it",
      regions: ["editor", "board", "check"], mode: "board", cardKind: "run", tutorStep: "run",
      tips: ["Plug in USB only after the circuit is built.",
        "If something gets hot, unplug USB at once and ask for help."] },
    { id: "reflect", short: "Think", title: "Think about it", regions: ["reflect"],
      cardKind: "reflect", tutorStep: "reflect", tips: [] },
  ];
  const WARMUP = [
    { id: "warmup", short: "Board check", title: "Check that your board works", regions: ["board"], mode: "board",
      text: () => "Plug in your UNO, connect it, and send the test program. The small light marked “L” " +
        "on the board should blink once a second, and the board should say “Your board is working!”",
      tips: ["If the list in step 2 is empty, try another USB port or another cable.",
        "Close the Arduino IDE if it is open: only one program can talk to the board at a time."] },
  ];

  const state = {
    config: null, learner: null,
    cardId: null, warmup: false, practice: null, saveKey: null,
    steps: STEPS, stepIdx: 0,
    compiled: null, errorLines: new Set(), starterTodos: [], loadedCode: "",
    port: null, transport: null, busy: false, asking: false, trials: [], decoder: new TextDecoder(),
    serialLines: [], serialPartial: "", simLines: [], simPartial: "",
    mode: "none", saveTimer: null, pending: {},
  };

  // ------------------------------------------------------------------ helpers
  async function postJson(url, body) {
    const r = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) {
      let reason = "";
      try { reason = (await r.json()).error || ""; } catch (_) { /* not JSON */ }
      throw new Error(`${url} returned ${r.status}${reason ? `: ${reason}` : ""}`);
    }
    return r.json();
  }
  const quietly = (p) => p.catch(() => { /* logging is best-effort */ });
  /** A self-check answer or an opened explanation (logged so the pilot can see what helps). */
  const learn = (kind, item, correct) => {
    if (!state.learner) return;
    quietly(postJson("/api/weblab/learn", { learner: state.learner, card_id: state.cardId, kind, item,
      ...(kind === "quiz" ? { correct } : {}) }));
  };
  const today = () => new Date().toISOString().slice(0, 10);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function show(target, parts) {
    target.replaceChildren(...parts.map(([cls, text]) => el("div", cls, text)));
  }

  const card = () => (state.cardId ? state.config.cards[state.cardId] : null);
  const step = () => state.steps[state.stepIdx];
  const cardStepText = (kind) => (card()?.steps.find((s) => s.kind === kind) || {}).text || "";
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* blocked */ } },
  };

  // ------------------------------------------------------------------ screens
  function showScreen(name) {
    document.body.dataset.screen = name;
    for (const s of ["signin", "cards", "card"]) $(`screen-${s}`).hidden = s !== name;
    $("help-fab").hidden = !(name === "card" && state.cardId);
    if (name !== "card") {
      closeHelp();
      delete document.body.dataset.step;
      setMode("none");
    }
    window.scrollTo(0, 0);
  }

  // ---- sign in
  async function signIn(code, remembered = false) {
    const id = (code || "").trim().toLowerCase();
    if (!LEARNER_ID.test(id)) {
      $("signin-err").textContent = "That code does not look right. It starts with l_ and has 3 to 12 letters or numbers, like l_ab12.";
      $("signin-err").hidden = false;
      return;
    }
    if (state.config.roster_required) {   // on a class server, only codes on the class list work
      try {
        await postJson("/api/weblab/signin", { learner: id });
      } catch (e) {
        if (remembered) { store.del("sprout.learner"); showScreen("signin"); return; }
        $("signin-err").textContent = /403/.test(e.message)
          ? "This code is not on the class list. Check it with your instructor."
          : `Could not sign in: ${e.message}`;
        $("signin-err").hidden = false;
        return;
      }
    }
    state.learner = id;
    store.set("sprout.learner", id);
    $("who-id").textContent = id;
    $("who").hidden = false;
    $("btn-basics").hidden = false;
    $("signin-err").hidden = true;
    openCardList();
  }

  async function switchStudent() {
    await flushSave();
    store.del("sprout.learner");
    state.learner = null;
    state.cardId = null;
    $("who").hidden = true;
    $("btn-basics").hidden = true;
    $("glossary").hidden = true;
    $("signin-code").value = "";
    showScreen("signin");
    $("signin-code").focus();
  }

  // ---- card list
  async function openCardList() {
    await flushSave();
    state.cardId = null;
    state.warmup = false;
    document.dispatchEvent(new CustomEvent("sprout:card", { detail: null }));
    showScreen("cards");
    renderWarmupPanel();
    const badges = {};
    const tiles = Object.values(state.config.cards).map((c, i) => {
      const b = el("button", "tile");
      badges[c.id] = el("span", "badge", "…");
      b.append(el("span", "stage", `Card ${i + 1} · ${c.stage}`), el("span", "title", c.title),
        el("span", "blurb", c.agriculture_connection.split(". ")[0] + "."), badges[c.id]);
      b.addEventListener("click", () => openCard(c.id));
      return b;
    });
    $("card-tiles").replaceChildren(...tiles);
    let progress = {};
    try {
      progress = (await postJson("/api/weblab/progress", { learner: state.learner })).cards;
    } catch (_) { /* tiles still work without badges */ }
    for (const [id, badge] of Object.entries(badges)) {
      const p = progress[id] || {};
      const [cls, text] = p.status === "completed" ? ["done", "Done on your board ✓"]
        : p.sim_passed ? ["sim", "Works in the simulator"]
          : p.status === "in_progress" ? ["progress", "In progress"] : ["", "Not started"];
      badge.className = `badge ${cls}`;
      badge.textContent = text;
    }
    if (state.config.test_mode) {
      const practice = state.config.sketches.filter((s) => s.id.includes(":"));
      $("practice").hidden = practice.length === 0;
      $("practice-list").replaceChildren(...practice.map((s) => {
        const b = el("button", "small", s.title);
        b.addEventListener("click", () => openCard(s.card_id, { practice: s }));
        return b;
      }));
    }
  }

  // ---- one card
  async function openCard(cardId, opts = {}) {
    await flushSave();
    state.cardId = cardId;
    state.warmup = false;
    state.practice = opts.practice || null;
    state.saveKey = state.practice ? null : cardId;
    state.steps = STEPS;
    const c = card();
    const starter = (state.config.sketches.find((s) => s.id === cardId) || {}).code || "";
    let code = state.practice ? state.practice.code : starter;
    let sim = null;
    let reflection = "";
    if (state.saveKey && !opts.fresh) {
      try {
        const w = await postJson("/api/weblab/work", { learner: state.learner, card_id: cardId });
        if (typeof w.code === "string") code = w.code;
        sim = w.sim;
        reflection = w.reflection || "";
        setSaveStatus(w.code || w.sim ? "Your saved work is back" : "");
      } catch (_) {
        setSaveStatus("Could not load your saved work", true);
      }
    } else {
      setSaveStatus("");
    }
    state.starterTodos = starter.split("\n").filter((l) => /\/\/\s*TODO/i.test(l)).map((l) => l.trim());
    setCode(code);
    $("reflection").value = reflection;
    $("practice-note").hidden = !state.practice;
    $("btn-restart").hidden = !!state.practice;
    $("card-title").textContent = state.practice ? `${c.title} (practice)` : c.title;
    renderCardInfo(c);
    $("hints").replaceChildren();
    $("check-out").replaceChildren();
    $("upload-out").replaceChildren();
    $("restart-confirm").hidden = true;
    state.simLines = [];
    document.dispatchEvent(new CustomEvent("sprout:card",
      { detail: { cardId: c.id, title: c.title, parts: c.parts, sim } }));
    quietly(postJson("/api/weblab/card_open", { learner: state.learner, card_id: cardId }));
    showScreen("card");
    const saved = Number(store.get(`sprout.step.${state.learner}.${cardId}`));
    const start = state.practice ? STEPS.findIndex((s) => s.id === "code")
      : opts.fresh ? 0 : Number.isInteger(saved) && saved >= 0 && saved < STEPS.length ? saved : 0;
    goStep(start);
  }

  async function openWarmup() {
    await flushSave();
    state.cardId = null;
    state.warmup = true;
    state.practice = null;
    state.saveKey = null;
    state.steps = WARMUP;
    setCode((state.config.sketches.find((s) => s.id === "hello") || {}).code || "");
    $("card-title").textContent = "Check that your board works";
    $("board-ok").hidden = true;
    $("btn-restart").hidden = true;
    setSaveStatus("");
    $("upload-out").replaceChildren();
    showScreen("card");
    goStep(0);
  }

  function renderCardInfo(c) {
    $("card-ag").textContent = c.agriculture_connection;
    $("card-objectives").replaceChildren(...c.learning_objectives.map((x) => el("li", "", x)));
    window.SproutParts.render($("card-parts"), c.parts, { onExplain: (item) => learn("explain", item) });
    renderConcepts(c.id);
    renderQuiz(c.id);
    for (const id of ["card-safety", "build-safety"]) {
      $(id).replaceChildren(...c.safety.map((x) => el("li", "", x)));
      $(id).hidden = c.safety.length === 0;
    }
    const sentences = cardStepText("build").split(/(?<=\.)\s+/).filter(Boolean);
    $("build-checklist").replaceChildren(...["Unplug the USB cable.", ...sentences].map((x) => {
      const li = el("li");
      li.append(el("span", "box"), el("span", "", x));
      li.addEventListener("click", () => li.classList.toggle("done")); // a checklist the student ticks
      return li;
    }));
  }

  function renderConcepts(cardId) {
    const list = (window.SproutConcepts.CONCEPTS[cardId] || []);
    $("card-concepts").replaceChildren(...list.map((k) => {
      const box = el("div", "concept");
      const more = el("details", "more");
      more.append(el("summary", "", "How does it work?"), el("p", "", k.more));
      more.addEventListener("toggle", () => { if (more.open) learn("explain", `${cardId}.${k.id}`); });
      box.append(el("h3", "", k.title), el("p", "", k.text), more);
      return box;
    }));
  }

  function renderQuiz(cardId) {
    const qs = window.SproutConcepts.QUIZ[cardId] || [];
    $("quiz-label").hidden = qs.length === 0;
    $("card-quiz").replaceChildren(...qs.map((q) => {
      const box = el("div", "quiz-q");
      const fb = el("div", "feedback");
      const row = el("div", "actions");
      let answered = false;
      q.options.forEach((opt, i) => {
        const b = el("button", "small", opt);
        b.addEventListener("click", () => {
          const right = i === q.answer;
          b.classList.add(right ? "right" : "wrong");
          fb.textContent = right ? `✓ Right. ${q.why}` : "Not quite. Try another answer.";
          fb.className = `feedback ${right ? "ok-text" : "muted"}`;
          if (!answered) learn("quiz", q.id, right);   // the first try is what counts
          answered = true;
        });
        row.append(b);
      });
      box.append(el("p", "", q.q), row, fb);
      return box;
    }));
  }

  function renderGlossary() {
    $("glossary-list").replaceChildren(...window.SproutConcepts.GLOSSARY.flatMap(([, term, text]) => [el("dt", "", term), el("dd", "", text)]));
  }

  /** The card list remembers that this student's board passed the check. */
  function renderWarmupPanel() {
    const ok = store.get(`sprout.boardok.${state.learner}`);
    $("warmup-panel").classList.toggle("ok", !!ok);
    $("warmup-title").textContent = ok ? "✓ Your board works" : "First time with your board?";
    $("warmup-text").textContent = ok ? `Checked ${ok === today() ? "today" : `on ${ok}`}. You can start a card.`
      : "Check that your UNO works before you start a card. No parts needed.";
    $("btn-warmup").textContent = ok ? "Check my board again" : "Check that my board works";
  }

  function goStep(i) {
    state.stepIdx = Math.max(0, Math.min(i, state.steps.length - 1));
    const s = step();
    const c = card();
    document.body.dataset.step = s.id;
    for (const r of REGIONS) document.querySelector(`.r-${r}`).hidden = !s.regions.includes(r);
    $("step-title").textContent = state.steps.length > 1
      ? `Step ${state.stepIdx + 1} of ${state.steps.length} · ${s.title}` : s.title;
    $("step-text").textContent = s.text ? s.text(c) : cardStepText(s.cardKind);
    $("step-tips").replaceChildren(...s.tips.map((t) => el("li", "", t)));
    $("step-tips").hidden = s.tips.length === 0;
    setMode(s.mode || "none");
    if (s.id === "build") renderBuildRef();
    if (s.id === "code") updateTodos();
    renderStepbar();
    $("btn-prev").disabled = state.stepIdx === 0;
    const next = state.steps[state.stepIdx + 1];
    $("btn-next").textContent = next ? `Next: ${next.short} →` : "Done → back to cards";
    if (state.cardId && !state.practice) store.set(`sprout.step.${state.learner}.${state.cardId}`, String(state.stepIdx));
    window.scrollTo(0, 0);
  }

  function renderStepbar() {
    const bar = $("stepbar");
    bar.hidden = state.steps.length < 2;
    bar.replaceChildren(...state.steps.map((s, i) => {
      const li = el("li");
      const b = el("button");
      if (i === state.stepIdx) b.setAttribute("aria-current", "step");
      if (i < state.stepIdx) b.classList.add("seen");
      b.append(el("span", "num", String(i + 1)), el("span", "", s.short));
      b.addEventListener("click", () => goStep(i));
      li.append(b);
      return li;
    }));
  }

  function renderBuildRef() {
    const snap = window.SproutSim && window.SproutSim.snapshot ? window.SproutSim.snapshot() : null;
    $("buildref").replaceChildren(...(snap ? [snap] : []));
    $("buildref").hidden = !snap;
    $("buildref-empty").hidden = !!snap;
  }

  // ------------------------------------------------------------------ mode (which board the tutor judges)
  function setMode(mode) {
    state.mode = mode;
    $("check-source").textContent = mode === "sim" ? "using the simulator" : mode === "board" ? "using your real board" : "";
    document.dispatchEvent(new CustomEvent("sprout:mode", { detail: mode }));
    refreshButtons();
  }
  const currentSerial = () => (state.mode === "sim" ? state.simLines : state.serialLines);

  // ------------------------------------------------------------------ editor
  function setCode(code) {
    $("code").value = code;
    state.loadedCode = code;
    state.compiled = null;
    state.errorLines = new Set();
    $("size").textContent = "";
    $("compile-out").replaceChildren();
    updateGutter();
    updateTodos();
  }

  function updateGutter() {
    const n = $("code").value.split("\n").length;
    $("gutter").replaceChildren(...Array.from({ length: n }, (_, i) =>
      el("span", state.errorLines.has(i + 1) ? "err-line" : "", `${i + 1}\n`)));
    $("gutter").scrollTop = $("code").scrollTop;
  }

  function jumpToLine(line) {
    const ta = $("code");
    const lines = ta.value.split("\n");
    const start = lines.slice(0, line - 1).reduce((a, l) => a + l.length + 1, 0);
    ta.focus();
    ta.setSelectionRange(start, start + (lines[line - 1] || "").length);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, (line - 4) * lh);
    updateGutter();
  }

  /** The starter's "// TODO" lines become a checklist that ticks off when the line is replaced. */
  function updateTodos() {
    const left = new Map();
    for (const l of $("code").value.split("\n")) left.set(l.trim(), (left.get(l.trim()) || 0) + 1);
    const items = state.starterTodos.map((t) => {
      const stillThere = (left.get(t) || 0) > 0;
      if (stillThere) left.set(t, left.get(t) - 1);
      const li = el("li", stillThere ? "" : "done");
      li.append(el("span", "box"), el("span", "", t.replace(/^\/\/\s*TODO:?\s*/i, "")));
      return li;
    });
    $("todo-help").hidden = items.length === 0;
    $("todo-list").replaceChildren(...(items.length ? items
      : [el("li", "", "No to-do lines in this sketch. Follow the step text above.")]));
  }

  async function compile() {
    const code = $("code").value;
    if (state.compiled && state.compiled.code === code) return state.compiled;
    show($("compile-out"), [["muted", "Checking your code…"]]);
    $("size").textContent = "";
    const r = await postJson("/api/weblab/compile", { code, learner: state.learner, card_id: state.cardId });
    if (!r.ok) {
      state.compiled = null;
      state.errorLines = new Set(r.errors.filter((e) => e.line).map((e) => e.line));
      const rows = r.errors.map((e) => {
        const div = el("div", e.line ? "err jump" : "err", e.line ? `Line ${e.line}: ${e.message}` : e.message);
        if (e.line) {
          div.title = "Show this line";
          div.addEventListener("click", () => jumpToLine(e.line));
        }
        return div;
      });
      rows.push(el("div", "muted", "Click a red message to jump to that line. Stuck? Press “Need help?”."));
      $("compile-out").replaceChildren(...rows);
      updateGutter();
      return null;
    }
    state.errorLines = new Set();
    updateGutter();
    state.compiled = { code, hex: r.hex, flash_bytes: r.flash_bytes, flash_max: r.flash_max };
    show($("compile-out"), [["ok", "✓ The computer understands your code."]]);
    if (r.flash_bytes) $("size").textContent = `uses ${r.flash_bytes} of ${r.flash_max} bytes on the board`;
    return state.compiled;
  }

  // ------------------------------------------------------------------ autosave
  function setSaveStatus(text, bad = false) {
    $("save-status").textContent = text;
    $("save-status").classList.toggle("bad", bad);
  }

  function queueSave(fields) {
    if (!state.saveKey) return;
    Object.assign(state.pending, fields);
    setSaveStatus("Saving…");
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(flushSave, 800);
  }

  async function flushSave(keepalive = false) {
    clearTimeout(state.saveTimer);
    if (!state.saveKey || !Object.keys(state.pending).length) return;
    const body = { learner: state.learner, card_id: state.saveKey, ...state.pending };
    state.pending = {};
    try {
      const r = await fetch("/api/weblab/save", { method: "POST", keepalive,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(String(r.status));
      setSaveStatus(`Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    } catch (_) {
      for (const k of ["code", "sim", "reflection"]) if (body[k] !== undefined) state.pending[k] = body[k];
      setSaveStatus("Not saved yet: the server is not reachable", true);
    }
  }

  async function startOver() {
    $("restart-confirm").hidden = true;
    const id = state.cardId;
    state.pending = {};
    clearTimeout(state.saveTimer);
    try {
      await postJson("/api/weblab/discard", { learner: state.learner, card_id: id });
    } catch (_) { /* the reload below still resets the page */ }
    store.del(`sprout.step.${state.learner}.${id}`);
    await openCard(id, { fresh: true });
    setSaveStatus("Started over");
  }

  async function backToCards() {
    if (state.cardId) {
      quietly(postJson("/api/weblab/card_leave", { learner: state.learner, card_id: state.cardId,
        code: $("code").value, changed: $("code").value !== state.loadedCode }));
    }
    await openCardList();
  }

  // ------------------------------------------------------------------ serial
  function collectSerial(text, source = "board") {
    const linesKey = source === "sim" ? "simLines" : "serialLines";
    const partKey = source === "sim" ? "simPartial" : "serialPartial";
    const parts = (state[partKey] + text).split(/\r?\n/);
    state[partKey] = parts.pop().slice(-300);
    const lines = state[linesKey];
    for (const line of parts) if (line.trim()) lines.push(line.slice(0, 300));
    if (source === "board" && state.warmup && parts.some((l) => /board is working/i.test(l)) && $("board-ok").hidden) {
      $("board-ok").hidden = false;
      store.set(`sprout.boardok.${state.learner}`, today());
      $("btn-next").textContent = "Done → back to cards";
    }
    if (lines.length > 300) lines.splice(0, lines.length - 300);
  }

  function appendMonitor(text) {
    const mon = $("monitor");
    const atBottom = mon.scrollTop + mon.clientHeight >= mon.scrollHeight - 4;
    mon.textContent = (mon.textContent + text).slice(-20000);
    if (atBottom) mon.scrollTop = mon.scrollHeight;
  }

  // ------------------------------------------------------------------ real board
  function setBoardStatus(text, kind) {
    $("board-status").textContent = text;
    $("board-status").className = `pill ${kind}`;
  }

  function boardName(info) {
    if (!info || info.usbVendorId === undefined) return "unknown USB chip";
    const known = (state.config?.known_boards || []).find(
      (b) => b.usbVendorId === info.usbVendorId && b.usbProductId === info.usbProductId);
    const id = `${info.usbVendorId.toString(16).padStart(4, "0")}:${(info.usbProductId ?? 0).toString(16).padStart(4, "0")}`;
    return known ? `connected: ${known.name}` : `connected: unrecognized board [${id}]`;
  }

  function refreshButtons() {
    const connected = !!state.transport?.isOpen;
    $("btn-compile").disabled = state.busy;
    $("btn-upload").disabled = state.busy || !connected;
    $("btn-connect").disabled = state.busy || connected || !("serial" in navigator);
    $("btn-disconnect").disabled = state.busy || !connected;
    $("baud").disabled = state.busy;
    $("btn-check").disabled = state.busy || state.asking;
    $("btn-hint").disabled = state.asking;
  }

  async function connect() {
    const filters = $("all-ports").checked ? [] : (state.config?.known_boards || [])
      .map((b) => ({ usbVendorId: b.usbVendorId, usbProductId: b.usbProductId }));
    let port;
    try {
      port = await navigator.serial.requestPort(filters.length ? { filters } : {});
    } catch (e) {
      show($("upload-out"), [[e.name === "NotFoundError" ? "muted" : "err", e.name === "NotFoundError"
        ? "No board chosen. Is the USB cable plugged in? If your board is not in the list, open Advanced and tick “show all USB devices”."
        : e.message]]);
      return;
    }
    await openPort(port, Number($("baud").value));
  }

  async function openPort(port, baud) {
    const t = new WebSerialTransport(port);
    t.onData = (chunk) => {
      const text = state.decoder.decode(chunk, { stream: true });
      appendMonitor(text);
      collectSerial(text, "board");
    };
    t.onLost = () => {
      setBoardStatus("connection lost: plug it in and connect again", "off");
      state.transport = null;
      refreshButtons();
    };
    try {
      await t.open(baud);
    } catch (e) {
      show($("upload-out"), [["err", `Could not open the board: ${e.message}. Close the Arduino IDE or any other program using the board, then try again.`]]);
      return;
    }
    state.port = port;
    state.transport = t;
    setBoardStatus(boardName(port.getInfo()), "on");
    show($("upload-out"), [["muted", "Connected. Now press “Send to my board”."]]);
    refreshButtons();
  }

  async function disconnect() {
    if (state.transport) await state.transport.close();
    state.transport = null;
    setBoardStatus("not connected", "off");
    refreshButtons();
  }

  async function upload() {
    state.busy = true;
    refreshButtons();
    const out = $("upload-out");
    const bar = $("bar");
    const progress = document.querySelector(".progress");
    const t = state.transport;
    const info = state.port?.getInfo() || {};
    const trial = { ok: false, error_code: "", upload_ms: 0, bytes: 0, attempt: state.trials.length + 1,
      usb_vendor_id: info.usbVendorId, usb_product_id: info.usbProductId, browser: navigator.userAgent.slice(0, 200) };
    try {
      const c = await compile();
      if (!c) {
        trial.error_code = "compile_error";
        show(out, [["err", "Your code has a problem, so it was not sent. See the red message under your code."]]);
        return;
      }
      const image = parseIntelHex(c.hex);
      trial.bytes = image.length;
      progress.hidden = false;
      bar.style.width = "0%";
      show(out, [["muted", "Sending… (the lights on the board flicker)"]]);
      setBoardStatus("receiving code", "busy");
      await t.reopen(UNO.uploadBaud);
      t.mode = "upload";
      const uploader = new Stk500Uploader(t, {
        onProgress: ({ phase, done, total }) => {
          const frac = phase === "write" ? done / total / 2 : 0.5 + done / total / 2;
          bar.style.width = `${Math.round(frac * 100)}%`;
        },
      });
      const r = await uploader.upload(image);
      state.serialLines = []; // the tutor judges output from the new program only
      state.serialPartial = "";
      trial.ok = true;
      trial.upload_ms = r.ms;
      show(out, [["ok", `✓ Your code is on the board (sent and checked in ${(r.ms / 1000).toFixed(1)} s).`]]);
    } catch (e) {
      trial.error_code = e.code || e.name || "error";
      show(out, [["err", e.message]]);
      if (e.trace) {
        trial.note = e.trace.split("\n").slice(-6).join(" | ").slice(0, 200);
        const det = el("details");
        det.append(el("summary", "", "Technical details for your instructor"), el("pre", "trace", e.trace));
        out.appendChild(det);
      }
    } finally {
      try {
        if (t) {
          t.mode = "monitor";
          state.decoder = new TextDecoder();
          await t.reopen(Number($("baud").value));
          setBoardStatus(boardName(state.port.getInfo()), "on");
        }
      } catch (e) {
        setBoardStatus("connection lost: plug it in and connect again", "off");
        state.transport = null;
      }
      progress.hidden = true;
      state.busy = false;
      refreshButtons();
      if (trial.error_code !== "compile_error") {
        recordTrial(trial);
        if (state.cardId) {
          quietly(postJson("/api/weblab/upload_done", { learner: state.learner, card_id: state.cardId,
            code: $("code").value, ok: trial.ok, error_code: trial.error_code }));
        }
      }
    }
  }

  function recordTrial(trial) {
    state.trials.push(trial);
    const tr = el("tr");
    for (const c of [trial.attempt, trial.ok ? "OK" : `failed (${trial.error_code})`,
      trial.ok ? `${(trial.upload_ms / 1000).toFixed(1)} s` : "–", trial.bytes || "–",
      boardName({ usbVendorId: trial.usb_vendor_id, usbProductId: trial.usb_product_id })]) tr.append(el("td", "", String(c)));
    $("trials").appendChild(tr);
    $("trial-count").textContent = `(${state.trials.filter((x) => x.ok).length}/${state.trials.length} succeeded)`;
    quietly(postJson("/api/weblab/trial", Object.fromEntries(Object.entries(trial).filter(([, v]) => v !== undefined))));
  }

  // ------------------------------------------------------------------ check my work
  async function checkWork() {
    if (!state.cardId) return;
    state.asking = true;
    refreshButtons();
    try {
      const r = await postJson("/api/weblab/check", { learner: state.learner, card_id: state.cardId,
        code: $("code").value, serial: currentSerial(), source: state.mode === "sim" ? "sim" : "board" });
      const rows = r.results.map((x) => el("div", x.passed ? "pass" : "todo",
        `${x.passed ? "✓" : "○"} ${x.id.replace(/_/g, " ")}: ${x.detail}`));
      if (r.all_passed && r.completes_card) {
        rows.push(el("div", "done", "🎉 Card complete on your real board! Go on to the last step."));
      } else if (r.all_passed) {
        rows.push(el("div", "done", "It works in the simulator. Next, build it on your real board."));
      } else {
        rows.push(el("div", "muted", "Not yet. Fix the items marked ○, then check again. Stuck? Press “Need help?”."));
      }
      $("check-out").replaceChildren(...rows);
    } catch (e) {
      $("check-out").replaceChildren(el("div", "todo", `Could not check: ${e.message}`));
    } finally {
      state.asking = false;
      refreshButtons();
    }
  }

  // ------------------------------------------------------------------ tutor drawer
  function openHelp() {
    $("help").hidden = false;
    $("help-fab").hidden = true;
    $("question").focus();
  }
  function closeHelp() {
    $("help").hidden = true;
    $("help-fab").hidden = !(document.body.dataset.screen === "card" && state.cardId);
  }

  // Tutor replies use a little Markdown: **bold**, *italic*, `code`, ``` blocks, # headings.
  // The text comes from a model, so build DOM nodes and never set innerHTML.
  const MD_INLINE = /(`+)([^`\n]+?)\1|\*\*(\S(?:[^\n]*?\S)?)\*\*|(^|[^\w*])\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?![\w*])/g;
  function mdInline(parent, text) {
    let last = 0;
    for (const m of text.matchAll(MD_INLINE)) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      if (m[2] !== undefined) parent.append(el("code", "", m[2]));
      else if (m[3] !== undefined) { const b = el("b"); mdInline(b, m[3]); parent.append(b); }
      else parent.append(m[4], el("i", "", m[5])); // m[4]: the character before *, so 2*3*4 stays plain
      last = m.index + m[0].length;
    }
    if (last < text.length) parent.append(text.slice(last));
  }
  function mdBody(text) {
    const body = el("div", "body");
    const parts = String(text == null ? "" : text).split(/```[^\n]*\n?/); // odd parts are code blocks
    parts.forEach((part, i) => {
      if (i % 2) { body.append(el("pre", "", part.replace(/\n+$/, ""))); return; }
      if (i < parts.length - 1) part = part.replace(/\n+$/, "");
      mdInline(body, part.replace(/^#{1,4} +(.+)$/gm, "**$1**"));
    });
    return body;
  }

  async function askHint() {
    if (!state.cardId) return;
    state.asking = true;
    refreshButtons();
    const message = $("question").value;
    try {
      const r = await postJson("/api/weblab/hint", { learner: state.learner, card_id: state.cardId,
        code: $("code").value, serial: currentSerial(), message, step_id: step().tutorStep || null });
      const box = el("div", "hint");
      const meta = el("div", "meta");
      meta.append(el("b", "", r.source_label), document.createTextNode(` · hint ${r.step} of ${r.max_step}`));
      box.append(meta, mdBody(r.text));
      $("hints").appendChild(box);
      $("question").value = "";
    } catch (e) {
      const box = el("div", "hint err");
      box.append(el("div", "body", `The tutor is not available right now (${e.message}). Ask your instructor or a peer mentor.`));
      $("hints").appendChild(box);
    } finally {
      state.asking = false;
      refreshButtons();
    }
  }

  // ------------------------------------------------------------------ simulator hooks (sim.js)
  window.SproutLab = {
    compile: () => compile(),
    /** Compile code that is not the student's (the wiring test); nothing is logged. */
    compileCode: async (code) => {
      const r = await postJson("/api/weblab/compile", { code });
      return r.ok ? r : null;
    },
    resetSerial: () => { state.simLines = []; state.simPartial = ""; },
    feedSerial: (text) => collectSerial(text, "sim"),
    currentCard: () => (card() ? { cardId: card().id, title: card().title, parts: card().parts } : null),
    simStarted: () => {
      if (state.cardId) quietly(postJson("/api/weblab/sim_run", { learner: state.learner, card_id: state.cardId, code: $("code").value }));
    },
  };
  document.addEventListener("sprout:simchange", (ev) => queueSave({ sim: ev.detail }));

  // ------------------------------------------------------------------ start
  async function init() {
    const r = await fetch("/api/weblab/config");
    state.config = await r.json();
    if (!state.config.compiler_ready) $("no-compiler").hidden = false;
    if (!("serial" in navigator)) $("unsupported").hidden = false;
    $("test-tag").hidden = !state.config.test_mode;
    $("signin-demo").hidden = !state.config.test_mode;
    if (state.config.test_mode) {
      $("sim-example").hidden = false;
      window.SproutLab.testBoardLine = (t) => collectSerial(t, "board");   // test mode only: pretend the board sent a line
    }
    $("llm-mode").textContent = state.config.llm_provider === "anthropic" ? "AI: Claude" : "AI: offline mock";
    $("baud").value = String(state.config.default_baud || 9600);

    $("signin-form").addEventListener("submit", (e) => { e.preventDefault(); signIn($("signin-code").value); });
    $("signin-demo").addEventListener("click", () => signIn("l_demo"));
    $("signin-guest").hidden = !state.config.guest_allowed;
    $("signin-guest").addEventListener("click", async () => {
      try {
        const g = await postJson("/api/weblab/guest", {});
        await signIn(g.learner);
      } catch (e) {
        $("signin-err").textContent = `Guest access is not available right now (${e.message}).`;
        $("signin-err").hidden = false;
      }
    });
    $("btn-switch").addEventListener("click", switchStudent);
    $("btn-warmup").addEventListener("click", openWarmup);
    $("btn-back").addEventListener("click", backToCards);
    $("btn-prev").addEventListener("click", () => goStep(state.stepIdx - 1));
    $("btn-next").addEventListener("click", () => {
      if (state.stepIdx >= state.steps.length - 1) backToCards();
      else goStep(state.stepIdx + 1);
    });
    $("btn-restart").addEventListener("click", () => { $("restart-confirm").hidden = false; $("btn-restart-no").focus(); });
    $("btn-restart-yes").addEventListener("click", startOver);
    $("btn-restart-no").addEventListener("click", () => { $("restart-confirm").hidden = true; });
    $("btn-compile").addEventListener("click", async () => {
      state.busy = true; refreshButtons();
      try { await compile(); } catch (e) { show($("compile-out"), [["err", e.message]]); }
      state.busy = false; refreshButtons();
    });
    $("btn-upload").addEventListener("click", upload);
    $("btn-connect").addEventListener("click", connect);
    $("btn-disconnect").addEventListener("click", disconnect);
    $("btn-clear").addEventListener("click", () => { $("monitor").textContent = ""; });
    $("btn-check").addEventListener("click", checkWork);
    $("btn-hint").addEventListener("click", askHint);
    $("help-fab").addEventListener("click", openHelp);
    $("btn-basics").addEventListener("click", () => { $("glossary").hidden = false; learn("explain", "glossary.open"); });
    $("glossary-close").addEventListener("click", () => { $("glossary").hidden = true; });
    renderGlossary();
    $("help-close").addEventListener("click", closeHelp);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("help").hidden) closeHelp();
      $("glossary").hidden = true;
    });
    $("code").addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        e.target.setRangeText("  ", e.target.selectionStart, e.target.selectionEnd, "end");
      }
    });
    $("code").addEventListener("input", () => {
      updateGutter();
      updateTodos();
      queueSave({ code: $("code").value });
    });
    $("code").addEventListener("scroll", () => { $("gutter").scrollTop = $("code").scrollTop; });
    $("reflection").addEventListener("input", () => queueSave({ reflection: $("reflection").value }));
    $("baud").addEventListener("change", async () => {
      if (state.transport?.isOpen) {
        state.decoder = new TextDecoder();
        await state.transport.reopen(Number($("baud").value));
      }
    });
    if ("serial" in navigator) {
      navigator.serial.addEventListener("disconnect", (e) => {
        if (state.port && e.target === state.port) {
          state.transport = null;
          setBoardStatus("unplugged: plug it in and connect again", "off");
          refreshButtons();
        }
      });
    }
    window.addEventListener("pagehide", () => { flushSave(true); });
    refreshButtons();

    const fromUrl = new URLSearchParams(location.search).get("learner");
    const remembered = store.get("sprout.learner");
    const id = fromUrl && LEARNER_ID.test(fromUrl) ? fromUrl : remembered && LEARNER_ID.test(remembered) ? remembered : null;
    if (id) await signIn(id, id === remembered && id !== fromUrl);
    else showScreen("signin");
  }

  init().catch((e) => {
    document.querySelector("main").prepend(el("div", "notice warn", `Could not load the page: ${e.message}`));
  });
})();
