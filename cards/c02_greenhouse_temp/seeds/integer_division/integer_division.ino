// Seeded fault: integer division in the resistance formula

const int TEMP_PIN = A0;
const float R_FIXED = 10000.0;
const float R0 = 10000.0;
const float BETA = 3950.0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int raw = analogRead(TEMP_PIN);
  float r = R_FIXED * (1023 / raw - 1.0);
  float tempC = 1.0 / (1.0 / 298.15 + log(r / R0) / BETA) - 273.15;
  Serial.print("raw=");
  Serial.print(raw);
  Serial.print(" temp_c=");
  Serial.println(tempC, 1);
  delay(1000);
}
