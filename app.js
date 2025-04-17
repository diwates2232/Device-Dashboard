Updated app.js



require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const ping = require("ping");
const { DateTime } = require("luxon");
const regionRoutes = require("./routes/regionRoutes");
const { fetchAllIpAddress, ipRegionMap } = require("./services/excelService");

const app = express();
const PORT = process.env.PORT || 80;

// Helpers
function pruneOldEntries(entries, days = 30) {
  const cutoff = DateTime.now().minus({ days }).toMillis();
  return entries.filter(e => DateTime.fromISO(e.timestamp).toMillis() >= cutoff);
}
function getLogFileForDate(dt) {
  return `./deviceLogs-${dt.toISODate()}.json`;
}

// Middleware
app.use(cors({
  origin: "http://127.0.0.1:5500",
  methods: "GET,POST,PUT,DELETE",
  allowedHeaders: "Content-Type,Authorization",
}));
app.use(bodyParser.json());

// Routes
app.use("/api/regions", regionRoutes);

// Device Status Tracking
const devices = fetchAllIpAddress();
let deviceStatus = {};

// Load only today's logs
const today = DateTime.now().setZone("Asia/Kolkata");
const todayLogFile = getLogFileForDate(today);
let todayLogs = fs.existsSync(todayLogFile)
  ? JSON.parse(fs.readFileSync(todayLogFile, "utf8"))
  : {};

// Persist today's logs
function saveTodayLogs() {
  fs.writeFileSync(todayLogFile, JSON.stringify(todayLogs, null, 2));
}

// Log a status change
function logDeviceChange(ip, status) {
  const timestamp = DateTime.now().setZone("Asia/Kolkata").toISO();
  const arr = (todayLogs[ip] = todayLogs[ip] || []);
  const last = arr[arr.length - 1];
  if (!last || last.status !== status) {
    arr.push({ status, timestamp });
    todayLogs[ip] = pruneOldEntries(arr, 30);
    saveTodayLogs();
  }
}

// Ping devices
async function pingDevices() {
  for (const ip of devices) {
    let newStatus = "Offline";
    try {
      const res = await ping.promise.probe(ip);
      newStatus = res.alive ? "Online" : "Offline";
    } catch {
      /* keep Offline */
    }
    if (deviceStatus[ip] !== newStatus) {
      logDeviceChange(ip, newStatus);
    }
    deviceStatus[ip] = newStatus;
  }
  console.log("Updated device status:", deviceStatus);
}

// Start ping loop
setInterval(pingDevices, 60_000);
pingDevices();

// Real‑time status
app.get("/api/region/devices/status", (req, res) => {
  res.json(deviceStatus);
});

// Full history: stitch together all daily files
app.get("/api/devices/history", (req, res) => {
  const files = fs.readdirSync(".")
    .filter(f => f.startsWith("deviceLogs-") && f.endsWith(".json"));
  const combined = {};
  for (const f of files) {
    const dayLogs = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const ip of Object.keys(dayLogs)) {
      combined[ip] = (combined[ip] || []).concat(dayLogs[ip]);
    }
  }
  // prune to last 30 days
  for (const ip of Object.keys(combined)) {
    combined[ip] = pruneOldEntries(combined[ip], 30);
  }
  res.json(combined);
});

// Region‑wise history
app.get("/api/region/:region/history", (req, res) => {
  const region = req.params.region.toLowerCase();
  const files = fs.readdirSync(".")
    .filter(f => f.startsWith("deviceLogs-") && f.endsWith(".json"));
  const regionLogs = {};

  for (const f of files) {
    const dayLogs = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const ip of Object.keys(dayLogs)) {
      if (ipRegionMap[ip] === region) {
        regionLogs[ip] = (regionLogs[ip] || []).concat(dayLogs[ip]);
      }
    }
  }

  if (!Object.keys(regionLogs).length) {
    return res.status(404).json({ message: `No device history found for region: ${region}` });
  }
  // prune per‑IP
  for (const ip of Object.keys(regionLogs)) {
    regionLogs[ip] = pruneOldEntries(regionLogs[ip], 30);
  }
  res.json(regionLogs);
});

// Single‑device history
app.get("/api/device/history/:ip", (req, res) => {
  const ip = req.params.ip;
  const files = fs.readdirSync(".")
    .filter(f => f.startsWith("deviceLogs-") && f.endsWith(".json"));
  let history = [];
  for (const f of files) {
    const dayLogs = JSON.parse(fs.readFileSync(f, "utf8"));
    if (dayLogs[ip]) history = history.concat(dayLogs[ip]);
  }
  if (!history.length) {
    return res.status(404).json({ message: "No history found for this device" });
  }
  history.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  res.json({ ip, history });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});



































require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const ping = require("ping");
const { DateTime } = require("luxon");
const regionRoutes = require("./routes/regionRoutes");
const { fetchAllIpAddress } = require("./services/excelService");

const app = express();
const PORT = process.env.PORT || 80;

// Helper: prune entries older than N days
function pruneOldEntries(entries, days = 30) {
  const cutoff = DateTime.now().minus({ days }).toMillis();
  return entries.filter(e => {
    try {
      return DateTime.fromISO(e.timestamp).toMillis() >= cutoff;
    } catch {
      return false;
    }
  });
}

// Middleware
app.use(
  cors({
    origin: "http://127.0.0.1:5500",
    methods: "GET,POST,PUT,DELETE",
    allowedHeaders: "Content-Type,Authorization",
  })
);
app.use(bodyParser.json());

// Routes
app.use("/api/regions", regionRoutes);

// Device Status Tracking
const devices = fetchAllIpAddress();
let deviceStatus = {};
const logFile = "./deviceLogs.json";

// Load previous logs if exists
let deviceLogs = fs.existsSync(logFile)
  ? JSON.parse(fs.readFileSync(logFile, "utf8"))
  : {};

// Function to log device status changes
function logDeviceChange(ip, status) {
  const timestamp = DateTime.now().setZone("Asia/Kolkata").toISO();

  if (!deviceLogs[ip]) {
    deviceLogs[ip] = [];
  }

  const lastLog = deviceLogs[ip].length
    ? deviceLogs[ip][deviceLogs[ip].length - 1]
    : null;

  // Log only if status changes
  if (!lastLog || lastLog.status !== status) {
    deviceLogs[ip].push({ status, timestamp });
    // Prune to last 30 days
    deviceLogs[ip] = pruneOldEntries(deviceLogs[ip], 30);
    fs.writeFileSync(logFile, JSON.stringify(deviceLogs, null, 2));
  }
}

// Ping all devices and log changes
async function pingDevices() {
  for (const ip of devices) {
    try {
      const result = await ping.promise.probe(ip);
      const newStatus = result.alive ? "Online" : "Offline";

      if (deviceStatus[ip] !== newStatus) {
        logDeviceChange(ip, newStatus);
      }
      deviceStatus[ip] = newStatus;
    } catch (error) {
      console.error(`Error pinging ${ip}:`, error);
      deviceStatus[ip] = "Offline";
    }
  }
  console.log("Updated device status:", deviceStatus);
}

// Interval to ping devices every minute
setInterval(pingDevices, 60000);

// API to get real-time device status
app.get("/api/region/devices/status", (req, res) => {
  res.json(deviceStatus);
});

// API to fetch device history for all devices
app.get("/api/devices/history", (req, res) => {
  res.json(deviceLogs);
});

// API to fetch device history region-wise
app.get("/api/region/:region/history", (req, res) => {
  const region = req.params.region;
  const logs = fs.existsSync(logFile)
    ? JSON.parse(fs.readFileSync(logFile, "utf8"))
    : {};

  const regionLogs = {};
  for (const ip in logs) {
    // if you have region info per-device, filter here
    // e.g. if logs[ip].region === region
  }

  if (Object.keys(regionLogs).length === 0) {
    return res.status(404).json({ message: `No device history found for region: ${region}` });
  }

  res.json(regionLogs);
});

// API to fetch history of a specific device by IP address
app.get("/api/device/history/:ip", async (req, res) => {
  const ip = req.params.ip;
  const logs = fs.existsSync(logFile)
    ? JSON.parse(fs.readFileSync(logFile, "utf8"))
    : {};

  if (!logs[ip]) {
    return res.status(404).json({ message: "No history found for this device" });
  }

  // Note: you’ll need to import or reconstruct allData here if you want device metadata
  res.json({ ip, history: logs[ip] });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  pingDevices(); // Initial ping on startup
});

