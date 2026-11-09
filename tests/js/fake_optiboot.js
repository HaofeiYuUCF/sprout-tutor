/* A simulated UNO bootloader (Optiboot, STK500 v1) with the uploader's transport interface.
 * It answers only after a DTR reset, keeps a 32 KB flash, and can be told to misbehave. */
(function (global) {
  "use strict";
  const S = global.SproutUpload.STK;

  class FakeOptiboot {
    constructor(opts = {}) {
      this.signature = opts.signature || [0x1e, 0x95, 0x0f];
      this.alive = opts.alive ?? true;          // false = no bootloader / wrong port
      this.flipBitAt = opts.flipBitAt ?? null;  // corrupt one flash byte on write
      this.ignoreFirstSyncs = opts.ignoreFirstSyncs ?? 0; // bootloader still starting up
      this.dropToAppOnce = opts.dropToAppOnce ?? false;   // leaves the bootloader once, mid-handshake
      this.flash = new Uint8Array(32768).fill(0xff);
      this.inBuf = [];
      this.outBuf = (opts.staleOutput || "").split("").map((c) => c.charCodeAt(0));
      this.dtr = true;
      this.bootWindow = false;
      this.started = false;
      this.addr = 0;
      this.commands = [];
    }

    async setSignals({ dataTerminalReady }) {
      if (!this.dtr && dataTerminalReady) { // DTR asserted again: auto-reset pulse
        this.bootWindow = this.alive;
        this.started = false;
        this.outBuf.push(...[104, 101, 108, 108, 111]); // the old sketch prints once more
      }
      this.dtr = dataTerminalReady;
    }

    clearInput() { this.outBuf.length = 0; }

    async write(bytes) {
      this.inBuf.push(...bytes);
      this._process();
    }

    read(n, timeoutMs) {
      if (this.outBuf.length >= n) return Promise.resolve(Uint8Array.from(this.outBuf.splice(0, n)));
      return new Promise((_, reject) => setTimeout(() => reject(
        new global.SproutUpload.UploadError("timeout", `No answer within ${timeoutMs} ms.`)), Math.min(timeoutMs, 20)));
    }

    _need(cmd) {
      const b = this.inBuf;
      switch (cmd) {
        case S.LOAD_ADDRESS: return 4;
        case S.PROG_PAGE: return b.length >= 3 ? 4 + ((b[1] << 8) | b[2]) + 1 : Infinity;
        case S.READ_PAGE: return 5;
        default: return 2;
      }
    }

    _reply(data = []) { this.outBuf.push(S.INSYNC, ...data, S.OK); }

    _process() {
      while (this.inBuf.length) {
        const cmd = this.inBuf[0];
        const need = this._need(cmd);
        if (this.inBuf.length < need) return;
        const msg = this.inBuf.splice(0, need);
        if (!this.bootWindow) continue; // the running sketch ignores it
        this.commands.push(cmd);
        if (msg[msg.length - 1] !== S.CRC_EOP) { this.outBuf.push(S.NOSYNC); continue; }
        switch (cmd) {
          case S.GET_SYNC:
            if (this.ignoreFirstSyncs > 0) { this.ignoreFirstSyncs--; break; }
            this._reply();
            if (this.dropToAppOnce) { // like the real board: the old sketch starts printing
              this.dropToAppOnce = false;
              this.bootWindow = false;
              const text = "Adafruit PMSA003I Air Quality Sensor\r\n";
              this.outBuf.push(...text.split("").map((c) => c.charCodeAt(0)));
            }
            break;
          case S.READ_SIGN: this._reply(this.signature); break;
          case S.ENTER_PROGMODE: this._reply(); break;
          case S.LOAD_ADDRESS: this.addr = (msg[1] | (msg[2] << 8)) * 2; this._reply(); break;
          case S.PROG_PAGE: {
            const size = (msg[1] << 8) | msg[2];
            const data = msg.slice(4, 4 + size);
            this.flash.set(data, this.addr);
            if (this.flipBitAt !== null && this.flipBitAt >= this.addr && this.flipBitAt < this.addr + size) {
              this.flash[this.flipBitAt] ^= 0x01;
            }
            this._reply(); break;
          }
          case S.READ_PAGE: {
            const size = (msg[1] << 8) | msg[2];
            this._reply([...this.flash.subarray(this.addr, this.addr + size)]); break;
          }
          case S.LEAVE_PROGMODE: this._reply(); this.bootWindow = false; this.started = true; break;
          default: this._reply();
        }
      }
    }
  }

  global.FakeOptiboot = FakeOptiboot;
})(typeof window !== "undefined" ? window : globalThis);
