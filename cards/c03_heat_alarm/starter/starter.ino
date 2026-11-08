// Card 03: Greenhouse heat alarm (starter)
// TMP36 on A0 (flat face toward you: 5V, A0, GND). LED + 220 ohm resistor on pin 8.

const int TEMP_PIN = A0;
const int ALARM_LED_PIN = 8;
const float ALARM_C = 30.0;

void setup() {
  Serial.begin(9600);
  // TODO: set the LED pin as an output
}

void loop() {
  // TODO: read the sensor and convert to tempC (reuse your card 02 code)
  // TODO: if tempC is above ALARM_C, turn the LED on; otherwise turn it off
  // TODO: print a line like: temp_c=24.8 alarm=OFF
  delay(500);
}
