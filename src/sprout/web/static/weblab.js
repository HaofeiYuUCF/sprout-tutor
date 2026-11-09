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
    serialLines: [],   // complete serial lines since the last upload (sent to the tutor)
    serialPartial: "",
    asking: false,
    loadedCode: "",    // code as loaded, to tell whether the student changed anything
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
  }

  function collectSerial(text) {
    const parts = (state.serialPartial + text).split(/\r?\n/);
    state.serialPartial = parts.pop().slice(-300);
    for (const line of parts) if (line.trim()) state.serialLines.push(line.slice(0, 300));
    if (state.serialLines.length > 300) state.serialLines.splice(0, state.serialLines.length - 300);
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
      show($("compile-out"), r.errors.map((e) =>
        ["err", e.line ? `Line ${e.line}: ${e.message}` : e.message]));
      return null;
    }
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
    $("back-confirm").hidden = true;
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
      if (st.kind === "simulate") d.append(el("p", "muted", `Tinkercad: ${card.tinkercad}`));
      d.addEventListener("toggle", () => {
        if (!d.open) return;
        state.stepId = st.id;
        for (const other of $("card-steps").children) if (other !== d) other.open = false;
      });
      return d;
    });
    $("card-steps").replaceChildren(...steps);
  }

  function goBack() {
    const changed = $("code").value !== state.loadedCode;
    if (state.cardId) {
      postJson("/api/weblab/card_leave", { learner: state.learner, card_id: state.cardId,
        code: $("code").value, changed }).catch(() => { /* logging is best-effort */ });
    }
    const sel = $("sketch");
    sel.value = "hello";
    sel.dispatchEvent(new Event("change"));
  }

  function askBack() {
    if ($("code").value === state.loadedCode) {
      goBack(); // nothing to lose
      return;
    }
    $("back-confirm").hidden = false;
    $("btn-stay").focus();
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
        code: $("code").value, serial: state.serialLines });
      const rows = r.results.map((x) =>
        el("div", x.passed ? "pass" : "todo", `${x.passed ? "✓" : "○"} ${x.id}: ${x.detail}`));
      if (r.all_passed) rows.push(el("div", "done", "Card complete. Go on to the Reflect step."));
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
        code: $("code").value, serial: state.serialLines, message, step_id: state.stepId });
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
    resetSerial: () => { state.serialLines = []; state.serialPartial = ""; },
    feedSerial: (text) => collectSerial(text), // simulated output also counts for Check my work
  };

  // ---------- start ----------
  async function init() {
    if (!("serial" in navigator)) $("unsupported").hidden = false;
    const r = await fetch("/api/weblab/config");
    state.config = await r.json();
    if (!state.config.compiler_ready) $("no-compiler").hidden = false;
    if (state.config.test_mode && $("sim-example")) $("sim-example").hidden = false;
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
    const load = () => {
      const s = state.config.sketches.find((x) => x.id === sel.value);
      $("code").value = s ? s.code : "";
      state.loadedCode = $("code").value;
      state.compiled = null;
      $("size").textContent = "";
      show($("compile-out"), []);
      const cardId = s ? s.card_id : null;
      if (cardId !== state.cardId || cardId) {
        state.cardId = cardId;
        openCard();
      }
    };
    sel.addEventListener("change", load);
    renderCard(); // draw the card picker before any card is chosen
    load();
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
    $("btn-back").addEventListener("click", askBack);
    $("btn-discard").addEventListener("click", goBack);
    $("btn-stay").addEventListener("click", () => { $("back-confirm").hidden = true; });
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
