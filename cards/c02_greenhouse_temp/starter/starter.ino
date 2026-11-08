// Card 02: Read greenhouse temperature (starter)
// TMP36: flat face toward you, left leg 5V, middle leg A0, right leg GND.

const int TEMP_PIN = A0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  // TODO: read the sensor with analogRead
  // TODO: convert the raw value (0-1023) to volts
  // TODO: convert volts to degrees Celsius: (volts - 0.5) * 100
  // TODO: print a line like: raw=153 temp_c=24.8
  delay(1000);
}
