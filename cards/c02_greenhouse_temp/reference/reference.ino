// Card 02: Read greenhouse temperature (reference solution; never shown to students)

const int TEMP_PIN = A0;

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
