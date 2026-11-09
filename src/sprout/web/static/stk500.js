/* SPROUT Web Lab: upload an Intel HEX image to an Arduino UNO (Optiboot, STK500 v1) from the
 * browser over Web Serial. Written for this project from the public STK500 protocol description
 * (Atmel AVR061); no third-party code.
 *
 * The uploader talks to a "transport" with: write(bytes), read(n, timeoutMs), clearInput(),
 * setSignals({dataTerminalReady, requestToSend}). WebSerialTransport wraps a real port; tests use
 * a simulated bootloader with the same methods.
 */
(function (global) {
  "use strict";

  const STK = {
    OK: 0x10, INSYNC: 0x14, NOSYNC: 0x15, CRC_EOP: 0x20,
    GET_SYNC: 0x30, ENTER_PROGMODE: 0x50, LEAVE_PROGMODE: 0x51,
    LOAD_ADDRESS: 0x55, PROG_PAGE: 0x64, READ_PAGE: 0x74, READ_SIGN: 0x75,
  };

  const UNO = {
    signature: [0x1e, 0x95, 0x0f], // ATmega328P
    pageSize: 128,
    maxBytes: 32256, // 32 KB flash minus the 512-byte Optiboot bootloader
    uploadBaud: 115200,
  };

  class UploadError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "UploadError";
      this.code = code;
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hex2 = (b) => b.toString(16).toUpperCase().padStart(2, "0");

  /** Parse Intel HEX text into a flash image starting at address 0 (gaps filled with 0xFF). */
  function parseIntelHex(text) {
    const chunks = [];
    let base = 0;
    let end = 0;
    let sawEof = false;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && !sawEof; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line[0] !== ":" || line.length < 11 || line.length % 2 === 0) {
        throw new UploadError("bad_hex", `HEX line ${i + 1} is malformed.`);
      }
      const bytes = [];
      for (let j = 1; j < line.length; j += 2) {
        const v = parseInt(line.substr(j, 2), 16);
        if (Number.isNaN(v)) throw new UploadError("bad_hex", `HEX line ${i + 1} has a bad digit.`);
        bytes.push(v);
      }
      const count = bytes[0];
      if (bytes.length !== count + 5) {
        throw new UploadError("bad_hex", `HEX line ${i + 1} has the wrong length.`);
      }
      const sum = bytes.reduce((a, b) => (a + b) & 0xff, 0);
      if (sum !== 0) throw new UploadError("bad_hex", `HEX line ${i + 1} fails its checksum.`);
      const addr = (bytes[1] << 8) | bytes[2];
      const type = bytes[3];
      const data = bytes.slice(4, 4 + count);
      if (type === 0x00) {
        const at = base + addr;
        chunks.push([at, data]);
        end = Math.max(end, at + data.length);
      } else if (type === 0x01) {
        sawEof = true;
      } else if (type === 0x02) {
        base = ((data[0] << 8) | data[1]) << 4;
      } else if (type === 0x04) {
        base = ((data[0] << 8) | data[1]) << 16;
      } // 0x03 / 0x05 (start address) do not matter for AVR flash
    }
    if (!sawEof) throw new UploadError("bad_hex", "The HEX file has no end record.");
    const image = new Uint8Array(end).fill(0xff);
    for (const [at, data] of chunks) image.set(data, at);
    return image;
  }

  class Stk500Uploader {
    constructor(transport, opts = {}) {
      this.t = transport;
      this.chip = Object.assign({}, UNO, opts.chip || {});
      this.syncAttempts = opts.syncAttempts ?? 10;
      this.log = opts.log || (() => {});
      this.onProgress = opts.onProgress || (() => {});
      this.trace = []; // [ms, "tx"|"rx"|"note", text], for diagnosing failures on real boards
      this.t0 = performance.now();
    }

    note(dir, text) {
      this.trace.push([Math.round(performance.now() - this.t0), dir, text]);
      if (this.trace.length > 400) this.trace.splice(0, this.trace.length - 400);
    }

    traceText(last = 40) {
      return this.trace.slice(-last).map(([ms, d, t]) => `${String(ms).padStart(6)} ms ${d.padEnd(4)} ${t}`).join("\n");
    }

    async rx(n, timeoutMs) {
      try {
        const got = await this.t.read(n, timeoutMs);
        this.note("rx", [...got].map(hex2).join(" "));
        return got;
      } catch (e) {
        this.note("rx", `(nothing within ${timeoutMs} ms)`);
        throw e;
      }
    }

    /** Send one command (CRC_EOP appended); return the `respLen` data bytes between INSYNC and OK. */
    async cmd(bytes, respLen = 0, timeoutMs = 500) {
      const out = Uint8Array.from([...bytes, STK.CRC_EOP]);
      this.note("tx", out.length > 12 ? `${[...out.subarray(0, 4)].map(hex2).join(" ")} … (${out.length} bytes)`
        : [...out].map(hex2).join(" "));
      await this.t.write(out);
      const head = await this.rx(1, timeoutMs);
      if (head[0] !== STK.INSYNC) {
        throw new UploadError("not_in_sync",
          `The board answered 0x${hex2(head[0])} instead of "in sync" (command 0x${hex2(bytes[0])}).`);
      }
      const data = respLen ? await this.rx(respLen, timeoutMs) : new Uint8Array(0);
      const tail = await this.rx(1, timeoutMs);
      if (tail[0] !== STK.OK) {
        throw new UploadError("not_ok", `The board did not confirm command 0x${hex2(bytes[0])}.`);
      }
      return data;
    }

    /** Pulse DTR/RTS: the UNO's auto-reset circuit restarts the chip into the bootloader. */
    async reset() {
      this.note("note", "reset: DTR/RTS off");
      await this.t.setSignals({ dataTerminalReady: false, requestToSend: false });
      await sleep(250);
      this.note("note", "reset: DTR/RTS on");
      await this.t.setSignals({ dataTerminalReady: true, requestToSend: true });
      await sleep(50);
      this.note("note", `discarding ${this.t.bufferedCount ? this.t.bufferedCount() : "?"} buffered bytes`);
      this.t.clearInput(); // drop whatever the old sketch was still printing
    }

    /** Discard bytes that arrive over the next `ms` (late replies, old-sketch output). */
    async drain(ms) {
      await sleep(ms);
      const n = this.t.bufferedCount ? this.t.bufferedCount() : 0;
      if (n) this.note("note", `drained ${n} stray byte(s)`);
      this.t.clearInput();
    }

    /** Get in sync, then confirm with a second GET_SYNC after a drain, so a late or duplicate
     *  reply cannot leave the byte stream misaligned (Optiboot drops to the old sketch if it
     *  receives a malformed command). */
    async sync() {
      let last = null;
      for (let i = 0; i < this.syncAttempts; i++) {
        this.t.clearInput();
        let first = false;
        try {
          await this.cmd([STK.GET_SYNC], 0, 250);
          first = true;
          await this.drain(30);
          await this.cmd([STK.GET_SYNC], 0, 250);
          this.log(`in sync after ${i + 1} attempt(s)`);
          return i + 1;
        } catch (e) {
          if (first) { // answered once, then went silent: it left the bootloader, so reset again
            throw new UploadError("lost_sync", `The board left the bootloader during the handshake (${e.message})`);
          }
          last = e;
          await this.drain(60);
        }
      }
      throw new UploadError("no_sync",
        "The board did not answer the upload request. Check the USB cable, make sure no other " +
        "program (Arduino IDE, the desktop workbench) has the port open, and try again." +
        (last ? ` (${last.message})` : ""));
    }

    /** Reset, sync and read the signature; redo the whole handshake if the board drops out of
     *  the bootloader (nothing has been written yet, so retrying is safe). */
    async handshake(tries = 3) {
      let last = null;
      for (let k = 1; k <= tries; k++) {
        try {
          await this.reset();
          const syncAttempts = await this.sync();
          const sig = await this.cmd([STK.READ_SIGN], 3);
          return { sig, syncAttempts, handshakes: k };
        } catch (e) {
          last = e;
          if (!["not_in_sync", "not_ok", "timeout", "lost_sync"].includes(e.code) || k === tries) throw e;
          this.note("note", `handshake ${k} failed (${e.code}); resetting again`);
          await this.drain(100);
        }
      }
      throw last;
    }

    /** Write and verify `image` (Uint8Array from address 0). Resolves to a summary object;
     *  a thrown UploadError carries `.trace` (the last protocol bytes) for diagnosis. */
    async upload(image) {
      try {
        return await this._upload(image);
      } catch (e) {
        e.trace = this.traceText();
        throw e;
      }
    }

    async _upload(image) {
      const { pageSize, maxBytes, signature } = this.chip;
      if (image.length === 0) throw new UploadError("empty", "The program is empty.");
      if (image.length > maxBytes) {
        throw new UploadError("too_big", `The program is ${image.length} bytes; the UNO holds ${maxBytes}.`);
      }
      const t0 = performance.now();
      const { sig, syncAttempts, handshakes } = await this.handshake();
      if (sig.some((b, i) => b !== signature[i])) {
        throw new UploadError("wrong_chip",
          `This board's chip signature is ${[...sig].map(hex2).join(" ")}, not an UNO ` +
          `(${signature.map(hex2).join(" ")}).`);
      }
      await this.cmd([STK.ENTER_PROGMODE]);

      const pages = Math.ceil(image.length / pageSize);
      const pageAt = (addr) => {
        const page = new Uint8Array(pageSize).fill(0xff);
        page.set(image.subarray(addr, Math.min(addr + pageSize, image.length)));
        return page;
      };
      const loadAddress = (addr) => {
        const word = addr >> 1; // STK500 addresses flash in 16-bit words
        return this.cmd([STK.LOAD_ADDRESS, word & 0xff, (word >> 8) & 0xff]);
      };

      for (let p = 0; p < pages; p++) {
        const addr = p * pageSize;
        await loadAddress(addr);
        await this.cmd([STK.PROG_PAGE, pageSize >> 8, pageSize & 0xff, 0x46, ...pageAt(addr)], 0, 1000);
        this.onProgress({ phase: "write", done: p + 1, total: pages });
      }
      for (let p = 0; p < pages; p++) {
        const addr = p * pageSize;
        await loadAddress(addr);
        const got = await this.cmd([STK.READ_PAGE, pageSize >> 8, pageSize & 0xff, 0x46], pageSize, 1000);
        const want = pageAt(addr);
        for (let i = 0; i < pageSize; i++) {
          if (got[i] !== want[i]) {
            throw new UploadError("verify_failed",
              `Verification failed at address 0x${(addr + i).toString(16)}: the board holds ` +
              `0x${hex2(got[i])}, expected 0x${hex2(want[i])}. Try uploading again.`);
          }
        }
        this.onProgress({ phase: "verify", done: p + 1, total: pages });
      }
      await this.cmd([STK.LEAVE_PROGMODE]); // Optiboot then starts the new sketch
      return { bytes: image.length, pages, syncAttempts, handshakes, ms: Math.round(performance.now() - t0) };
    }
  }

  /** A Web Serial port with one background reader. In "monitor" mode bytes go to onData; in
   *  "upload" mode they are buffered for the uploader's read(). */
  class WebSerialTransport {
    constructor(port) {
      this.port = port;
      this.buf = [];
      this.waiters = [];
      this.mode = "monitor";
      this.onData = null;
      this.onLost = null;
      this.isOpen = false;
    }

    async open(baudRate) {
      await this.port.open({ baudRate, bufferSize: 4096 });
      this.baudRate = baudRate;
      this.isOpen = true;
      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();
      this.readLoop = (async () => {
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value && value.length) this._push(value);
          }
        } catch (e) {
          if (this.isOpen && this.onLost) this.onLost(e);
        } finally {
          try { this.reader.releaseLock(); } catch (_) { /* already released */ }
        }
      })();
    }

    async close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      try { await this.reader.cancel(); } catch (_) { /* port already gone */ }
      await this.readLoop;
      try { this.writer.releaseLock(); } catch (_) { /* ignore */ }
      try { await this.port.close(); } catch (_) { /* unplugged */ }
    }

    async reopen(baudRate) {
      await this.close();
      await this.open(baudRate);
    }

    _push(chunk) {
      if (this.mode === "monitor") {
        if (this.onData) this.onData(chunk);
        return;
      }
      for (const b of chunk) this.buf.push(b);
      this.waiters = this.waiters.filter((w) => !w());
    }

    async write(bytes) {
      await this.writer.write(bytes);
    }

    clearInput() {
      this.buf.length = 0;
    }

    bufferedCount() {
      return this.buf.length;
    }

    read(n, timeoutMs) {
      return new Promise((resolve, reject) => {
        let timer = null;
        const take = () => {
          if (this.buf.length < n) return false;
          clearTimeout(timer);
          resolve(Uint8Array.from(this.buf.splice(0, n)));
          return true;
        };
        if (take()) return;
        timer = setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== take);
          reject(new UploadError("timeout", `No answer from the board within ${timeoutMs} ms.`));
        }, timeoutMs);
        this.waiters.push(take);
      });
    }

    async setSignals(signals) {
      await this.port.setSignals(signals);
    }
  }

  global.SproutUpload = { STK, UNO, UploadError, parseIntelHex, Stk500Uploader, WebSerialTransport };
})(typeof window !== "undefined" ? window : globalThis);
