/* SPROUT Web Lab: "Get to know your board".
 *
 * A simple 3D model of the UNO R3 used in class (black board), built from boxes and cylinders
 * so that every part is a click target we define, and every label is text we draw: on the top
 * of the board and on the outer side of the pin sockets, where students read it from their seat.
 * Units are millimetres. The board lies in the x-z plane: USB on the left (x = 0), digital pins
 * along the far edge (z = 0), power and analog pins along the near edge (z = 53).
 */
import * as THREE from "/weblab/static/vendor/three/three.module.min.js";

const W = 68.58, D = 53.34, T = 1.6;          // board size and thickness
const PITCH = 2.54, SOCKET_H = 8.5, SOCKET_D = 2.5;
const Z_TOP = 2.54, Z_BOTTOM = 50.8;           // centre lines of the two pin rows

// [id, x, label on the board, name shown to the student]
const TOP_PINS = [
  ["scl", 18.796, "", "SCL"], ["sda", 21.336, "", "SDA"], ["aref", 23.876, "AREF", "AREF"],
  ["gnd3", 26.416, "GND", "GND"], ["d13", 28.956, "13", "Pin 13"], ["d12", 31.496, "12", "Pin 12"],
  ["d11", 34.036, "~11", "Pin 11 (~)"], ["d10", 36.576, "~10", "Pin 10 (~)"], ["d9", 39.116, "~9", "Pin 9 (~)"],
  ["d8", 41.656, "8", "Pin 8"], ["d7", 45.72, "7", "Pin 7"], ["d6", 48.26, "~6", "Pin 6 (~)"],
  ["d5", 50.8, "~5", "Pin 5 (~)"], ["d4", 53.34, "4", "Pin 4"], ["d3", 55.88, "~3", "Pin 3 (~)"],
  ["d2", 58.42, "2", "Pin 2"], ["d1", 60.96, "TX 1", "Pin 1 (TX)"], ["d0", 63.5, "RX 0", "Pin 0 (RX)"],
];
const BOTTOM_PINS = [
  ["nc", 27.94, "", "Unused pin"], ["ioref", 30.48, "IOREF", "IOREF"], ["rstpin", 33.02, "RESET", "RESET pin"],
  ["v33", 35.56, "3.3V", "3.3V"], ["v5", 38.1, "5V", "5V"], ["gnd1", 40.64, "GND", "GND"],
  ["gnd2", 43.18, "GND", "GND"], ["vin", 45.72, "Vin", "Vin"],
  ["a0", 50.8, "A0", "Pin A0"], ["a1", 53.34, "A1", "Pin A1"], ["a2", 55.88, "A2", "Pin A2"],
  ["a3", 58.42, "A3", "Pin A3"], ["a4", 60.96, "A4", "Pin A4"], ["a5", 63.5, "A5", "Pin A5"],
];

// ------------------------------------------------------------------ what the student reads
const GROUPS = {
  digital: {
    title: "Digital pins 0 to 13",
    text: "Each of these pins is either ON (5 volts) or OFF (0 volts), and your code decides which. You use them to switch things, such as a light or a fan. The pins marked ~ can also dim a light or slow a motor.",
  },
  analog: {
    title: "Analog inputs A0 to A5",
    text: "These pins measure a voltage and give your code a number from 0 to 1023. You use them to read sensors that change smoothly, such as a temperature sensor.",
  },
  power: {
    title: "Power pins",
    text: "5V and GND are the two ends of the board's power. Every circuit is a loop: it starts at 5V or at a numbered pin and must come back to GND. The other pins in this group are for special cases; you will not need them in these cards.",
  },
};
const PARTS = {
  usb: { title: "USB port", text: "The cable to your computer plugs in here. It does two jobs: it gives the board power, and it carries your code to the board and the board's messages back to your screen." },
  jack: { title: "Power jack", text: "For a separate power supply when no computer is attached. You will not use it: the USB cable gives all the power you need." },
  reset: { title: "Reset button", text: "Press it to start your program again from the beginning. It does not erase your code." },
  chip: { title: "Microcontroller (the brain)", text: "This chip stores your code and runs it again and again. It reads the input pins and switches the output pins. Its name is ATmega328P." },
  usbchip: { title: "USB chip", text: "This small chip translates between the USB cable and the brain, so the computer and the board can talk to each other." },
  crystal: { title: "Clock crystal", text: "It ticks 16 million times a second and keeps the board's timing steady. That is how delay(1000) lasts exactly one second." },
  led_l: { title: "Light L", text: "A small built-in light, wired to pin 13. When you check that your board works, this is the light that blinks." },
  led_tx: { title: "Lights TX and RX", text: "They flicker when the board sends (TX) or receives (RX) data, for example while your code travels to the board." },
  led_on: { title: "Light ON", text: "It is lit whenever the board has power. If it is dark, check the USB cable." },
  icsp: { title: "ICSP pins", text: "A second way to load code, used in factories and for repairs. Leave these pins alone." },
  supply: { title: "Power parts", text: "These parts keep the board's voltage steady. You do not connect anything to them." },
};
const PIN_NOTES = {
  d9: "Card 1 connects the LED to pin 9.",
  d8: "Card 4 connects the buzzer to pin 8.",
  d13: "Pin 13 is also wired to the small light marked L on the board.",
  d0: "Pins 0 and 1 carry the messages between the board and the computer. Leave them free.",
  d1: "Pins 0 and 1 carry the messages between the board and the computer. Leave them free.",
  a0: "Card 2 connects the temperature sensor to A0.",
  gnd1: "GND is where every circuit returns. The board has three GND pins, and they are all the same.",
  gnd2: "GND is where every circuit returns. The board has three GND pins, and they are all the same.",
  gnd3: "GND is where every circuit returns. The board has three GND pins, and they are all the same.",
  v5: "5V gives power to your parts, for example to the temperature sensor in Card 2.",
  v33: "A second, lower supply. You will not need it in these cards.",
  vin: "You will not need this pin in these cards.",
  ioref: "You will not need this pin in these cards.",
  rstpin: "You will not need this pin in these cards.",
  aref: "You will not need this pin in these cards.",
  sda: "You will not need this pin in these cards.",
  scl: "You will not need this pin in these cards.",
  nc: "This pin is not connected to anything.",
};
const groupOf = (id) => (/^d\d+$/.test(id) ? "digital" : /^a\d$/.test(id) ? "analog" : "power");
const PIN_NAME = Object.fromEntries([...TOP_PINS, ...BOTTOM_PINS].map((p) => [p[0], p[3]]));

/** Title and text for a click target (a pin or a part). */
export function describe(id) {
  if (PARTS[id]) return { id, kind: "part", name: PARTS[id].title, title: PARTS[id].title, text: PARTS[id].text, note: "" };
  const g = GROUPS[groupOf(id)];
  return { id, kind: "pin", group: groupOf(id), name: PIN_NAME[id], title: `${PIN_NAME[id]}: one of the ${g.title.toLowerCase()}`,
    text: g.text, note: PIN_NOTES[id] || "" };
}
export const PART_LIST = [
  ["usb", "USB port"], ["d9", "Digital pins"], ["a0", "Analog inputs"], ["v5", "Power pins"],
  ["chip", "The brain"], ["reset", "Reset button"], ["led_l", "Light L"], ["led_on", "Light ON"],
  ["led_tx", "Lights TX and RX"], ["jack", "Power jack"], ["usbchip", "USB chip"],
  ["crystal", "Clock crystal"], ["icsp", "ICSP pins"], ["supply", "Power parts"],
];

// ------------------------------------------------------------------ drawing the labels
const PX = 16;                                   // texture pixels per millimetre
function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.round(w);
  c.height = Math.round(h);
  return c;
}
function texture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The printed top of the board: dark solder mask, faint traces, white labels. */
function topTexture() {
  const c = canvas(W * PX, D * PX), g = c.getContext("2d");
  g.fillStyle = "#17191c";
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "#20242a";                     // faint copper traces under the mask
  g.lineWidth = 2.2;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) {
    let x = (8 + rnd() * 56) * PX, y = (8 + rnd() * 38) * PX;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      if (rnd() < 0.5) x += (rnd() - 0.5) * 22 * PX; else y += (rnd() - 0.5) * 14 * PX;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const white = "#f1f3f4";
  g.fillStyle = white; g.strokeStyle = white;
  const text = (s, x, z, size, opt = {}) => {
    g.save();
    g.translate(x * PX, z * PX);
    if (opt.rot) g.rotate(opt.rot);
    g.font = `${opt.bold ? "700" : "600"} ${size * PX}px Arial, Helvetica, sans-serif`;
    g.textAlign = opt.align || "center";
    g.textBaseline = "middle";
    g.fillText(s, 0, 0);
    g.restore();
  };
  // pin names, turned on their side as on the real board, just inside each pin row
  for (const [, x, label] of TOP_PINS) if (label) text(label.replace(" ", ""), x, 4.6, 1.45, { rot: -Math.PI / 2, align: "right" });
  for (const [, x, label] of BOTTOM_PINS) if (label) text(label, x, 48.6, 1.45, { rot: -Math.PI / 2, align: "left" });
  const rule = (x1, x2, z) => { g.lineWidth = 0.22 * PX; g.beginPath(); g.moveTo(x1 * PX, z * PX); g.lineTo(x2 * PX, z * PX); g.stroke(); };
  rule(29, 64.5, 9.6);
  text("DIGITAL (PWM~)", 52.5, 10.9, 1.7, { bold: true });
  rule(34.5, 46.5, 43.6); text("POWER", 40.5, 42.3, 1.6, { bold: true });
  rule(49.8, 64.6, 43.6); text("ANALOG IN", 57.2, 42.3, 1.6, { bold: true });
  text("UNO R3", 40, 19.6, 3.4, { bold: true, align: "left" });
  text("L", 25.6, 10.9, 1.5); text("TX", 25.2, 16.6, 1.4); text("RX", 25.2, 19.3, 1.4);
  text("ON", 62.4, 16.6, 1.4);
  text("ICSP", 64.4, 31.0, 1.3);
  // outlines of the big parts
  g.lineWidth = 0.18 * PX;
  g.strokeRect(28.6 * PX, 32.2 * PX, 36.6 * PX, 9.6 * PX);
  for (const [x, z] of [[14.9, 2.5], [66.0, 17.8], [65.9, 45.8], [13.9, 50.9]]) {   // mounting holes
    g.fillStyle = "#07080a"; g.beginPath(); g.arc(x * PX, z * PX, 1.6 * PX, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#8d949b"; g.lineWidth = 0.35 * PX; g.stroke();
  }
  return texture(c);
}

/** Labels on the outer side of a pin socket. `flip`: the side faces away from +z. */
function sideTexture(pins, x0, x1, flip) {
  const pxmm = 28, h = SOCKET_H - 0.4;
  const c = canvas((x1 - x0) * pxmm, h * pxmm), g = c.getContext("2d");
  g.fillStyle = "#0e0f11";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#f1f3f4";
  for (const [, x, label, name] of pins) {
    const s = label || (name.length <= 3 ? name : "");
    if (!s) continue;
    const u = (flip ? x1 - x : x - x0) * pxmm;
    g.save();
    g.translate(u, c.height / 2);
    g.rotate(-Math.PI / 2);
    g.font = `700 ${1.5 * pxmm}px Arial, Helvetica, sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(s.replace(" ", ""), 0, 0);
    g.restore();
  }
  return texture(c);
}

function labelTexture(s, w, h, color = "#e9ecef", bg = "#1b1b1d", size = 0.42) {
  const c = canvas(w * 40, h * 40), g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = color;
  g.font = `600 ${c.height * size}px Arial, Helvetica, sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(s, c.width / 2, c.height / 2);
  return texture(c);
}

// ------------------------------------------------------------------ the model
export function createBoard(container, { onSelect, onHover } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 5, 2000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.append(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";

  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5058, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.3);
  sun.position.set(-60, 160, 120);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(120, 80, -140);
  scene.add(fill);

  // Metal needs something to reflect, or it renders dark: a plain room with bright panels.
  const room = new THREE.Scene();
  room.add(new THREE.Mesh(new THREE.BoxGeometry(400, 400, 400),
    new THREE.MeshBasicMaterial({ color: 0xd4d8de, side: THREE.BackSide })));
  for (const [w, h, x, y, z, rx, ry] of [[300, 300, 0, 199, 0, Math.PI / 2, 0], [200, 160, -199, 40, 0, 0, Math.PI / 2],
    [200, 160, 199, 40, 0, 0, -Math.PI / 2], [240, 120, 0, 60, 199, 0, Math.PI]]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    panel.position.set(x, y, z);
    panel.rotation.set(rx, ry, 0);
    room.add(panel);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(room, 0.03).texture;
  pmrem.dispose();

  const board = new THREE.Group();
  scene.add(board);
  const targets = [];                              // meshes that answer to the pointer
  const byId = {};                                 // id -> meshes

  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...o });
  const metal = (color = 0xeceef1) => mat(color, { roughness: 0.3, metalness: 0.55, envMapIntensity: 1.3 });

  function register(mesh, id) {
    mesh.userData.id = id;
    targets.push(mesh);
    (byId[id] = byId[id] || []).push(mesh);
    return mesh;
  }
  /** A box with its base at height y. x and z give the centre. */
  function box(w, h, d, x, y, z, material, id) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y + h / 2, z);
    board.add(m);
    return id ? register(m, id) : m;
  }
  function cyl(r, h, x, y, z, material, id) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40), material);
    m.position.set(x, y + h / 2, z);
    board.add(m);
    return id ? register(m, id) : m;
  }

  // the board itself, with the stepped right edge of an UNO
  const outline = [[0, 0], [64.5, 0], [66.0, 1.5], [66.0, 12.9], [68.58, 15.4], [68.58, 48.2], [66.0, 50.8], [66.0, D], [0, D]];
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const pcb = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false }), mat(0x111315, { roughness: 0.5 }));
  pcb.rotation.x = -Math.PI / 2;                   // shape y = -z, extruded upwards
  board.add(pcb);
  const faceGeo = new THREE.ShapeGeometry(shape);
  const uv = faceGeo.attributes.uv, pos = faceGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / W, 1 + pos.getY(i) / D);
  const face = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({ map: topTexture(), roughness: 0.55, metalness: 0.1 }));
  face.rotation.x = -Math.PI / 2;
  face.position.y = T + 0.02;
  board.add(face);

  // pin sockets: one black housing per group, one click target per pin
  const plastic = () => mat(0x0c0d0f, { roughness: 0.45 });
  function socket(pins, z, outward) {
    const x0 = pins[0][1] - PITCH / 2, x1 = pins[pins.length - 1][1] + PITCH / 2;
    box(x1 - x0, SOCKET_H, SOCKET_D, (x0 + x1) / 2, T, z, plastic());
    const side = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, SOCKET_H - 0.4),
      new THREE.MeshStandardMaterial({ map: sideTexture(pins, x0, x1, outward < 0), roughness: 0.5 }));
    side.position.set((x0 + x1) / 2, T + SOCKET_H / 2, z + outward * (SOCKET_D / 2 + 0.03));
    if (outward < 0) side.rotation.y = Math.PI;
    board.add(side);
    for (const [id, x] of pins) {
      box(1.25, 0.12, 1.25, x, T + SOCKET_H, z, mat(0x3d4147, { roughness: 0.35, metalness: 0.5 }));   // the hole
      const hit = box(PITCH - 0.06, SOCKET_H + 0.5, SOCKET_D + 0.5, x, T, z,
        new THREE.MeshBasicMaterial({ color: 0x6cc070, transparent: true, opacity: 0, depthWrite: false }), id);
      hit.userData.pin = true;
    }
  }
  socket(TOP_PINS.slice(0, 10), Z_TOP, -1);
  socket(TOP_PINS.slice(10), Z_TOP, -1);
  socket(BOTTOM_PINS.slice(0, 8), Z_BOTTOM, 1);
  socket(BOTTOM_PINS.slice(8), Z_BOTTOM, 1);

  // big parts
  box(15.6, 10.9, 12.2, 1.5, T, 15.5, metal(), "usb");
  box(7.5, 5.2, 0.4, -6.25, T + 2.8, 15.5, mat(0x1a1c20));                       // the opening of the USB socket
  box(14.0, 10.8, 9.0, 4.6, T, 45.7, mat(0x101113, { roughness: 0.4 }), "jack");
  cyl(3.1, 0.4, -2.2, T + 2.4, 45.7, mat(0x2a2d31)).rotation.z = Math.PI / 2;
  box(6.2, 3.3, 6.2, 6.2, T, 3.5, metal(), "reset");
  cyl(1.75, 1.3, 6.2, T + 3.3, 3.5, mat(0xd8392b, { roughness: 0.5 }), "reset");
  // the brain: a socket with the long chip on top, legs along both sides
  box(35.6, 3.2, 8.9, 46.9, T, 37.0, mat(0x1a1b1e, { roughness: 0.5 }), "chip");
  box(35.2, 3.4, 6.6, 46.9, T + 3.2, 37.0, mat(0x242528, { roughness: 0.42 }), "chip");
  const chipLabel = new THREE.Mesh(new THREE.PlaneGeometry(24, 4.4),
    new THREE.MeshStandardMaterial({ map: labelTexture("ATMEGA328P", 24, 4.4, "#c9ccd1", "#242528"), roughness: 0.42 }));
  chipLabel.rotation.x = -Math.PI / 2;
  chipLabel.position.set(46.9, T + 6.62, 37.0);
  board.add(chipLabel);
  for (let i = 0; i < 14; i++) for (const dz of [-3.9, 3.9]) {
    box(0.6, 3.6, 0.5, 30.4 + i * PITCH, T + 1.2, 37.0 + dz, metal(0xb9bcc2));
  }
  box(5.0, 0.9, 5.0, 19.6, T, 19.0, mat(0x202124, { roughness: 0.4 }), "usbchip");
  // crystal: a low, rounded metal can
  box(9.4, 3.4, 3.6, 18.2, T, 27.2, metal(), "crystal");
  for (const dx of [-4.7, 4.7]) cyl(1.8, 3.4, 18.2 + dx, T, 27.2, metal(), "crystal");
  // small lights
  const led = (x, z, color, id) => box(1.9, 0.8, 1.1, x, T, z, mat(color, { emissive: color, emissiveIntensity: 0.55, roughness: 0.4 }), id);
  led(28.2, 10.9, 0xffb23f, "led_l");
  led(28.2, 16.6, 0xffd75e, "led_tx");
  led(28.2, 19.3, 0xffd75e, "led_tx");
  led(58.6, 16.6, 0x58d66b, "led_on");
  // two rows of three bare pins (ICSP), by the right edge and by the USB chip
  const pinGold = () => metal(0xd9b86a);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    box(2.4, 2.5, 2.4, 63.3 + j * PITCH, T, 23.2 + i * PITCH, mat(0x0c0d0f), "icsp");
    box(0.64, 8.6, 0.64, 63.3 + j * PITCH, T, 23.2 + i * PITCH, pinGold(), "icsp");
    box(2.4, 2.5, 2.4, 16.0 + i * PITCH, T, 5.3 + j * PITCH, mat(0x0c0d0f), "icsp");
    box(0.64, 8.6, 0.64, 16.0 + i * PITCH, T, 5.3 + j * PITCH, pinGold(), "icsp");
  }
  // power parts: two capacitors and the regulator
  for (const x of [18.6, 25.5]) {
    cyl(3.15, 5.6, x, T, 45.0, metal(0xd4d7dc), "supply");
    box(2.0, 0.08, 5.6, x - 1.6, T + 5.6, 45.0, mat(0x1b1c1f), "supply");
    box(6.6, 0.9, 6.6, x, T, 45.0, mat(0x121315), "supply");
  }
  box(6.5, 1.7, 6.0, 7.4, T, 36.0, mat(0x1d1e21, { roughness: 0.4 }), "supply");
  box(3.0, 1.5, 6.4, 3.4, T, 36.0, metal(0xaeb2b8), "supply");

  // ---------------------------------------------------------------- camera: a bounded orbit
  const target = new THREE.Vector3(W / 2 - 1, 3.5, D / 2);
  const VIEWS = {
    desk: { az: -0.42, pol: 0.86, r: 138 },         // from the student's seat: near edge in front
    top: { az: 0, pol: 0.001, r: 142 },             // the same way round as in the simulator
    digital: { az: Math.PI + 0.25, pol: 1.1, r: 112 },
    power: { az: 0.22, pol: 1.12, r: 112 },
  };
  const cam = { ...VIEWS.desk };
  let fit = 1;                                     // extra distance on narrow canvases
  function placeCamera() {
    const r = cam.r * fit, s = Math.sin(cam.pol);
    camera.position.set(target.x + r * s * Math.sin(cam.az), target.y + r * Math.cos(cam.pol), target.z + r * s * Math.cos(cam.az));
    camera.up.set(-Math.sin(cam.az), 0.0001, -Math.cos(cam.az)).normalize();   // keeps "far edge" up, also from straight above
    if (cam.pol > 0.05) camera.up.set(0, 1, 0);
    camera.lookAt(target);
  }
  let pending = 0;
  const renderNow = () => { pending = 0; placeCamera(); renderer.render(scene, camera); };
  const requestRender = () => { if (!pending) pending = requestAnimationFrame(renderNow); };

  let anim = 0;
  function setView(name, instant = false) {
    const to = VIEWS[name];
    if (!to) return;
    clearInterval(anim);
    const from = { ...cam };
    let daz = to.az - from.az;                    // turn the short way round
    daz = Math.atan2(Math.sin(daz), Math.cos(daz));
    if (instant) { Object.assign(cam, to); renderNow(); return; }
    const t0 = performance.now(), ms = 650;
    anim = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms), e = k * k * (3 - 2 * k);
      cam.az = from.az + daz * e;
      cam.pol = from.pol + (to.pol - from.pol) * e;
      cam.r = from.r + (to.r - from.r) * e;
      renderNow();
      if (k >= 1) clearInterval(anim);
    }, 16);
  }

  function resize() {
    const w = container.clientWidth || 600, h = container.clientHeight || 420;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    camera.aspect = w / h;
    fit = Math.max(1, 1.25 / camera.aspect);
    camera.updateProjectionMatrix();
    renderNow();
  }
  new ResizeObserver(resize).observe(container);

  // ---------------------------------------------------------------- pointer: turn, zoom, pick
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(ev) {
    const b = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - b.left) / b.width) * 2 - 1, -((ev.clientY - b.top) / b.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(targets, false)[0];
    return hit ? hit.object.userData.id : null;
  }
  let hovered = null, selected = null;
  function paint() {
    for (const [id, meshes] of Object.entries(byId)) {
      const on = id === selected, near = id === hovered;
      for (const m of meshes) {
        if (m.userData.pin) m.material.opacity = on ? 0.62 : near ? 0.38 : 0;
        else if (m.material.emissive) {
          if (m.userData.base === undefined) m.userData.base = [m.material.emissive.getHex(), m.material.emissiveIntensity];
          m.material.emissive.setHex(on || near ? 0x3fae55 : m.userData.base[0]);
          m.material.emissiveIntensity = on ? 0.75 : near ? 0.45 : m.userData.base[1];
        }
      }
    }
    requestRender();
  }
  function select(id, silent = false) {
    selected = id;
    paint();
    if (!silent && onSelect) onSelect(id);
  }

  const pointers = new Map();
  let moved = 0, pinch = 0;
  const el = renderer.domElement;
  el.addEventListener("pointerdown", (ev) => {
    el.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    moved = 0;
    clearInterval(anim);
  });
  el.addEventListener("pointermove", (ev) => {
    const p = pointers.get(ev.pointerId);
    if (!p) {                                       // no button down: hover
      const id = pick(ev);
      if (id !== hovered) { hovered = id; el.style.cursor = id ? "pointer" : "grab"; paint(); }
      if (onHover) onHover(id, ev);
      return;
    }
    const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
    p.x = ev.clientX; p.y = ev.clientY;
    if (pointers.size === 2) {                      // two fingers: zoom
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) cam.r = Math.min(260, Math.max(55, cam.r * (pinch / d)));
      pinch = d;
    } else {
      moved += Math.abs(dx) + Math.abs(dy);
      cam.az -= dx * 0.008;
      cam.pol = Math.min(1.45, Math.max(0.001, cam.pol - dy * 0.008));
    }
    requestRender();
  });
  const release = (ev) => {
    if (pointers.delete(ev.pointerId) && pointers.size === 0 && moved < 6 && ev.type === "pointerup") {
      const id = pick(ev);
      if (id) select(id);
    }
    pinch = 0;
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  el.addEventListener("pointerleave", () => { if (hovered) { hovered = null; paint(); } if (onHover) onHover(null); });
  el.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    cam.r = Math.min(260, Math.max(55, cam.r * (ev.deltaY > 0 ? 1.08 : 0.93)));
    requestRender();
  }, { passive: false });
  el.style.cursor = "grab";

  resize();
  return {
    select, setView, renderNow, resize, canvas: el,
    /** Screen position of a part, for tests and for pointing at it. */
    screenOf(id) {
      const m = (byId[id] || [])[0];
      if (!m) return null;
      const v = new THREE.Vector3();
      m.getWorldPosition(v);
      if (m.userData.pin) v.y = T + SOCKET_H;
      placeCamera(); camera.updateMatrixWorld();
      v.project(camera);
      const b = el.getBoundingClientRect();
      return { x: b.left + ((v.x + 1) / 2) * b.width, y: b.top + ((1 - v.y) / 2) * b.height };
    },
    pickAt(x, y) { return pick({ clientX: x, clientY: y }); },
  };
}
