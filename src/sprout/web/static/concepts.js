/* SPROUT Web Lab: the new ideas each card introduces, short self-check questions, and a glossary.
 *
 * Rules for this content: at most two new ideas per card; the part shown by default stays short
 * (two or three sentences); anything longer goes under "How does it work?", which is optional.
 */
(function (global) {
  "use strict";

  const CONCEPTS = {
    c01_light_led: [
      { id: "loop", title: "A circuit is a loop",
        text: "Electricity only flows around a complete loop: from 5V, through your parts, and back to GND. Think of water in a pipe: voltage is the push, current is the flow. Break the loop anywhere and the flow stops.",
        more: "Voltage is measured in volts (V); the UNO gives 5 V. Current is measured in milliamps (mA); an LED needs about 10–20 mA. The 220 Ω resistor keeps it there: (5 V − 2 V for the LED) ÷ 220 Ω ≈ 14 mA. A short circuit is a loop with nothing in it to slow the current down, and it can damage the board." },
      { id: "pin", title: "A pin is a switch your code controls",
        text: "Each numbered pin can be HIGH (5V) or LOW (0V, like GND). pinMode(9, OUTPUT) gives pin 9 its job, and digitalWrite(9, HIGH) turns its 5V on. setup() runs once at the start; loop() runs again and again.",
        more: "delay(1000) waits 1000 milliseconds, which is 1 second. Serial.println(\"LED ON\") sends a message to the computer: that is how the board tells you what it is doing. Every instruction ends with a semicolon ;" },
    ],
    c02_greenhouse_temp: [
      { id: "analog", title: "Analog readings: 0 to 1023",
        text: "analogRead(A0) measures the voltage on pin A0 and gives a number from 0 (0 V) to 1023 (5 V). A reading around 512 means about 2.5 V.",
        more: "The UNO divides 5 V into 1024 steps of about 0.005 V each. Digital pins only know HIGH or LOW; analog pins measure everything in between." },
      { id: "divider", title: "The voltage divider",
        text: "The thermistor and the 10k resistor share the 5 V between them. When the thermistor warms, its resistance drops, so more of the voltage reaches A0 and the reading rises.",
        more: "The formulas in the starter turn the reading back into the thermistor's resistance, then use its B value (3950) to turn resistance into °C. You do not need to memorise them. Uncalibrated, the reading can be off by about 1 °C; comparing with a good thermometer is called calibration." },
    ],
    c03_vent_fan: [
      { id: "transistor", title: "A transistor is an electronic switch",
        text: "A small current into the middle leg (base) lets a much larger current flow between the other two legs (collector to emitter). It is like a small push that opens a big water valve. That is how a weak UNO pin can run a motor.",
        more: "PN2222 is just the model number of a common small NPN transistor; it can switch up to about 600 mA. The 1k resistor keeps the base current small and safe. Your code does not change at all: pin 9 switches the transistor exactly the way it switched the LED." },
      { id: "diode", title: "The diode protects the circuit",
        text: "A motor keeps pushing for a moment after it is switched off, which makes a short voltage spike. The diode across the motor is a one-way path that lets that spike die away safely.",
        more: "The silver stripe marks the diode's cathode. Across a motor, the stripe faces 5V, so in normal running the diode does nothing; it only conducts the spike. A diode the wrong way round would short 5V to GND." },
    ],
    c04_heat_alarm: [
      { id: "ifelse", title: "Decisions with if and else",
        text: "if (tempC > ALARM_C) { … } else { … } runs one block or the other every time loop() runs. The condition is a yes-or-no question about your reading.",
        more: "Read conditions out loud as sentences: tempC > ALARM_C means 'the temperature is above the alarm level'. A reversed comparison (< instead of >) is the most common mistake." },
      { id: "buzzer", title: "Active and passive buzzers",
        text: "An active buzzer beeps by itself as soon as its + leg gets 5 V, so digitalWrite is enough. Take the active one from the kit: its bottom is sealed in black.",
        more: "The passive buzzer (green circuit board underneath) needs a changing signal, made with tone(). It can play different notes, but it stays silent with a plain HIGH." },
    ],
    c05_greenhouse_controller: [
      { id: "thresholds", title: "Two thresholds",
        text: "The fan starts at a lower temperature (FAN_ON_C) and the alarm only at a higher one (ALARM_C). The fan tries first; the alarm means the fan was not enough.",
        more: "If the temperature hovers right at a threshold, the fan clicks on and off. Real controllers switch on above one level and off below a lower one (for example on above 27 °C, off below 26 °C). This is called hysteresis." },
      { id: "test_parts", title: "Test one part at a time",
        text: "When a bigger system misbehaves, check each part alone: does the temperature reading look right? Does the fan run when the code turns it on? Then put the parts back together.",
        more: "Engineers call this divide and conquer. The messages from the board help: print fan=ON and alarm=ON so you can see what the code decided, separately from what the hardware did." },
    ],
  };

  const QUIZ = {
    c01_light_led: [
      { id: "c01.q1", q: "Your LED stays dark. You turn it around and it lights. Why?",
        options: ["An LED only lets current flow one way", "It was too far from the UNO", "The resistor was too big"], answer: 0,
        why: "An LED is a one-way part: the long leg (+) must face the 5V or pin side." },
      { id: "c01.q2", q: "What does the 220 Ω resistor do?",
        options: ["It makes the LED blink", "It limits the current so the LED does not burn out", "It stores electricity"], answer: 1,
        why: "Without it, too much current would flow around the loop." },
      { id: "c01.q3", q: "Which breadboard holes are connected to each other?",
        options: ["All holes in a long row", "None, you need wires everywhere", "The 5 holes in one short column"], answer: 2,
        why: "Hover over a hole in the simulator: the connected holes light up." },
    ],
    c02_greenhouse_temp: [
      { id: "c02.q1", q: "You pinch the thermistor and the reading rises. Why?",
        options: ["Warmer means lower resistance, so more voltage reaches A0", "Your finger adds electricity", "The 10k resistor gets hot"], answer: 0,
        why: "The thermistor's resistance drops as it warms, so its share of the 5 V shrinks and A0 rises." },
      { id: "c02.q2", q: "analogRead gives 1023. What voltage is on the pin?",
        options: ["About 0 V", "About 5 V", "1023 V"], answer: 1,
        why: "0 means 0 V and 1023 means 5 V." },
    ],
    c03_vent_fan: [
      { id: "c03.q1", q: "Why not connect the motor straight to pin 9?",
        options: ["The pin cannot give enough current", "The motor would spin backwards", "Pin 9 only works with LEDs"], answer: 0,
        why: "A pin gives a few tens of milliamps; a motor needs far more. The transistor switches the big current for the pin." },
      { id: "c03.q2", q: "With the PN2222A's flat face toward you, which leg goes to GND?",
        options: ["The middle leg (base)", "The left leg (emitter)", "The right leg (collector)"], answer: 1,
        why: "E, B, C from left to right: the emitter goes to GND, the base to the 1k resistor, the collector to the motor." },
    ],
    c04_heat_alarm: [
      { id: "c04.q1", q: "Your alarm sounds at room temperature. What is the most likely cause?",
        options: ["The buzzer is broken", "The room is too hot", "The comparison in the code is reversed"], answer: 2,
        why: "Read the condition as a sentence: it should say 'the temperature is above the alarm level'." },
    ],
    c05_greenhouse_controller: [
      { id: "c05.q1", q: "FAN_ON_C is 27 and ALARM_C is 30. At 28 °C, what should happen?",
        options: ["Fan on, alarm off", "Both on", "Both off"], answer: 0,
        why: "28 is above 27 (fan) but below 30 (alarm)." },
    ],
  };

  const GLOSSARY = [
    ["voltage", "Voltage (V)", "The push that drives electricity, like water pressure. The UNO gives 5 V."],
    ["current", "Current (mA)", "How much electricity flows, like the amount of water. An LED needs about 10–20 mA."],
    ["resistance", "Resistance (Ω)", "How much a part slows the current down. More ohms means less current."],
    ["gnd", "GND (ground)", "The 0 V side where current returns. Every loop ends at GND."],
    ["loop", "Circuit loop", "A complete path from 5V (or a pin), through the parts, back to GND. No loop, no current."],
    ["short", "Short circuit", "A loop with nothing to slow the current down. It can damage the board: unplug at once."],
    ["breadboard", "Breadboard", "Each short column of 5 holes is joined inside. The long rails along the edges (+ and −) carry power."],
    ["pin", "Pin", "A numbered connection on the UNO. Pins 2–13 can be switched by code; A0–A5 can measure voltage."],
    ["highlow", "HIGH and LOW", "HIGH is 5 V, LOW is 0 V. digitalWrite sets a pin HIGH or LOW."],
    ["analog", "Digital and analog", "Digital means only on or off. Analog means every value in between: analogRead gives 0 to 1023."],
    ["sketch", "Sketch", "Your program. setup() runs once at the start; loop() runs again and again."],
    ["delay", "delay(ms)", "Waits a number of milliseconds. delay(1000) waits 1 second."],
    ["serial", "Messages from the board", "Serial.println sends a line of text to the computer, so you can see what your code is doing."],
    ["check", "Check my code", "The computer checks your code and turns it into something the board can run. Errors show the line number."],
  ];

  // Shown next to the editor: the commands a card needs, as patterns. They are not the answer:
  // the student still has to choose the pin, the value, the text and the order.
  const PIN_MODE = ["pinMode(pin, OUTPUT);", "Makes a pin an output, so it can switch something on. It goes in setup()."];
  const DIGITAL_WRITE = ["digitalWrite(pin, HIGH);", "Turns a pin on (5 V). Write LOW instead of HIGH to turn it off."];
  const DELAY = ["delay(1000);", "Waits 1000 milliseconds, which is 1 second."];
  const PRINTLN_TEXT = ["Serial.println(\"text\");", "Sends a line of text to the computer. Your text goes between the quotes."];
  const PRINT = ["Serial.print(value);", "Sends a text or a number and stays on the same line."];
  const PRINTLN = ["Serial.println(value);", "Sends a text or a number, then starts a new line."];
  const COMMANDS = {
    c01_light_led: { note: "In this card the pin is called LED_PIN.",
      list: [PIN_MODE, DIGITAL_WRITE, DELAY, PRINTLN_TEXT] },
    c02_greenhouse_temp: { note: "The to-do lines already give the three formulas. To print raw=512 temp_c=25.0, send four pieces one after the other: a text, a number, a text, a number.",
      list: [["analogRead(pin)", "Measures the voltage on an analog pin and gives a number from 0 to 1023."],
        ["int name = value;", "Makes a named place for a whole number. Use float for a number with decimals."],
        PRINT, PRINTLN] },
    c03_vent_fan: { note: "In this card the pin is called FAN_PIN.",
      list: [PIN_MODE, DIGITAL_WRITE, ["delay(3000);", "Waits 3000 milliseconds, which is 3 seconds."], PRINTLN_TEXT] },
    c04_heat_alarm: { note: "In this card the pin is called BUZZER_PIN.",
      list: [["if (a > b) { ... } else { ... }", "Runs the first block when a is above b, and the second block otherwise."],
        PIN_MODE, DIGITAL_WRITE, PRINT, PRINTLN] },
    c05_greenhouse_controller: { note: "In this card the pins are called FAN_PIN and BUZZER_PIN.",
      list: [["bool name = a > b;", "Makes a named yes-or-no value: true when a is above b, false otherwise."],
        ["if (name) { ... } else { ... }", "Runs the first block when the value is true, and the second block otherwise."],
        PIN_MODE, DIGITAL_WRITE, PRINT, PRINTLN] },
  };

  global.SproutConcepts = { CONCEPTS, QUIZ, GLOSSARY, COMMANDS };
})(window);
