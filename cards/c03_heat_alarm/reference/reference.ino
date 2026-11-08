// Card 03: Greenhouse heat alarm (reference solution; never shown to students)

const int TEMP_PIN = A0;
const int ALARM_LED_PIN = 8;
const float ALARM_C = 30.0;

void setup() {
  Serial.begin(9600);
  pinMode(ALARM_LED_PIN, OUTPUT);
}

void loop() {
  int raw = analogRead(TEMP_PIN);
  float volts = raw * 5.0 / 1023.0;
  float tempC = (volts - 0.5) * 100.0;
  bool hot = tempC > ALARM_C;
  digitalWrite(ALARM_LED_PIN, hot ? HIGH : LOW);
  Serial.print("temp_c=");
  Serial.print(tempC, 1);
  Serial.print(" alarm=");
  Serial.println(hot ? "ON" : "OFF");
  delay(500);
}
