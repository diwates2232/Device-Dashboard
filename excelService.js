



const fs = require("fs");
const xlsx = require("xlsx");
const path = require("path");
const ping = require("ping");
const pLimit = require("p-limit");
const { DateTime } = require("luxon"); // Import Luxon for timezone handling

// Paths for Excel files
const archiverPath = path.join(__dirname, "../data/ArchiverData.xlsx");
const controllerPath = path.join(__dirname, "../data/ControllerData.xlsx");
const cameraPath = path.join(__dirname, "../data/CameraData.xlsx");
const serverPath = path.join(__dirname, "../data/ServerData.xlsx");

// Log file for device status history
const logFile = "./deviceLogs.json";

// Cache to store preloaded data
let allData = {};

const activeDevices = {}; // Store active monitoring sessions

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

// Function to load logs
const loadLogs = () =>
  fs.existsSync(logFile)
    ? JSON.parse(fs.readFileSync(logFile, "utf8"))
    : {};

// Save logs, merging and pruning to last 30 days
const saveLogs = (logs) => {
  const existing = fs.existsSync(logFile)
    ? JSON.parse(fs.readFileSync(logFile, "utf8"))
    : {};

  // For each IP in the incoming logs, append and prune
  for (const ip of Object.keys(logs)) {
    const combined = [...(existing[ip] || []), ...logs[ip]];
    existing[ip] = pruneOldEntries(combined, 30);
  }

  fs.writeFileSync(logFile, JSON.stringify(existing, null, 2), "utf8");
};

// Function to normalize column headers
const normalizeHeaders = (data) => {
  return data.map((row) => {
    const normalizedRow = {};
    for (const key in row) {
      const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '_');
      normalizedRow[normalizedKey] = row[key];
    }
    return normalizedRow;
  });
};

// Function to load Excel data into cache
const loadExcelData = () => {
  if (Object.keys(allData).length === 0) {
    const loadSheet = (filePath) => {
      const workbook = xlsx.readFile(filePath);
      return normalizeHeaders(xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]));
    };

    allData = {
      archivers: loadSheet(archiverPath),
      controllers: loadSheet(controllerPath),
      cameras: loadSheet(cameraPath),
      servers: loadSheet(serverPath),
    };

    for (const deviceList of Object.values(allData)) {
      deviceList.forEach(device => {
        if (!device.history) {
          device.history = [];
        }
      });
    }

    console.log("Excel Data Loaded:", Object.keys(allData));
  }
};

// Fetch all IP addresses from loaded devices
const fetchAllIpAddress = () => {
  if (!allData || Object.keys(allData).length === 0) {
    console.error("Error: Device data is not loaded.");
    return [];
  }

  return Object.values(allData)
    .flatMap(devices => devices.map(device => device.ip_address).filter(Boolean));
};

const monitorDevice = (device) => {
  const logs = loadLogs();
  const currentTime = DateTime.now().setZone("Asia/Kolkata").toISO();

  if (!logs[device.ip_address]) {
    logs[device.ip_address] = [];
  }

  let lastEntry = logs[device.ip_address].slice(-1)[0];
  if (lastEntry && lastEntry.status === device.status) {
    return; // Avoid duplicate entries
  }

  console.log(`Status changed: ${device.device_name || device.ip_address} is now ${device.status}`);
  logs[device.ip_address].push({ status: device.status, timestamp: currentTime });
  saveLogs(logs);
};

// Update logs for uptime and downtime (also goes through saveLogs)
const updateLogs = (device, status) => {
  const logs = loadLogs();
  const currentTime = DateTime.now().setZone("Asia/Kolkata").toISO();

  logs[device.ip_address] = logs[device.ip_address] || [];
  logs[device.ip_address].push({ status, timestamp: currentTime });

  saveLogs(logs);
};

// Stop tracking when device status changes
const stopTracking = (device) => {
  if (activeDevices[device.ip_address]) {
    clearInterval(activeDevices[device.ip_address]);
    delete activeDevices[device.ip_address];
  }
};

// Function to Ping a Single Device
const pingDevice = (ip) => {
  return new Promise((resolve) => {
    ping.sys.probe(ip, (isAlive) => {
      resolve(isAlive ? "Online" : "Offline");
    });
  });
};

// Function to ping devices and cache results
const cache = new Map();

const pingDevices = async (devices) => {
  const limit = pLimit(10);

  const pingPromises = devices.map((device) =>
    limit(async () => {
      if (!device.ip_address) {
        device.status = "IP Address Missing";
        return;
      }

      if (cache.has(device.ip_address)) {
        device.status = cache.get(device.ip_address);
      } else {
        device.status = await pingDevice(device.ip_address);
        cache.set(device.ip_address, device.status);
      }

      monitorDevice(device);
    })
  );

  await Promise.all(pingPromises);
};

// Fetch Global Data
const fetchGlobalData = async () => {
  if (!allData || Object.keys(allData).length === 0) {
    console.error("Error: Device data is not loaded.");
    return null;
  }

  const allDevices = [
    ...allData.cameras,
    ...allData.archivers,
    ...allData.controllers,
    ...allData.servers
  ];

  await pingDevices(allDevices);
  const summary = calculateSummary(allData);

  return { summary, details: allData };
};

// Fetch Region Data
const fetchRegionData = async (regionName) => {
  if (!allData || Object.keys(allData).length === 0) {
    console.error("Error: Device data is not loaded.");
    return null;
  }

  const filterByRegion = (devices) =>
    devices.filter(device => device.location?.toLowerCase() === regionName.toLowerCase());

  const regionDevices = {
    cameras: filterByRegion(allData.cameras),
    archivers: filterByRegion(allData.archivers),
    controllers: filterByRegion(allData.controllers),
    servers: filterByRegion(allData.servers),
  };

  await pingDevices([
    ...regionDevices.cameras,
    ...regionDevices.archivers,
    ...regionDevices.controllers,
    ...regionDevices.servers
  ]);

  const summary = calculateSummary(regionDevices);
  return { summary, details: regionDevices };
};

// Calculate summary of devices
const calculateSummary = (devices) => {
  const summary = {};

  for (const [key, deviceList] of Object.entries(devices)) {
    const total = deviceList.length;
    const online = deviceList.filter(device => device.status === "Online").length;
    const offline = total - online;

    summary[key] = { total, online, offline };
  }

  return {
    totalDevices: Object.values(summary).reduce((sum, { total }) => sum + total, 0),
    totalOnlineDevices: Object.values(summary).reduce((sum, { online }) => sum + online, 0),
    totalOfflineDevices: Object.values(summary).reduce((sum, { offline }) => sum + offline, 0),
    ...summary,
  };
};

// Helper function to compute uptime and downtime for a device
const computeDeviceStats = (history) => {
  let uptime = 0, downtime = 0, downtimeDuration = 0;
  let lastStatus = history[0]?.status || "Offline";
  let lastTimestamp = history[0]
    ? DateTime.fromISO(history[0].timestamp).toMillis()
    : DateTime.now().toMillis();

  for (let i = 1; i < history.length; i++) {
    const currentStatus = history[i].status;
    const currentTime = DateTime.fromISO(history[i].timestamp).toMillis();
    const timeDiff = (currentTime - lastTimestamp) / 60000; // minutes

    if (timeDiff > 0) {
      if (lastStatus === "Online") uptime += timeDiff;
      else downtime += timeDiff;

      if (lastStatus === "Offline" && currentStatus === "Online") {
        downtimeDuration += downtime;
        downtime = 0;
      }
    }

    lastStatus = currentStatus;
    lastTimestamp = currentTime;
  }

  const formatTime = (minutes) => {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = Math.floor(minutes % 60);
    return `${days}d ${hours}h ${mins}m`;
  };

  return {
    uptime: formatTime(uptime),
    downtime: formatTime(downtime),
    downtimeDuration: formatTime(downtimeDuration)
  };
};

// Fetch Device History
const fetchDeviceHistory = async (device) => {
  const devicesLogs = fs.existsSync(logFile)
    ? JSON.parse(fs.readFileSync(logFile, "utf8"))
    : {};

  if (!devicesLogs[device.ip_address]) {
    console.log(`No history found for device: ${device.device_name || "Unknown"} (${device.ip_address})`);
    return;
  }

  device.history = [];
  devicesLogs[device.ip_address].forEach(log => {
    const convertedTimestamp = DateTime.fromISO(log.timestamp, { zone: 'utc' })
      .setZone('Asia/Kolkata')
      .toISO();

    device.history.push({
      status: log.status,
      timestamp: convertedTimestamp
    });
  });

  console.log(`Device history for ${device.device_name} (${device.ip_address}):`, device.history);
};

// Preload Data
loadExcelData();

module.exports = { fetchGlobalData, fetchRegionData, fetchAllIpAddress };

