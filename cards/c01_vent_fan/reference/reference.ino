// Card 01: Greenhouse ventilation fan (reference solution; never shown to students)

const int FAN_PIN = 9;

void setup() {
  Serial.begin(9600);
  pinMode(FAN_PIN, OUTPUT);
}

void loop() {
  digitalWrite(FAN_PIN, HIGH);
  Serial.println("FAN ON");
  delay(3000);
  digitalWrite(FAN_PIN, LOW);
  Serial.println("FAN OFF");
  delay(3000);
}
