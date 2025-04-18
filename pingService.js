// src/services/pingService.js
const ping = require("ping");
const DEFAULT_TIMEOUT = 5; // seconds
const ICMP_COUNT_FLAG = process.platform === "win32" ? "-n" : "-c";

async function pingHost(ip) {
  try {
    const res = await ping.promise.probe(ip, {
      timeout: DEFAULT_TIMEOUT,
      extra: [ICMP_COUNT_FLAG, "1"],
    });
    return res.alive ? "Online" : "Offline";
  } catch {
    return "Offline";
  }
}

module.exports = { pingHost };
