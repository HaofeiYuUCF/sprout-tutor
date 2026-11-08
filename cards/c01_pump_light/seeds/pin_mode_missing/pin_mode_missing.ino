// Seeded fault: pinMode missing (LED glows very dimly or not at all)

const int PUMP_LED_PIN = 8;

void setup() {
  Serial.begin(9600);
}

void loop() {
  digitalWrite(PUMP_LED_PIN, HIGH);
  Serial.println("PUMP ON");
  delay(1000);
  digitalWrite(PUMP_LED_PIN, LOW);
  Serial.println("PUMP OFF");
  delay(1000);
}
