// Card 05: Greenhouse controller (starter) - final test
// A0: thermistor divider. Pin 9: fan (through the transistor). Pin 8: active buzzer.

const int TEMP_PIN = A0;
const int FAN_PIN = 9;
const int BUZZER_PIN = 8;
const float FAN_ON_C = 27.0;   // fan on above this temperature
const float ALARM_C = 30.0;    // alarm above this temperature

// From card 2: read the thermistor and return degrees Celsius.
float readTemperature() {
  int raw = analogRead(TEMP_PIN);
  float r = 10000.0 * (1023.0 / raw - 1.0);
  return 1.0 / (1.0 / 298.15 + log(r / 10000.0) / 3950.0) - 273.15;
}

void setup() {
  Serial.begin(9600);
  // TODO: set FAN_PIN and BUZZER_PIN as outputs
}

void loop() {
  float tempC = readTemperature();
  // TODO: fanOn is true when tempC is above FAN_ON_C; switch FAN_PIN to match
  // TODO: alarmOn is true when tempC is above ALARM_C; switch BUZZER_PIN to match
  // TODO: print tempC and both states, so that a line looks like: temp_c=27.5 fan=ON alarm=OFF
  //       (the temperature must come from tempC: do not type the number inside the quotes)
  delay(500);
}
