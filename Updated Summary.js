// ===== GLOBAL TIMERS =====
let deviceUptimeTimers = {};
let deviceDowntimeTimers = {};

// ===== UTILITIES =====
function sanitizeId(str) {
  return (str || '').replace(/[^a-zA-Z0-9]/g, '_');
}

function formatDuration(seconds) {
  const d = Math.floor(seconds/86400);
  const h = Math.floor((seconds%86400)/3600);
  const m = Math.floor((seconds%3600)/60);
  const s = Math.round(seconds%60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s||!parts.length) parts.push(`${s}s`);
  return parts.join('/');
}

// ===== DATA FETCHING & TABLE POPULATION =====
function fetchDeviceData() {
  const selectedRegion = document.getElementById('region').value;
  const url = selectedRegion === 'All'
    ? 'http://localhost/api/regions/all-details'
    : `http://localhost/api/regions/details/${selectedRegion}`;

  fetch(url)
    .then(res => res.json())
    .then(data => {
      let details;
      if (selectedRegion === 'All') {
        details = { cameras: [], archivers: [], controllers: [], servers: [] };
        Object.values(data).forEach(rd => {
          if (rd.details) {
            ['cameras','archivers','controllers','servers']
              .forEach(type => details[type].push(...(rd.details[type]||[])));
          }
        });
      } else {
        details = data.details;
        const d = details;
        const total = (d.cameras?.length||0) + (d.archivers?.length||0)
                    + (d.controllers?.length||0) + (d.servers?.length||0);
        const online = [...(d.cameras||[]),...(d.archivers||[]),
                        ...(d.controllers||[]),...(d.servers||[])]
                       .filter(dev => dev.status==="Online").length;
        const setIf = (id,txt)=>{ const e=document.getElementById(id); if(e) e.innerText=txt; };
        setIf("total-devices", `Total Devices: ${total}`);
        setIf("total-online", `Total Online Devices: ${online}`);
        setIf("total-cameras", `Total Cameras: ${d.cameras?.length||0}`);
        setIf("total-controllers", `Total Controllers: ${d.controllers?.length||0}`);
        setIf("total-archivers", `Total Archivers: ${d.archivers?.length||0}`);
        setIf("total-servers", `Total Servers: ${d.servers?.length||0}`);
      }
      fetchDeviceHistory(details);
    })
    .catch(err => console.error('Error fetching device data:', err));
}

function fetchDeviceHistory(details) {
  fetch(`http://localhost/api/devices/history`)
    .then(res => res.json())
    .then(historyData => {
      window.deviceHistoryData = historyData;
      populateDeviceTable(details);
    })
    .catch(err => console.error('Error fetching device history:', err));
}

function populateDeviceTable(details) {
  const tbody = document.querySelector('#device-table tbody');
  tbody.innerHTML = '';
  let list = [];

  ['cameras','archivers','controllers','servers'].forEach(type => {
    (details[type]||[]).forEach(dev => {
      const ip       = dev.ip_address;
      const safe     = sanitizeId(ip);
      const name     = dev[type.slice(0,-1)+'name'] || 'Unknown';
      const category = type.slice(0,-1).toUpperCase();
      const region   = dev.location || 'Unknown';
      const hist     = filterHistoryForDisplay(
                          window.deviceHistoryData[ip] || [], 
                          category
                        );
      const current  = hist.length
                       ? hist[hist.length-1].status
                       : (dev.status || 'Unknown');
      const downCount = hist.filter(e => e.status==='Offline').length;

      if (current === 'Offline' || downCount > 15) {
        list.push({ ip, safe, name, category, region, current, downCount });
      }
    });
  });

  list.sort((a,b)=>b.downCount - a.downCount);
  const setIf = (id,txt)=>{ const e=document.getElementById(id); if(e) e.innerText=txt; };
  setIf('count-downtime-over-15', `Devices with >15 downtimes: ${list.filter(d=>d.downCount>15).length}`);
  setIf('count-currently-offline', `Devices currently Offline: ${list.filter(d=>d.current==='Offline').length}`);

  if (!list.length) {
    const row = tbody.insertRow();
    const cell= row.insertCell();
    cell.colSpan=10;
    cell.textContent="No devices found";
    cell.style.textAlign="center";
    cell.style.fontWeight="bold";
    updateDisplayedDeviceCount(0);
    return;
  }

  list.forEach((dev, idx) => {
    const row = tbody.insertRow();
    row.style.border="1px solid black";
    row.innerHTML=`
      <td>${idx+1}</td>
      <td>${dev.ip}</td>
      <td>${dev.name}</td>
      <td>${dev.category}</td>
      <td>${dev.region}</td>
      <td id="uptime-${dev.safe}">0h/0m/0s</td>
      <td id="downtime-count-${dev.safe}">${dev.downCount}</td>
      <td id="downtime-${dev.safe}">0h/0m/0s</td>
      <td>
        <button onclick="openDeviceHistory('${dev.ip}','${dev.name}','${dev.category}')">
          View History
        </button>
      </td>
      <td id="remark-${dev.safe}">Device working properly</td>
    `;
    row.style.color = dev.current==="Online" ? "green" : "red";

    if (dev.current==="Online") {
      startUptime(dev.ip, dev.category);
    } else {
      startDowntime(dev.ip, dev.category);
    }
    updateRemarks(dev.ip, dev.category);
  });

  // Ensure filterData exists before calling
  if (typeof filterData === 'function') filterData();
}

// ===== HISTORY FILTER =====
function filterHistoryForDisplay(hist, category) {
  if (category === 'SERVER') return hist.slice();
  const filtered = [];
  let lastOff = null;
  hist.forEach(e => {
    if (e.status==='Offline') {
      lastOff = e;
    } else if (e.status==='Online' && lastOff) {
      const diff = (new Date(e.timestamp) - new Date(lastOff.timestamp)) / 1000;
      if (diff >= 300) filtered.push(lastOff, e);
      lastOff = null;
    } else {
      filtered.push(e);
    }
  });
  if (lastOff) {
    const diff = (Date.now() - new Date(lastOff.timestamp)) / 1000;
    if (diff >= 300) filtered.push(lastOff);
  }
  return filtered.sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
}

// ===== TIMERS & COUNTERS =====
function startUptime(ip, category) {
  const safe = sanitizeId(ip);
  clearInterval(deviceUptimeTimers[safe]);
  clearInterval(deviceDowntimeTimers[safe]);
  const hist  = filterHistoryForDisplay(window.deviceHistoryData[ip]||[], category);
  const lastOn= hist.filter(e=>e.status==='Online').pop();
  if (!lastOn) return;
  const startTs = new Date(lastOn.timestamp).getTime();
  deviceUptimeTimers[safe] = setInterval(()=>{
    const secs = Math.floor((Date.now() - startTs)/1000);
    const el = document.getElementById(`uptime-${safe}`);
    if (el) el.innerText = formatDuration(secs);
  },1000);
}

function startDowntime(ip, category) {
  const safe = sanitizeId(ip);
  clearInterval(deviceDowntimeTimers[safe]);
  clearInterval(deviceUptimeTimers[safe]);
  const hist   = filterHistoryForDisplay(window.deviceHistoryData[ip]||[], category);
  const lastOff= hist.filter(e=>e.status==='Offline').pop();
  if (!lastOff) return;
  const startTs = new Date(lastOff.timestamp).getTime();
  deviceDowntimeTimers[safe] = setInterval(()=>{
    const secs = Math.floor((Date.now() - startTs)/1000);
    const dtEl = document.getElementById(`downtime-${safe}`);
    if (dtEl) dtEl.innerText = formatDuration(secs);
    updateDowntimeCount(ip, category);
  },1000);
}

function updateDowntimeCount(ip, category) {
  const safe = sanitizeId(ip);
  const hist = filterHistoryForDisplay(window.deviceHistoryData[ip]||[], category);
  const count= hist.filter(e=>e.status==='Offline').length;
  const el   = document.getElementById(`downtime-count-${safe}`);
  if (el) el.innerText = count;
  updateRemarks(ip, category);
}

function updateRemarks(ip, category) {
  const safe = sanitizeId(ip);
  const hist = filterHistoryForDisplay(window.deviceHistoryData[ip]||[], category);
  const count= hist.filter(e=>e.status==='Offline').length;
  const last = hist.length ? hist[hist.length-1].status : 'Unknown';
  const el   = document.getElementById(`remark-${safe}`);
  if (!el) return;

  if (last==='Offline') {
    el.innerText = count>=10
      ? "Device is Offline, needs repair."
      : "Device is Offline.";
  } else if (last==='Online') {
    if (count>=10) el.innerText = "Device is Online, needs repair.";
    else if (count>0) el.innerText = `Device is Online, it had ${count} downtime occurrences.`;
    else el.innerText = "Device is Online.";
  } else {
    el.innerText = "Device status unknown.";
  }
}

// ===== TABLE FILTERS & EXPORTS =====
function filterData() {
  const typeSel   = document.getElementById('device-type').value.toUpperCase();
  const remarkSel = document.getElementById('remark-filter').value.toUpperCase();
  const rows      = document.querySelectorAll('#device-table tbody tr');
  let count = 0;

  rows.forEach(row => {
    const type   = row.cells[3].textContent.toUpperCase();
    const remark = row.cells[9].textContent.toUpperCase();
    const show   = (typeSel==='ALL' || type===typeSel)
                  && (remarkSel==='ALL' || remark.includes(remarkSel));
    row.style.display = show ? '' : 'none';
    if (show) count++;
  });

  updateDisplayedDeviceCount(count);
}

function updateDisplayedDeviceCount(count) {
  const el = document.getElementById('device-count');
  if (el) el.innerText = `Displayed Devices: ${count}`;
}

function openDeviceHistory(ip,name,category) {
  if (!window.deviceHistoryData) return console.error("No history loaded");
  const raw  = window.deviceHistoryData[ip]||[];
  const hist = filterHistoryForDisplay(raw,category);
  displayDeviceHistory(ip,name,category,hist);
  const modal = document.getElementById('device-history-modal');
  if (modal) modal.style.display='block';
}

function closeHistoryModal() {
  const modal = document.getElementById('device-history-modal');
  if (modal) modal.style.display='none';
}

function exportDeviceTableToExcel() {
  const tbl = document.getElementById("device-table");
  if (!tbl) return;
  const wb  = XLSX.utils.table_to_book(tbl, { sheet: "Device Table" });
  XLSX.writeFile(wb, "Device_Table.xlsx");
}

function exportDeviceHistoryToExcel() {
  const histTbl = document.querySelector("#device-history-modal table");
  if (!histTbl) return alert("Please open a device's history first.");
  const wb      = XLSX.utils.table_to_book(histTbl, { sheet: "Device History" });
  XLSX.writeFile(wb, "Device_History.xlsx");
}

// ===== BOOTSTRAP =====
document.addEventListener("DOMContentLoaded", ()=>{
  ['region','device-type','remark-filter'].forEach(id=>{
    const el = document.getElementById(id);
    if (!el) return;
    const handler = id==='region' ? fetchDeviceData : filterData;
    // guard just in case:
    el.addEventListener('change', typeof handler==='function' ? handler : ()=>{});
  });
  fetchDeviceData();
});












let deviceUptimeTimers = {};
let deviceDowntimeTimers = {};

// Utility to turn an IP (or any string) into a safe DOM-ID fragment
function sanitizeId(str) {
  return (str || '').replace(/[^a-zA-Z0-9]/g, '_');
}

function fetchDeviceData() {
  const selectedRegion = document.getElementById('region').value;
  const url =
    selectedRegion === 'All'
      ? 'http://localhost/api/regions/all-details'
      : `http://localhost/api/regions/details/${selectedRegion}`;

  fetch(url)
    .then(res => res.json())
    .then(data => {
      let details;
      if (selectedRegion === 'All') {
        details = { cameras: [], archivers: [], controllers: [], servers: [] };
        Object.values(data).forEach(rd => {
          if (rd.details) {
            ['cameras','archivers','controllers','servers']
              .forEach(type => details[type].push(...(rd.details[type]||[])));
          }
        });
      } else {
        details = data.details;
        const d = details;
        const total = (d.cameras?.length||0) + (d.archivers?.length||0)
                    + (d.controllers?.length||0) + (d.servers?.length||0);
        const online = [...(d.cameras||[]),...(d.archivers||[]),
                        ...(d.controllers||[]),...(d.servers||[])]
                       .filter(dev => dev.status==="Online").length;
        const setIf = (id,txt)=>{ const e=document.getElementById(id); if(e) e.innerText=txt; };
        setIf("total-devices", `Total Devices: ${total}`);
        setIf("total-online", `Total Online Devices: ${online}`);
        setIf("total-cameras", `Total Cameras: ${d.cameras?.length||0}`);
        setIf("total-controllers", `Total Controllers: ${d.controllers?.length||0}`);
        setIf("total-archivers", `Total Archivers: ${d.archivers?.length||0}`);
        setIf("total-servers", `Total Servers: ${d.servers?.length||0}`);
      }
      fetchDeviceHistory(details);
    })
    .catch(err => console.error('Error fetching device data:', err));
}

function fetchDeviceHistory(details) {
  fetch(`http://localhost/api/devices/history`)
    .then(res => res.json())
    .then(historyData => {
      window.deviceHistoryData = historyData;
      populateDeviceTable(details);
    })
    .catch(err => console.error('Error fetching device history:', err));
}

function populateDeviceTable(details) {
  const tbody = document.querySelector('#device-table tbody');
  tbody.innerHTML = '';
  let list = [];

  ['cameras','archivers','controllers','servers'].forEach(type => {
    (details[type]||[]).forEach(dev => {
      const ip       = dev.ip_address;
      const safe     = sanitizeId(ip);
      const name     = dev[type.slice(0,-1)+'name'] || 'Unknown';
      const category = type.slice(0,-1).toUpperCase();
      const region   = dev.location || 'Unknown';
      const hist     = filterHistoryForDisplay(
                          window.deviceHistoryData[ip] || [], 
                          category
                        );
      // Always take current from history if we have one:
      const current  = hist.length
                       ? hist[hist.length-1].status
                       : (dev.status || 'Unknown');
      const downCount = hist.filter(e => e.status==='Offline').length;

      // Only show currently Offline, or those with >15 total downtimes:
      if (current === 'Offline' || downCount > 15) {
        list.push({ ip, safe, name, category, region, current, downCount });
      }
    });
  });

  // Update summary widgets
  list.sort((a,b)=>b.downCount - a.downCount);
  const setIf = (id,txt)=>{ const e=document.getElementById(id); if(e) e.innerText=txt; };
  setIf('count-downtime-over-15', `Devices with >15 downtimes: ${list.filter(d=>d.downCount>15).length}`);
  setIf('count-currently-offline', `Devices currently Offline: ${list.filter(d=>d.current==='Offline').length}`);

  if (!list.length) {
    const row = tbody.insertRow();
    const cell= row.insertCell();
    cell.colSpan=10;
    cell.textContent="No devices found";
    cell.style.textAlign="center";
    cell.style.fontWeight="bold";
    updateDisplayedDeviceCount(0);
    return;
  }

  list.forEach((dev, idx) => {
    const row = tbody.insertRow();
    row.style.border="1px solid black";
    row.innerHTML=`
      <td>${idx+1}</td>
      <td>${dev.ip}</td>
      <td>${dev.name}</td>
      <td>${dev.category}</td>
      <td>${dev.region}</td>
      <td id="uptime-${dev.safe}">0h/0m/0s</td>
      <td id="downtime-count-${dev.safe}">${dev.downCount}</td>
      <td id="downtime-${dev.safe}">0h/0m/0s</td>
      <td>
        <button onclick="openDeviceHistory('${dev.ip}','${dev.name}','${dev.category}')">
          View History
        </button>
      </td>
      <td id="remark-${dev.safe}">Device working properly</td>
    `;
    row.style.color = dev.current==="Online" ? "green" : "red";

    if (dev.current==="Online") {
      startUptime(dev.ip, dev.category);
    } else {
      startDowntime(dev.ip, dev.category);
    }
    updateRemarks(dev.ip, dev.category);
  });

  filterData();
}

// ... keep your existing filterHistoryForDisplay ...

function startUptime(ip, category) {
  const safe = sanitizeId(ip);
  clearInterval(deviceUptimeTimers[safe]);
  clearInterval(deviceDowntimeTimers[safe]);

  const hist = filterHistoryForDisplay(
                 window.deviceHistoryData[ip]||[],
                 category
               );
  const lastOn = hist.filter(e=>e.status==='Online').pop();
  if (!lastOn) return;

  const startTs = new Date(lastOn.timestamp).getTime();
  deviceUptimeTimers[safe] = setInterval(()=>{
    const secs = Math.floor((Date.now() - startTs)/1000);
    const el = document.getElementById(`uptime-${safe}`);
    if (el) el.innerText = formatDuration(secs);
  },1000);
}

function startDowntime(ip, category) {
  const safe = sanitizeId(ip);
  clearInterval(deviceDowntimeTimers[safe]);
  clearInterval(deviceUptimeTimers[safe]);

  const hist = filterHistoryForDisplay(
                 window.deviceHistoryData[ip]||[],
                 category
               );
  const lastOff = hist.filter(e=>e.status==='Offline').pop();
  if (!lastOff) return;

  const startTs = new Date(lastOff.timestamp).getTime();
  deviceDowntimeTimers[safe] = setInterval(()=>{
    const secs = Math.floor((Date.now() - startTs)/1000);
    const dtEl = document.getElementById(`downtime-${safe}`);
    if (dtEl) dtEl.innerText = formatDuration(secs);
    updateDowntimeCount(ip, category);
  },1000);
}

function updateDowntimeCount(ip, category) {
  const safe = sanitizeId(ip);
  const hist = filterHistoryForDisplay(
                 window.deviceHistoryData[ip]||[],
                 category
               );
  const count = hist.filter(e=>e.status==='Offline').length;
  const el = document.getElementById(`downtime-count-${safe}`);
  if (el) el.innerText = count;
  updateRemarks(ip, category);
}

function updateRemarks(ip, category) {
  const safe = sanitizeId(ip);
  const hist = filterHistoryForDisplay(
                 window.deviceHistoryData[ip]||[],
                 category
               );
  const count = hist.filter(e=>e.status==='Offline').length;
  const lastStatus = hist.length
                     ? hist[hist.length-1].status
                     : 'Unknown';
  const el = document.getElementById(`remark-${safe}`);
  if (!el) return;

  if (lastStatus==='Offline') {
    el.innerText = count>=10
      ? "Device is Offline, needs repair."
      : "Device is Offline.";
  }
  else if (lastStatus==='Online') {
    if (count>=10) el.innerText = "Device is Online, needs repair.";
    else if (count>0) el.innerText = `Device is Online, it had ${count} downtime occurrences.`;
    else el.innerText = "Device is Online.";
  }
  else {
    el.innerText = "Device status unknown.";
  }
}

function formatDuration(seconds) {
  const d = Math.floor(seconds/86400);
  const h = Math.floor((seconds%86400)/3600);
  const m = Math.floor((seconds%3600)/60);
  const s = Math.round(seconds%60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s||!parts.length) parts.push(`${s}s`);
  return parts.join('/');
}

// ... keep openDeviceHistory, displayDeviceHistory, closeHistoryModal, filterData, updateDisplayedDeviceCount, export functions the same ...

document.addEventListener("DOMContentLoaded", ()=>{
  ['region','device-type','remark-filter'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('change',
      id==='region' ? fetchDeviceData : filterData
    );
  });
  fetchDeviceData();
});

























let deviceUptimeTimers = {};
let deviceDowntimeTimers = {};

// Utility to turn an IP (or any string) into a safe DOM‑ID fragment
function sanitizeId(str) {
    return (str || '').replace(/[^a-zA-Z0-9]/g, '_');
}

function fetchDeviceData() {
    const selectedRegion = document.getElementById('region').value;

    if (selectedRegion === 'All') {
        fetch(`http://localhost/api/regions/all-details`)
            .then(res => res.json())
            .then(allRegionsData => {
                let combinedDetails = { cameras: [], archivers: [], controllers: [], servers: [] };
                Object.values(allRegionsData).forEach(regionData => {
                    if (regionData.details) {
                        ['cameras','archivers','controllers','servers'].forEach(type => {
                            combinedDetails[type].push(...(regionData.details[type]||[]));
                        });
                    }
                });
                fetchDeviceHistory(combinedDetails);
            })
            .catch(err => console.error('Error fetching all regions data:', err));
    } else {
        fetch(`http://localhost/api/regions/details/${selectedRegion}`)
            .then(res => res.json())
            .then(regionData => {
                const d = regionData.details;
                const total = (d.cameras?.length||0)+(d.archivers?.length||0)+(d.controllers?.length||0)+(d.servers?.length||0);
                const online = ([...(d.cameras||[]),...(d.archivers||[]),...(d.controllers||[]),...(d.servers||[])]
                    .filter(dev => dev.status==="Online").length);
                const setIf = (id,txt)=>{const el=document.getElementById(id); if(el) el.innerText=txt;};
                setIf("total-devices", `Total Devices: ${total}`);
                setIf("total-online", `Total Online Devices: ${online}`);
                setIf("total-cameras", `Total Cameras: ${d.cameras?.length||0}`);
                setIf("total-controllers", `Total Controllers: ${d.controllers?.length||0}`);
                setIf("total-archivers", `Total Archivers: ${d.archivers?.length||0}`);
                setIf("total-servers", `Total Servers: ${d.servers?.length||0}`);
                fetchDeviceHistory(d);
            })
            .catch(err => console.error('Error fetching device data:', err));
    }
}

function fetchDeviceHistory(details) {
    fetch(`http://localhost/api/devices/history`)
        .then(res => res.json())
        .then(historyData => {
            populateDeviceTable(details, historyData);
            window.deviceHistoryData = historyData;
        })
        .catch(err => console.error('Error fetching device history:', err));
}

function populateDeviceTable(details, historyData) {
    const tbody = document.getElementById('device-table').getElementsByTagName('tbody')[0];
    tbody.innerHTML = '';
    let list = [];

    ['cameras','archivers','controllers','servers'].forEach(type => {
        details[type]?.forEach(dev => {
            const ip = dev.ip_address;
            const safe = sanitizeId(ip);
            const name = dev[type.slice(0,-1)+'name']||'Unknown';
            const category = type.slice(0,-1).toUpperCase();
            const region = dev.location||'Unknown';
            const hist = filterHistoryForDisplay(historyData[ip]||[], category);
            const current = dev.status || (hist.length? hist[hist.length-1].status : 'Unknown');
            const downCount = hist.filter(e=>e.status==='Offline').length;

            // Only show offline or >15 downtimes
            if (current==='Offline' || downCount>15) {
                list.push({ ip, safe, name, category, region, current, hist, downCount });
            }
        });
    });

    list.sort((a,b)=>b.downCount - a.downCount);

    // compute our two new summary counts:
    const downtimeOver15Count = list.filter(d=>d.downCount>15).length;
    const currentlyOfflineCount = list.filter(d=>d.current==='Offline').length;
    const setIf = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
    setIf('count-downtime-over-15', `Devices with >15 downtimes: ${downtimeOver15Count}`);
    setIf('count-currently-offline', `Devices currently Offline: ${currentlyOfflineCount}`);

    if (!list.length) {
        const row = tbody.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 10;
        cell.textContent = "No devices found";
        cell.style.textAlign = "center";
        cell.style.fontWeight = "bold";
        updateDisplayedDeviceCount(0);
        return;
    }

    list.forEach((dev, idx) => {
        const row = tbody.insertRow();
        row.style.border = "1px solid black";
        row.innerHTML = `
            <td>${idx+1}</td>
            <td>${dev.ip}</td>
            <td>${dev.name}</td>
            <td>${dev.category}</td>
            <td>${dev.region}</td>
            <td id="uptime-${dev.safe}">0h/0m/0s</td>
            <td id="downtime-count-${dev.safe}">${dev.downCount}</td>
            <td id="downtime-${dev.safe}">0h/0m/0s</td>
            <td><button onclick="openDeviceHistory('${dev.ip}','${dev.name}','${dev.category}')">View History</button></td>
            <td id="remark-${dev.safe}">Device working properly</td>
        `;
        row.style.color = dev.current==="Online" ? "green" : "red";

        if (dev.current==="Online") {
            startUptime(dev.ip, dev.hist);
        } else {
            startDowntime(dev.ip, dev.hist, dev.category);
        }
        updateRemarks(dev.ip, dev.hist, dev.category);
    });

    filterData();
}

function filterHistoryForDisplay(hist, category) {
    if (category === 'SERVER') return hist.slice(); // show all
    // else: remove any offline entries that resolve within 5 minutes
    const filtered = [];
    let lastOff = null;
    hist.forEach(e => {
        if (e.status === 'Offline') {
            lastOff = e;
        } else if (e.status === 'Online' && lastOff) {
            const diff = (new Date(e.timestamp) - new Date(lastOff.timestamp)) / 1000;
            if (diff >= 300) {
                // keep the offline event and the matching online event
                filtered.push(lastOff, e);
            }
            lastOff = null;
        } else {
            filtered.push(e);
        }
    });
    // If an Offline at end with no Online, and it's >5min ago, keep it
    if (lastOff) {
        const diff = (Date.now() - new Date(lastOff.timestamp)) / 1000;
        if (diff >= 300) filtered.push(lastOff);
    }
    return filtered.sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
}

function startUptime(ip, hist) {
    const safe = sanitizeId(ip);
    clearInterval(deviceDowntimeTimers[safe]);
    const lastOn = hist.filter(e=>e.status==='Online').pop();
    if (!lastOn) return;
    const start = new Date(lastOn.timestamp).getTime();
    deviceUptimeTimers[safe] = setInterval(()=>{
        const secs = Math.floor((Date.now()-start)/1000);
        const el = document.getElementById(`uptime-${safe}`);
        if (el) el.innerText = formatDuration(secs);
    },1000);
}

function startDowntime(ip, hist, category) {
    const safe = sanitizeId(ip);
    clearInterval(deviceUptimeTimers[safe]);
    const lastOff = hist.filter(e=>e.status==='Offline').pop();
    if (!lastOff) return;
    const start = new Date(lastOff.timestamp).getTime();
    deviceDowntimeTimers[safe] = setInterval(()=>{
        const secs = Math.floor((Date.now()-start)/1000);
        const el = document.getElementById(`downtime-${safe}`);
        if (el) el.innerText = formatDuration(secs);
        updateDowntimeCount(ip, hist, category);
    },1000);
}

function updateDowntimeCount(ip, hist, category) {
    const safe = sanitizeId(ip);
    const offs = filterHistoryForDisplay(hist, category).filter(e=>e.status==='Offline');
    const count = offs.length;
    const el = document.getElementById(`downtime-count-${safe}`);
    if (el) el.innerText = count;
    updateRemarks(ip, hist, category);
}

function updateRemarks(ip, hist, category) {
    const safe = sanitizeId(ip);
    const filteredOffs = filterHistoryForDisplay(hist, category).filter(e=>e.status==='Offline');
    const count = filteredOffs.length;
    const lastStatus = hist.length? hist[hist.length-1].status : 'Unknown';
    const el = document.getElementById(`remark-${safe}`);
    if (!el) return;

    if (lastStatus==='Offline') {
        el.innerText = count>=10 ? "Device is Offline, needs repair." : "Device is Offline.";
    }
    else if (lastStatus==='Online') {
        if (count>=10) el.innerText = "Device is Online, needs repair.";
        else if (count>0) el.innerText = `Device is Online, it had ${count} downtime occurrences.`;
        else el.innerText = "Device is Online.";
    }
    else {
        el.innerText = "Device status unknown.";
    }
    const dc = document.getElementById(`downtime-count-${safe}`);
    if (dc) dc.innerText = count;
}

function formatDuration(seconds) {
    const d = Math.floor(seconds/86400);
    const h = Math.floor((seconds%86400)/3600);
    const m = Math.floor((seconds%3600)/60);
    const s = Math.round(seconds%60);
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    if (s||!parts.length) parts.push(`${s}s`);
    return parts.join('/');
}

function openDeviceHistory(ip,name,category) {
    if (!window.deviceHistoryData) return console.error("No history loaded");
    const raw = window.deviceHistoryData[ip]||[];
    const hist = filterHistoryForDisplay(raw, category);
    displayDeviceHistory(ip,name,category,hist);
    const modal = document.getElementById('device-history-modal');
    if (modal) modal.style.display='block';
}

function calculateDowntimeDuration(ts, hist) {
    const start = new Date(ts).getTime();
    const nextUp = hist.find(e=> e.status==='Online' && new Date(e.timestamp).getTime()>start);
    if (nextUp) return formatDuration((new Date(nextUp.timestamp).getTime()-start)/1000);
    return formatDuration((Date.now()-start)/1000);
}

function displayDeviceHistory(ip,name,category,hist) {
    const header = document.getElementById('device-history-header');
    const container = document.getElementById('device-history');
    if (header) {
        header.innerHTML=`
            <h3>Device History</h3>
            <p><strong>Device Name:</strong> ${name}</p>
            <p><strong>Device IP:</strong> ${ip}</p>
            <hr>`;
    }
    if (!container) return;
    container.innerHTML='';
    if (!hist.length) {
        container.innerHTML='<p>No significant history (all brief outages &lt;5 min).</p>';
        return;
    }
    let html = `
        <table border="1" style="width:100%; text-align:center; border-collapse:collapse;">
            <thead><tr>
                <th>Sr. No</th><th>Date</th><th>Day</th><th>Time</th><th>Status</th><th>Downtime Duration</th>
            </tr></thead><tbody>`;
    let lastOff = null;
    hist.forEach((e,i)=>{
        const d = new Date(e.timestamp);
        const date = d.toLocaleDateString();
        const day = d.toLocaleString('en-US',{weekday:'long'});
        const time = d.toLocaleTimeString();
        let dur = '-';
        if (e.status==='Offline') lastOff = e.timestamp;
        else if (e.status==='Online' && lastOff) {
            dur = calculateDowntimeDuration(lastOff,hist);
            lastOff = null;
        }
        html+=`
            <tr>
                <td>${i+1}</td><td>${date}</td><td>${day}</td><td>${time}</td>
                <td style="color:${e.status==='Online'?'green':'red'}">${e.status}</td>
                <td>${dur}</td>
            </tr>`;
    });
    html+=`</tbody></table>`;
    container.innerHTML=html;
}

function closeHistoryModal() {
    const modal = document.getElementById('device-history-modal');
    if (modal) modal.style.display='none';
}

function filterData() {
    const typeSel = document.getElementById('device-type').value.toUpperCase();
    const remarkSel = document.getElementById('remark-filter').value.toUpperCase();
    const rows = document.getElementById('device-table').getElementsByTagName('tbody')[0].rows;
    let count = 0;
    for (let row of rows) {
        const type = row.cells[3].textContent.toUpperCase();
        const remark = row.cells[9].textContent.trim().toUpperCase();
        const show = (typeSel==='ALL'||type===typeSel) && (remarkSel==='ALL'||remark.includes(remarkSel));
        row.style.display = show? '':'none';
        if (show) count++;
    }
    updateDisplayedDeviceCount(count);
}

function updateDisplayedDeviceCount(count) {
    const el = document.getElementById('device-count');
    if (el) el.innerText = `Displayed Devices: ${count}`;
}

document.addEventListener("DOMContentLoaded", ()=>{
    ['region','device-type','remark-filter'].forEach(id=>{
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', id==='region'? fetchDeviceData : filterData);
    });
    fetchDeviceData();
});

function exportDeviceTableToExcel() {
    const tbl = document.getElementById("device-table");
    if (!tbl) return;
    const wb = XLSX.utils.table_to_book(tbl, { sheet: "Device Table" });
    XLSX.writeFile(wb, "Device_Table.xlsx");
}

function exportDeviceHistoryToExcel() {
    const histTbl = document.querySelector("#device-history-modal table");
    if (!histTbl) return alert("Please open a device's history first.");
    const wb = XLSX.utils.table_to_book(histTbl, { sheet: "Device History" });
    XLSX.writeFile(wb, "Device_History.xlsx");
}

