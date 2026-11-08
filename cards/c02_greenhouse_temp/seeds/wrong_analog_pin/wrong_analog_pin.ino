// Seeded fault: code reads A1 while the sensor is wired to A0

const int TEMP_PIN = A1;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int raw = analogRead(TEMP_PIN);
  float volts = raw * 5.0 / 1023.0;
  float tempC = (volts - 0.5) * 100.0;
  Serial.print("raw=");
  Serial.print(raw);
  Serial.print(" temp_c=");
  Serial.println(tempC, 1);
  delay(1000);
}
