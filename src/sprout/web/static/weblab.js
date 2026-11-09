/* SPROUT Web Lab page logic: compile on the server, upload and monitor in the browser, and ask
 * the server-side tutor for checks and hints (ladder rules and guardrails run on the server). */
(function () {
  "use strict";
  const { parseIntelHex, Stk500Uploader, WebSerialTransport, UNO } = window.SproutUpload;
  const $ = (id) => document.getElementById(id);

  const state = {
    config: null,
    compiled: null, // { code, hex, flash_bytes, flash_max }
    port: null,
    transport: null,
    busy: false,
    trials: [],
    decoder: new TextDecoder(),
    learner: "l_demo",
    cardId: null,      // card of the selected sketch (null for the hello test)
    stepId: null,      // card step the student has open
    serialLines: [],   // real board: complete serial lines since the last upload (sent to the tutor)
    serialPartial: "",
    simLines: [],      // simulator: serial lines since the last simulator run
    simPartial: "",
    asking: false,
    loadedCode: "",    // code as loaded, to tell whether the student changed anything
    mode: "sim",       // "sim" | "board"
    saveKey: null,     // card whose work autosaves (null for the hello test and seeded faults)
    saveTimer: null,
    pending: {},       // unsaved fields: { code, sim }
  };

  const LEARNER_ID = /^l_[a-z0-9]{3,12}$/;

  // ---------- helpers ----------
  async function postJson(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let reason = "";
      try { reason = (await r.json()).error || ""; } catch (_) { /* not JSON */ }
      throw new Error(`${url} returned ${r.status}${reason ? `: ${reason}` : ""}`);
    }
    return r.json();
  }

  function show(el, parts) {
    el.replaceChildren(...parts.map(([cls, text]) => {
      const span = document.createElement("div");
      if (cls) span.className = cls;
      span.textContent = text;
      return span;
    }));
  }

  function setBoardStatus(text, kind) {
    const pill = $("board-status");
    pill.textContent = text;
    pill.className = `pill ${kind}`;
  }

  function boardName(info) {
    if (!info || info.usbVendorId === undefined) return "unknown USB chip";
    const known = (state.config?.known_boards || []).find(
      (b) => b.usbVendorId === info.usbVendorId && b.usbProductId === info.usbProductId);
    const id = `${info.usbVendorId.toString(16).padStart(4, "0")}:` +
      `${(info.usbProductId ?? 0).toString(16).padStart(4, "0")}`;
    return known ? `${known.name} [${id}]` : `unrecognized [${id}]`;
  }

  function refreshButtons() {
    const connected = !!state.transport?.isOpen;
    $("btn-compile").disabled = state.busy;
    $("btn-upload").disabled = state.busy || !connected;
    $("btn-connect").disabled = state.busy || connected || !("serial" in navigator);
    $("btn-disconnect").disabled = state.busy || !connected;
    $("baud").disabled = state.busy;
    $("btn-check").disabled = state.busy || state.asking;
    $("btn-hint").disabled = state.busy || state.asking;
    $("btn-sim-run-2").disabled = state.busy;
  }

  function collectSerial(text, source = "board") {
    const linesKey = source === "sim" ? "simLines" : "serialLines";
    const partKey = source === "sim" ? "simPartial" : "serialPartial";
    const parts = (state[partKey] + text).split(/\r?\n/);
    state[partKey] = parts.pop().slice(-300);
    const lines = state[linesKey];
    for (const line of parts) if (line.trim()) lines.push(line.slice(0, 300));
    if (lines.length > 300) lines.splice(0, lines.length - 300);
  }

  /** The serial lines the tutor should judge: from the simulator or the real board. */
  const currentSerial = () => (state.mode === "sim" ? state.simLines : state.serialLines);

  // ---------- mode: simulate or real board ----------
  function setMode(mode, remember = true) {
    if (mode !== "sim" && mode !== "board") return;
    state.mode = mode;
    document.body.classList.toggle("mode-sim", mode === "sim");
    document.body.classList.toggle("mode-board", mode === "board");
    $("mode-sim").setAttribute("aria-selected", String(mode === "sim"));
    $("mode-board").setAttribute("aria-selected", String(mode === "board"));
    $("check-source").textContent = mode === "sim" ? "using the simulator" : "using the real board";
    document.dispatchEvent(new CustomEvent("sprout:mode", { detail: mode }));
    if (remember) {
      try { localStorage.setItem("sprout.mode", mode); } catch (_) { /* storage may be blocked */ }
    }
    refreshButtons();
  }

  // ---------- line numbers ----------
  function updateGutter() {
    const n = $("code").value.split("\n").length;
    const errs = state.errorLines || new Set();
    const g = $("gutter");
    g.replaceChildren(...Array.from({ length: n }, (_, i) => {
      const span = document.createElement("span");
      span.textContent = `${i + 1}\n`;
      if (errs.has(i + 1)) span.className = "err-line";
      return span;
    }));
    g.scrollTop = $("code").scrollTop;
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

  // ---------- autosave (per learner and card, on the server) ----------
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
    } catch (e) {
      Object.assign(state.pending, body.code !== undefined ? { code: body.code } : {},
        body.sim !== undefined ? { sim: body.sim } : {});
      setSaveStatus("Not saved yet: the server is not reachable", true);
    }
  }

  function appendMonitor(text) {
    const mon = $("monitor");
    const atBottom = mon.scrollTop + mon.clientHeight >= mon.scrollHeight - 4;
    mon.textContent = (mon.textContent + text).slice(-20000);
    if (atBottom) mon.scrollTop = mon.scrollHeight;
  }

  // ---------- compile ----------
  async function compile() {
    const code = $("code").value;
    if (state.compiled && state.compiled.code === code) return state.compiled;
    show($("compile-out"), [["muted", "Compiling on the server…"]]);
    $("size").textContent = "";
    const r = await postJson("/api/weblab/compile",
      { code, learner: state.learner, card_id: state.cardId });
    if (!r.ok) {
      state.compiled = null;
      state.errorLines = new Set(r.errors.filter((e) => e.line).map((e) => e.line));
      const out = $("compile-out");
      out.replaceChildren(...r.errors.map((e) => {
        const div = document.createElement("div");
        div.className = e.line ? "err jump" : "err";
        div.textContent = e.line ? `Line ${e.line}: ${e.message}` : e.message;
        if (e.line) {
          div.title = "Show this line in the editor";
          div.addEventListener("click", () => jumpToLine(e.line));
        }
        return div;
      }));
      updateGutter();
      return null;
    }
    state.errorLines = new Set();
    updateGutter();
    state.compiled = { code, hex: r.hex, flash_bytes: r.flash_bytes, flash_max: r.flash_max };
    show($("compile-out"), [["ok", `Compiled in ${(r.compile_ms / 1000).toFixed(1)} s.`]]);
    if (r.flash_bytes) {
      $("size").textContent = `uses ${r.flash_bytes} of ${r.flash_max} bytes`;
    }
    return state.compiled;
  }

  // ---------- board ----------
  async function connect() {
    const filters = $("all-ports").checked ? [] : (state.config?.known_boards || [])
      .map((b) => ({ usbVendorId: b.usbVendorId, usbProductId: b.usbProductId }));
    let port;
    try {
      port = await navigator.serial.requestPort(filters.length ? { filters } : {});
    } catch (e) {
      // The user closed the chooser, or no matching board: keep quiet unless it is unexpected.
      if (e.name !== "NotFoundError") show($("upload-out"), [["err", e.message]]);
      else show($("upload-out"), [["muted",
        "No board chosen. If your board is not listed, tick “show all ports” and try again."]]);
      return;
    }
    await openPort(port, Number($("baud").value));
  }

  async function openPort(port, baud) {
    const t = new WebSerialTransport(port);
    t.onData = (chunk) => {
      const text = state.decoder.decode(chunk, { stream: true });
      appendMonitor(text);
      collectSerial(text);
    };
    t.onLost = () => {
      setBoardStatus("connection lost", "off");
      state.transport = null;
      refreshButtons();
    };
    try {
      await t.open(baud);
    } catch (e) {
      show($("upload-out"), [["err",
        `Could not open the port: ${e.message}. Close the Arduino IDE or any other program ` +
        "using the board, then try again."]]);
      return;
    }
    state.port = port;
    state.transport = t;
    setBoardStatus(boardName(port.getInfo()), "on");
    show($("upload-out"), [["muted", "Connected. Press “Upload to board”."]]);
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
      usb_vendor_id: info.usbVendorId, usb_product_id: info.usbProductId,
      browser: navigator.userAgent.slice(0, 200) };
    try {
      const c = await compile();
      if (!c) {
        trial.error_code = "compile_error";
        return;
      }
      const image = parseIntelHex(c.hex);
      trial.bytes = image.length;
      progress.hidden = false;
      bar.style.width = "0%";
      show(out, [["muted", "Uploading… (the board's lights will flicker)"]]);
      setBoardStatus("uploading", "busy");

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
      show(out, [["ok", `Uploaded and verified ${r.bytes} bytes in ${(r.ms / 1000).toFixed(1)} s.`]]);
    } catch (e) {
      trial.error_code = e.code || e.name || "error";
      show(out, [["err", e.message]]);
      if (e.trace) {
        trial.note = e.trace.split("\n").slice(-6).join(" | ").slice(0, 200);
        const det = document.createElement("details");
        const sum = document.createElement("summary");
        sum.textContent = "Technical details (protocol bytes)";
        const pre = document.createElement("pre");
        pre.className = "trace";
        pre.textContent = e.trace;
        det.append(sum, pre);
        out.appendChild(det);
        console.log("[weblab] upload trace\n" + e.trace);
      }
    } finally {
      try {
        if (t && t.isOpen !== undefined) {
          t.mode = "monitor";
          state.decoder = new TextDecoder();
          await t.reopen(Number($("baud").value));
          setBoardStatus(boardName(state.port.getInfo()), "on");
        }
      } catch (e) {
        setBoardStatus("connection lost", "off");
        state.transport = null;
        show(out, [["err", `${out.textContent}\nThe port closed: ${e.message}`]]);
      }
      progress.hidden = true;
      state.busy = false;
      refreshButtons();
      if (trial.error_code !== "compile_error") recordTrial(trial);
      if (state.cardId && trial.error_code !== "compile_error") {
        postJson("/api/weblab/upload_done", { learner: state.learner, card_id: state.cardId,
          code: $("code").value, ok: trial.ok, error_code: trial.error_code })
          .catch(() => { /* logging is best-effort */ });
      }
    }
  }

  function recordTrial(trial) {
    state.trials.push(trial);
    const tr = document.createElement("tr");
    const cells = [trial.attempt, trial.ok ? "OK" : `failed (${trial.error_code})`,
      trial.ok ? `${(trial.upload_ms / 1000).toFixed(1)} s` : "–", trial.bytes || "–",
      boardName({ usbVendorId: trial.usb_vendor_id, usbProductId: trial.usb_product_id })];
    for (const c of cells) {
      const td = document.createElement("td");
      td.textContent = String(c);
      tr.appendChild(td);
    }
    $("trials").appendChild(tr);
    const ok = state.trials.filter((x) => x.ok).length;
    $("trial-count").textContent = `(${ok}/${state.trials.length} succeeded)`;
    const body = Object.fromEntries(Object.entries(trial).filter(([, v]) => v !== undefined));
    postJson("/api/weblab/trial", body).catch(() => { /* logging is best-effort */ });
  }

  // ---------- card and tutor ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function renderCard() {
    const card = state.cardId ? state.config.cards[state.cardId] : null;
    $("card-empty").hidden = !!card;
    $("card-body").hidden = !card;
    $("check-out").replaceChildren();
    $("hints").replaceChildren();
    $("question").value = "";
    $("restart-confirm").hidden = true;
    state.stepId = null;
    if (!card) {
      const buttons = Object.values(state.config.cards).map((c) => {
        const b = el("button");
        b.append(el("span", "stage", c.stage), el("span", "", c.title));
        b.addEventListener("click", () => {
          const sel = $("sketch");
          sel.value = c.id; // the card's starter sketch
          sel.dispatchEvent(new Event("change"));
        });
        return b;
      });
      $("card-picker").replaceChildren(...buttons);
      return;
    }
    $("card-title").textContent = card.title;
    $("card-ag").textContent = card.agriculture_connection;
    $("card-safety").replaceChildren(...card.safety.map((x) => el("li", "", x)));
    $("card-safety").hidden = card.safety.length === 0;
    const steps = card.steps.map((st, i) => {
      const d = el("details");
      d.append(el("summary", "", `${i + 1}. ${st.kind[0].toUpperCase()}${st.kind.slice(1)}`),
        el("p", "", st.text));
      if (st.kind === "simulate") {
        d.append(el("p", "muted", "Use Simulate mode (top right): wire the parts and run your code there first."));
      }
      d.addEventListener("toggle", () => {
        if (!d.open) return;
        state.stepId = st.id;
        for (const other of $("card-steps").children) if (other !== d) other.open = false;
        // Simulate first, then build and run on the real board.
        if (st.kind === "simulate") setMode("sim");
        else if (st.kind === "build" || st.kind === "run") setMode("board");
      });
      return d;
    });
    $("card-steps").replaceChildren(...steps);
  }

  /** Back to the card list. The work is autosaved, so nothing is lost. */
  async function goBack() {
    const changed = $("code").value !== state.loadedCode;
    await flushSave();
    if (state.cardId) {
      postJson("/api/weblab/card_leave", { learner: state.learner, card_id: state.cardId,
        code: $("code").value, changed }).catch(() => { /* logging is best-effort */ });
    }
    const sel = $("sketch");
    sel.value = "hello";
    sel.dispatchEvent(new Event("change"));
  }

  /** Start over: delete the saved code and wiring, then reload the starter. */
  async function startOver() {
    $("restart-confirm").hidden = true;
    const key = state.saveKey || state.cardId;
    state.pending = {};
    clearTimeout(state.saveTimer);
    if (key) {
      try {
        await postJson("/api/weblab/discard", { learner: state.learner, card_id: key });
      } catch (_) { /* the reload below still resets the page */ }
    }
    await loadSketch(true);
    setSaveStatus("Started over");
  }

  async function openCard() {
    renderCard();
    if (!state.cardId) return;
    try {
      await postJson("/api/weblab/card_open", { learner: state.learner, card_id: state.cardId });
    } catch (_) { /* logging is best-effort */ }
  }

  async function checkWork() {
    if (!state.cardId) return; // the hello test has no card to check
    state.asking = true;
    refreshButtons();
    try {
      const r = await postJson("/api/weblab/check", { learner: state.learner, card_id: state.cardId,
        code: $("code").value, serial: currentSerial(), source: state.mode });
      const rows = r.results.map((x) =>
        el("div", x.passed ? "pass" : "todo", `${x.passed ? "✓" : "○"} ${x.id}: ${x.detail}`));
      if (r.all_passed && r.completes_card) {
        rows.push(el("div", "done", "Card complete on the real board. Go on to the Reflect step."));
      } else if (r.all_passed) {
        rows.push(el("div", "done", "It works in the simulator. Now build it on the real board " +
          "(Real board mode) and check again to complete the card."));
      }
      $("check-out").replaceChildren(...rows);
    } catch (e) {
      $("check-out").replaceChildren(el("div", "todo", `Could not check: ${e.message}`));
    } finally {
      state.asking = false;
      refreshButtons();
    }
  }

  async function askHint() {
    if (!state.cardId) return; // the tutor works per card
    state.asking = true;
    refreshButtons();
    const message = $("question").value;
    try {
      const r = await postJson("/api/weblab/hint", { learner: state.learner, card_id: state.cardId,
        code: $("code").value, serial: currentSerial(), message, step_id: state.stepId });
      const box = el("div", "hint");
      const meta = el("div", "meta");
      meta.append(el("b", "", r.source_label), document.createTextNode(
        ` · hint ${r.step} of ${r.max_step} (${r.step_name})`));
      box.append(meta, el("div", "body", r.text));
      $("hints").appendChild(box);
      $("question").value = "";
    } catch (e) {
      const box = el("div", "hint err");
      box.append(el("div", "body", `The tutor is not available right now (${e.message}).`));
      $("hints").appendChild(box);
    } finally {
      state.asking = false;
      refreshButtons();
    }
  }

  // ---------- hooks for the simulator module (sim.js) ----------
  window.SproutLab = {
    compile: () => compile(),                 // { hex, ... } or null (errors shown under the editor)
    resetSerial: () => { state.simLines = []; state.simPartial = ""; },
    feedSerial: (text) => collectSerial(text, "sim"), // checks in Simulate mode use this output
    currentCard: () => simCard(),
    simStarted: () => {
      if (!state.cardId) return;
      postJson("/api/weblab/sim_run", { learner: state.learner, card_id: state.cardId,
        code: $("code").value }).catch(() => { /* logging is best-effort */ });
    },
  };
  document.addEventListener("sprout:simchange", (ev) => queueSave({ sim: ev.detail }));

  function simCard() {
    const card = state.cardId ? state.config.cards[state.cardId] : null;
    return card ? { cardId: card.id, title: card.title, parts: card.parts } : null;
  }

  /** Show the selected sketch. A card's own sketch comes back with the student's saved code and
   *  wiring; starting over (fresh = true) ignores what was saved. */
  async function loadSketch(fresh) {
    await flushSave();
    const sel = $("sketch");
    const s = state.config.sketches.find((x) => x.id === sel.value);
    const cardId = s ? s.card_id : null;
    state.saveKey = s && s.card_id && s.id === s.card_id ? s.card_id : null;
    let code = s ? s.code : "";
    let sim = null;
    if (state.saveKey && !fresh) {
      try {
        const w = await postJson("/api/weblab/work", { learner: state.learner, card_id: state.saveKey });
        if (typeof w.code === "string") code = w.code;
        sim = w.sim;
        setSaveStatus(w.code ? "Your saved work" : "");
      } catch (_) {
        setSaveStatus("Could not load saved work", true);
      }
    } else {
      setSaveStatus(state.saveKey ? "" : cardId ? "Practice sketch: not saved" : "");
    }
    $("code").value = code;
    state.loadedCode = code;
    state.compiled = null;
    state.errorLines = new Set();
    updateGutter();
    $("size").textContent = "";
    show($("compile-out"), []);
    state.simLines = [];
    state.cardId = cardId;
    openCard();
    document.dispatchEvent(new CustomEvent("sprout:card", { detail: { ...(simCard() || {}), sim } }));
  }

  // ---------- start ----------
  async function init() {
    if (!("serial" in navigator)) $("unsupported").hidden = false;
    const r = await fetch("/api/weblab/config");
    state.config = await r.json();
    if (!state.config.compiler_ready) $("no-compiler").hidden = false;
    if (state.config.test_mode && $("sim-example")) $("sim-example").hidden = false;
    let savedMode = "sim";
    try { savedMode = localStorage.getItem("sprout.mode") || "sim"; } catch (_) { /* blocked */ }
    setMode(savedMode, false);
    const fromUrl = new URLSearchParams(location.search).get("learner");
    if (fromUrl && LEARNER_ID.test(fromUrl)) state.learner = fromUrl;
    $("learner").textContent = state.learner;
    $("llm-mode").textContent = state.config.llm_provider === "anthropic" ? "AI: Claude" : "AI: offline mock";
    const sel = $("sketch");
    for (const s of state.config.sketches) {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.title;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => loadSketch(false));
    renderCard(); // draw the card picker before any card is chosen
    await loadSketch(false);
    $("baud").value = String(state.config.default_baud || 9600);

    $("code").addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = e.target;
        const { selectionStart: a, selectionEnd: b } = ta;
        ta.setRangeText("  ", a, b, "end");
      }
    });
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
    $("btn-back").addEventListener("click", goBack);
    $("btn-restart").addEventListener("click", () => {
      $("restart-confirm").hidden = false;
      $("btn-restart-no").focus();
    });
    $("btn-restart-yes").addEventListener("click", startOver);
    $("btn-restart-no").addEventListener("click", () => { $("restart-confirm").hidden = true; });
    $("mode-sim").addEventListener("click", () => setMode("sim"));
    $("mode-board").addEventListener("click", () => setMode("board"));
    $("btn-sim-run-2").addEventListener("click", () => $("sim-run").click());
    $("code").addEventListener("input", () => {
      updateGutter();
      queueSave({ code: $("code").value });
    });
    $("code").addEventListener("scroll", () => { $("gutter").scrollTop = $("code").scrollTop; });
    window.addEventListener("pagehide", () => { flushSave(true); });
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
          setBoardStatus("unplugged", "off");
          refreshButtons();
        }
      });
    }
    refreshButtons();
  }

  init().catch((e) => show($("compile-out"), [["err", `Could not load the page: ${e.message}`]]));
})();
