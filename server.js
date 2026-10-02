const express = require("express");
const mqtt = require("mqtt");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

// ===============================
// MQTT CONFIG
// ===============================

const MQTT_HOST = process.env.MQTT_HOST;
const MQTT_PORT = Number(process.env.MQTT_PORT || 1883);
const MQTT_USER = process.env.MQTT_USER;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;

const FEEDER_ID = "FEEDER-001";

const MQTT_COMMAND_TOPIC =
  `feeder/${FEEDER_ID}/command`;

const MQTT_STATUS_TOPIC =
  `feeder/${FEEDER_ID}/status`;

// ===============================
// STATUS FEEDER
// ===============================

let feederStatus = {
  connected: false,
  state: "unknown",
  speed: 0,
  duration: 0,
  lastUpdate: null
};

// ===============================
// MQTT CONNECTION
// ===============================

const mqttClient = mqtt.connect(MQTT_HOST, {
  port: MQTT_PORT,
  username: MQTT_USER,
  password: MQTT_PASSWORD,
  clientId: `railway-${Date.now()}`,
  reconnectPeriod: 5000
});

mqttClient.on("connect", () => {
  console.log("MQTT connected");

  mqttClient.subscribe(
    MQTT_STATUS_TOPIC,
    (error) => {
      if (error) {
        console.error(
          "Subscribe error:",
          error.message
        );
      } else {
        console.log(
          `Subscribed: ${MQTT_STATUS_TOPIC}`
        );
      }
    }
  );
});

mqttClient.on("message", (topic, message) => {
  try {
    const data = JSON.parse(
      message.toString()
    );

    console.log(
      "MQTT status:",
      data
    );

    feederStatus = {
      ...feederStatus,
      ...data,
      connected: true,
      lastUpdate:
        new Date().toISOString()
    };

  } catch (error) {

    console.error(
      "Invalid MQTT message:",
      message.toString()
    );

  }
});

mqttClient.on("error", (error) => {

  console.error(
    "MQTT error:",
    error.message
  );

});

mqttClient.on("close", () => {

  console.log(
    "MQTT disconnected"
  );

  feederStatus.connected = false;

});

// ===============================
// TEST API
// ===============================

app.get("/", (req, res) => {

  res.json({
    success: true,
    message:
      "Feeder Ikan Backend aktif",
    feeder: FEEDER_ID
  });

});

// ===============================
// STATUS API
// ===============================

app.get("/api/status", (req, res) => {

  res.json({
    success: true,
    feeder: FEEDER_ID,
    status: feederStatus
  });

});

// ===============================
// FEED API
// ===============================

app.post("/api/feed", (req, res) => {

  const speed =
    Number(req.body.speed || 50);

  const duration =
    Number(req.body.duration || 10);

  if (
    speed < 10 ||
    speed > 100
  ) {

    return res.status(400).json({
      success: false,
      message:
        "Speed harus 10-100%"
    });

  }

  if (
    duration < 1 ||
    duration > 3600
  ) {

    return res.status(400).json({
      success: false,
      message:
        "Durasi harus 1-3600 detik"
    });

  }

  const command = {

    action: "feed",

    speed: speed,

    duration: duration

  };

  mqttClient.publish(
    MQTT_COMMAND_TOPIC,
    JSON.stringify(command),
    { qos: 1 },
    (error) => {

      if (error) {

        console.error(
          "Publish error:",
          error.message
        );

        return res.status(500).json({

          success: false,

          message:
            "Gagal mengirim perintah"

        });

      }

      console.log(
        "Feed command:",
        command
      );

      res.json({

        success: true,

        message:
          "Perintah pakan dikirim",

        command: command

      });

    }
  );

});

// ===============================
// STOP API
// ===============================

app.post("/api/stop", (req, res) => {

  const command = {
    action: "stop"
  };

  mqttClient.publish(
    MQTT_COMMAND_TOPIC,
    JSON.stringify(command),
    { qos: 1 },
    (error) => {

      if (error) {

        return res.status(500).json({

          success: false,

          message:
            "Gagal mengirim perintah stop"

        });

      }

      console.log(
        "Stop command sent"
      );

      res.json({

        success: true,

        message:
          "Perintah stop dikirim"

      });

    }
  );

});

// ===============================
// START SERVER
// ===============================

app.listen(
  PORT,
  () => {

    console.log(
      `Backend berjalan pada port ${PORT}`
    );

  }
);
