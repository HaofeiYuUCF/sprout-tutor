// Card 04: Greenhouse heat alarm (reference solution; never shown to students)

const int TEMP_PIN = A0;
const int BUZZER_PIN = 8;
const float ALARM_C = 28.0;     // alarm above this temperature
const float R_FIXED = 10000.0;
const float R0 = 10000.0;
const float BETA = 3950.0;

void setup() {
  Serial.begin(9600);
  pinMode(BUZZER_PIN, OUTPUT);
}

void loop() {
  int raw = analogRead(TEMP_PIN);
  float r = R_FIXED * (1023.0 / raw - 1.0);
  float tempC = 1.0 / (1.0 / 298.15 + log(r / R0) / BETA) - 273.15;
  bool hot = tempC > ALARM_C;
  digitalWrite(BUZZER_PIN, hot ? HIGH : LOW);
  Serial.print("temp_c=");
  Serial.print(tempC, 1);
  Serial.print(" alarm=");
  Serial.println(hot ? "ON" : "OFF");
  delay(500);
}
