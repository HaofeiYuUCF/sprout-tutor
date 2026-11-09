/* SPROUT Web Lab: picture cards that help a beginner find each part in the ELEGOO kit.
 *
 * Each card shows a drawing (our own) and the tell-tale signs of the part. If a real photo of the
 * kit part is saved as /weblab/static/parts/<key>.jpg, the card shows the photo instead.
 */
(function (global) {
  "use strict";
  const S = (body, vb = "0 0 120 70") => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
  const lead = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#9aa0a6" stroke-width="2.5" stroke-linecap="round"/>`;
  const resistor = (bands) => S(
    `${lead(6, 35, 114, 35)}<rect x="34" y="25" width="52" height="20" rx="9" fill="#7fb2e0" stroke="#4f7fae"/>` +
    bands.map((c, i) => `<rect x="${41 + i * 8}" y="25" width="5" height="20" fill="${c}"/>`).join("") +
    `<rect x="76" y="25" width="5" height="20" fill="#7a4a12"/>`);
  const BK = "#151515", BR = "#7a4a12", RD = "#d22";

  const PARTS = [
    { key: "uno", re: /UNO/i, name: "Arduino UNO R3",
      svg: S(`<rect x="8" y="10" width="104" height="52" rx="5" fill="#13707e"/><rect x="2" y="18" width="16" height="14" rx="2" fill="#b8bcc2"/>` +
        `<rect x="30" y="13" width="76" height="6" fill="#1d1d1d"/><rect x="40" y="54" width="60" height="6" fill="#1d1d1d"/>` +
        `<rect x="52" y="32" width="40" height="12" rx="2" fill="#232323"/>`),
      tip: "The blue board. The USB socket is on the left; the pins along the edges are labeled 0–13, 5V, GND and A0–A5." },
    { key: "breadboard", re: /breadboard/i, name: "Breadboard",
      svg: S(`<rect x="6" y="8" width="108" height="54" rx="4" fill="#f1eee6" stroke="#cfcabd"/><line x1="12" y1="14" x2="108" y2="14" stroke="#d6336c"/>` +
        `<line x1="12" y1="56" x2="108" y2="56" stroke="#2f6fd6"/>` + Array.from({ length: 12 }, (_, i) =>
        `<g fill="#3d3a33">${[22, 28, 34, 42, 48].map((y) => `<rect x="${14 + i * 8}" y="${y}" width="3" height="3"/>`).join("")}</g>`).join("")),
      tip: "The white board full of holes. The five holes in each short column are connected. The long rows along the edges (red + and blue −) are the power rails." },
    { key: "led", re: /\bLED\b/i, name: "Red LED",
      svg: S(`${lead(52, 40, 52, 66)}${lead(66, 40, 66, 60)}<path d="M44 42 V22 a15 15 0 0 1 30 0 V42 Z" fill="#d22" opacity="0.9"/><rect x="41" y="40" width="36" height="5" rx="1" fill="#a11"/>` +
        `<text x="44" y="64" font-size="11" fill="#1d1d1d">+</text>`),
      tip: "Two legs: the longer leg is + (it goes toward the pin). The rim has a flat edge on the − side." },
    { key: "res220", re: /220 ohm/i, name: "220 Ω resistor", svg: resistor([RD, RD, BK, BK]),
      tip: "Bands: red, red, black, black, then a brown band set apart. It works either way round." },
    { key: "res1k", re: /(^|\D)1k ohm/i, name: "1k Ω resistor", svg: resistor([BR, BK, BK, BR]),
      tip: "Bands: brown, black, black, brown, then a brown band set apart." },
    { key: "res10k", re: /10k ohm/i, name: "10k Ω resistor", svg: resistor([BR, BK, BK, RD]),
      tip: "Bands: brown, black, black, red, then a brown band set apart. Do not mix it up with the 1k (fourth band brown)." },
    { key: "thermistor", re: /thermistor/i, name: "Thermistor (10k NTC)",
      svg: S(`${lead(50, 34, 44, 66)}${lead(70, 34, 76, 66)}<ellipse cx="60" cy="26" rx="13" ry="11" fill="#3a2c20"/>`),
      tip: "A small dark bead on two thin legs, with no plus or minus. Its resistance drops as it warms." },
    { key: "transistor", re: /transistor/i, name: "NPN transistor (PN2222)",
      svg: S(`${lead(46, 44, 46, 66)}${lead(60, 44, 60, 66)}${lead(74, 44, 74, 66)}<path d="M38 46 H82 V28 a22 18 0 0 0 -44 0 Z" fill="#2a2a2a"/>` +
        `<text x="44" y="40" font-size="8" fill="#ddd">PN2222A</text>`),
      tip: "Black half-round body with three legs. Read the print: with the flat face toward you, PN2222A is E, B, C from left to right. If it says P2N2222A, the order is C, B, E." },
    { key: "diode", re: /diode/i, name: "Diode (1N4007)",
      svg: S(`${lead(6, 35, 114, 35)}<rect x="40" y="26" width="40" height="18" rx="3" fill="#1f1f1f"/><rect x="70" y="26" width="6" height="18" fill="#c9c9c9"/>`),
      tip: "A black cylinder with a silver stripe at one end. The stripe is the − side (cathode); it goes toward 5V across the motor." },
    { key: "motor", re: /motor/i, name: "DC motor with fan blade",
      svg: S(`<rect x="30" y="22" width="42" height="28" rx="12" fill="#b9b2a1" stroke="#7e776a"/><line x1="72" y1="36" x2="86" y2="36" stroke="#777" stroke-width="3"/>` +
        `<g transform="translate(92 36)" fill="#f2f2f2" stroke="#8a8a8a"><ellipse cx="0" cy="-12" rx="4" ry="11"/><ellipse cx="0" cy="-12" rx="4" ry="11" transform="rotate(120)"/><ellipse cx="0" cy="-12" rx="4" ry="11" transform="rotate(240)"/></g>` +
        `<path d="M34 46 q-10 10 -24 12" stroke="#d22" stroke-width="2" fill="none"/><path d="M40 48 q-6 12 -26 16" stroke="#222" stroke-width="2" fill="none"/>`),
      tip: "A small metal motor with two wires. Push the fan blade onto its shaft. Either wire can go to 5V (that only changes the direction it spins)." },
    { key: "buzzer", re: /buzzer/i, name: "Active buzzer",
      svg: S(`${lead(52, 46, 52, 66)}${lead(68, 46, 68, 60)}<circle cx="60" cy="30" r="20" fill="#1b1b1b"/><circle cx="60" cy="30" r="4" fill="#444"/>` +
        `<text x="44" y="64" font-size="11" fill="#1d1d1d">+</text>`),
      tip: "The kit has two buzzers. Take the active one: its bottom is sealed in black (the passive one shows a green circuit board), and it often has a sticker on top. The longer leg is +." },
    { key: "jumper", re: /jumper/i, name: "Jumper wires",
      svg: S(`<path d="M14 50 C30 10, 70 10, 104 40" stroke="#e8862a" stroke-width="4" fill="none"/><path d="M14 58 C40 30, 80 30, 104 54" stroke="#1c7ed6" stroke-width="4" fill="none"/>`),
      tip: "Short wires with a pin on each end. Use red for 5V and black for GND to keep things clear." },
    { key: "usb", re: /USB/i, name: "USB cable",
      svg: S(`<rect x="10" y="26" width="22" height="16" rx="2" fill="#b8bcc2"/><path d="M32 34 C60 34, 60 50, 88 50" stroke="#2f6fd6" stroke-width="5" fill="none"/><rect x="88" y="44" width="20" height="12" rx="2" fill="#b8bcc2"/>`),
      tip: "Connects the UNO to the computer. Plug it in only after the circuit is built." },
  ];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /** Render picture cards for a card's parts list (strings like "1 × Thermistor (10k NTC)"). */
  function render(container, partNames) {
    container.replaceChildren(...partNames.map((full) => {
      const m = full.match(/^(\d+)\s*×\s*(.*)$/);
      const qty = m ? m[1] : "1";
      const label = m ? m[2] : full;
      const info = PARTS.find((p) => p.re.test(label));
      const card = el("figure", "part-card");
      const pic = el("div", "part-pic");
      pic.innerHTML = info ? info.svg : "";
      if (info) {   // a real photo of the kit part, if one has been added, replaces the drawing
        const img = new Image();
        img.alt = info.name;
        img.onload = () => pic.replaceChildren(img);
        img.src = `/weblab/static/parts/${info.key}.jpg`;
      }
      const cap = el("figcaption");
      cap.append(el("b", "", `${qty} × ${label}`));
      if (info) cap.append(el("span", "", info.tip));
      card.append(pic, cap);
      return card;
    }));
  }

  global.SproutParts = { render, PARTS };
})(window);
