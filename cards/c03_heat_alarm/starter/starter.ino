// Card 03: Greenhouse heat alarm (starter)
// Thermistor divider on A0 (as in card 2). Active buzzer: long leg (+) to pin 8, short leg to GND.

const int TEMP_PIN = A0;
const int BUZZER_PIN = 8;
const float ALARM_C = 28.0;     // alarm above this temperature
const float R_FIXED = 10000.0;
const float R0 = 10000.0;
const float BETA = 3950.0;

void setup() {
  Serial.begin(9600);
  // TODO: set BUZZER_PIN as an output
}

void loop() {
  int raw = analogRead(TEMP_PIN);
  float r = R_FIXED * (1023.0 / raw - 1.0);
  float tempC = 1.0 / (1.0 / 298.15 + log(r / R0) / BETA) - 273.15;
  // TODO: if tempC is above ALARM_C, turn the buzzer on; otherwise turn it off
  // TODO: print a line like: temp_c=24.8 alarm=OFF
  delay(500);
}
