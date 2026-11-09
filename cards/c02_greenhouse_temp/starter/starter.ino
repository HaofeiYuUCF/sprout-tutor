// Card 02: Read greenhouse temperature (starter)
// Divider: 5V -> thermistor -> A0 -> 10k resistor -> GND.

const int TEMP_PIN = A0;
const float R_FIXED = 10000.0;  // the 10k resistor
const float R0 = 10000.0;       // thermistor resistance at 25 C
const float BETA = 3950.0;      // thermistor B value

void setup() {
  Serial.begin(9600);
}

void loop() {
  // TODO: read the sensor: int raw = analogRead(TEMP_PIN);
  // TODO: resistance: float r = R_FIXED * (1023.0 / raw - 1.0);
  // TODO: degrees C: float tempC = 1.0 / (1.0 / 298.15 + log(r / R0) / BETA) - 273.15;
  // TODO: print a line like: raw=512 temp_c=25.0
  delay(1000);
}
