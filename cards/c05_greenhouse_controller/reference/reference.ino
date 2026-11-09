// Card 05: Greenhouse controller (reference solution; never shown to students)

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
  pinMode(FAN_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
}

void loop() {
  float tempC = readTemperature();
  bool fanOn = tempC > FAN_ON_C;
  bool alarmOn = tempC > ALARM_C;
  digitalWrite(FAN_PIN, fanOn ? HIGH : LOW);
  digitalWrite(BUZZER_PIN, alarmOn ? HIGH : LOW);
  Serial.print("temp_c=");
  Serial.print(tempC, 1);
  Serial.print(" fan=");
  Serial.print(fanOn ? "ON" : "OFF");
  Serial.print(" alarm=");
  Serial.println(alarmOn ? "ON" : "OFF");
  delay(500);
}
