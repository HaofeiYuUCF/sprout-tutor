// Seeded fault: missing semicolon (compile error)

const int PUMP_LED_PIN = 8;

void setup() {
  Serial.begin(9600);
  pinMode(PUMP_LED_PIN, OUTPUT)
}

void loop() {
  digitalWrite(PUMP_LED_PIN, HIGH);
  Serial.println("PUMP ON");
  delay(1000);
  digitalWrite(PUMP_LED_PIN, LOW);
  Serial.println("PUMP OFF");
  delay(1000);
}
