import { db } from "./storage";

const USP_SERVICE_URL = process.env.USP_SERVICE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const DEFAULT_INTERVAL_SEC = Math.max(5, parseInt(process.env.TELEMETRY_INTERVAL || "15", 10) || 15);
const REQUEST_TIMEOUT_MS = 6000;
const RETENTION_MS = 24 * 3600 * 1000;

export interface TelemetryMetricMeta {
  key: string;
  label: string;
  unit: string;
  group: string;
}

// 5 chart groups / 7 stored series
export const TELEMETRY_METRICS: TelemetryMetricMeta[] = [
  { key: "cpu",            label: "CPU",         unit: "%",    group: "cpu" },
  { key: "mem_pct",        label: "Memory",      unit: "%",    group: "mem" },
  { key: "wan_rx_mbps",    label: "Download",    unit: "Mbps", group: "throughput" },
  { key: "wan_tx_mbps",    label: "Upload",      unit: "Mbps", group: "throughput" },
  { key: "optical_rx_dbm", label: "RX Power",    unit: "dBm",  group: "optical_power" },
  { key: "optical_tx_dbm", label: "TX Power",    unit: "dBm",  group: "optical_power" },
  { key: "optical_temp_c", label: "Temperature", unit: "°C",   group: "optical_temp" }
];

const PATH_CPU = "Device.DeviceInfo.ProcessStatus.CPUUsage";
const PATH_MEM_FREE = "Device.DeviceInfo.MemoryStatus.Free";
const PATH_MEM_TOTAL = "Device.DeviceInfo.MemoryStatus.Total";
const PATH_ETH = "Device.Ethernet.Interface.";
const PATH_OPT_RX = "Device.Optical.Interface.1.OpticalSignalLevel";
const PATH_OPT_TX = "Device.Optical.Interface.1.TransmitOpticalLevel";
const PATH_OPT_TEMP = "Device.Optical.Interface.1.X_TP_GPON_Config.TransceiverTemperature";

const POLL_PATHS = [PATH_CPU, PATH_MEM_FREE, PATH_MEM_TOTAL, PATH_ETH, PATH_OPT_RX, PATH_OPT_TX, PATH_OPT_TEMP];

interface DeviceLike {
  id: string;
  status?: string;
  name?: string;
}

interface PollState {
  running: boolean;
  intervalSec: number;
  startedAt: number | null;
  lastPollAt: number | null;
  lastError: string | null;
  lastDeviceCount: number;
  totalSamples: number;
}

const state: PollState = {
  running: false,
  intervalSec: DEFAULT_INTERVAL_SEC,
  startedAt: null,
  lastPollAt: null,
  lastError: null,
  lastDeviceCount: 0,
  totalSamples: 0
};

let timer: ReturnType<typeof setInterval> | null = null;
let polling = false;

// last raw WAN counters per device, to derive throughput (rate)
const prevCounters = new Map<string, { ts: number; rx: number; tx: number }>();

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractReqPathResults(data: any): any[] {
  return (
    data?.result?.msg?.body?.response?.get_resp?.req_path_results ||
    data?.body?.response?.get_resp?.req_path_results ||
    []
  );
}

function flattenResults(reqPathResults: any[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of reqPathResults) {
    for (const sub of r?.resolved_path_results || []) {
      const base = sub?.resolved_path || "";
      for (const [k, v] of Object.entries(sub?.result_params || {})) {
        map[base + k] = String(v);
      }
    }
  }
  return map;
}

async function uspGet(deviceId: string, paths: string[], timeoutSec = 6): Promise<Record<string, string>> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS + 2000);
  try {
    const res = await fetch(`${USP_SERVICE_URL}/api/usp/get`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_id: deviceId, paths, timeout: timeoutSec }),
      signal: controller.signal
    });
    const data = await res.json();
    if (data?.error) throw new Error(data.error);
    return flattenResults(extractReqPathResults(data));
  } finally {
    clearTimeout(to);
  }
}

async function listDevices(): Promise<DeviceLike[]> {
  try {
    const res = await fetch(`${USP_SERVICE_URL}/api/usp/devices`);
    const data = await res.json();
    return (data?.devices || []) as DeviceLike[];
  } catch {
    return [];
  }
}

function findWanInterfaceIndex(flat: Record<string, string>): string | null {
  let best: string | null = null;
  for (const key of Object.keys(flat)) {
    const m = key.match(/^Device\.Ethernet\.Interface\.(\d+)\.Upstream$/);
    if (m && flat[key] === "1") {
      best = m[1];
      break;
    }
  }
  return best;
}

function computeMetrics(deviceId: string, flat: Record<string, string>, ts: number): Record<string, number | null> {
  const out: Record<string, number | null> = {};

  out.cpu = num(flat[PATH_CPU]);

  const free = num(flat[PATH_MEM_FREE]);
  const total = num(flat[PATH_MEM_TOTAL]);
  out.mem_pct = free != null && total && total > 0 ? ((total - free) / total) * 100 : null;

  const idx = findWanInterfaceIndex(flat);
  const rx = idx ? num(flat[`Device.Ethernet.Interface.${idx}.Stats.BytesReceived`]) : null;
  const tx = idx ? num(flat[`Device.Ethernet.Interface.${idx}.Stats.BytesSent`]) : null;

  const prev = prevCounters.get(deviceId);
  if (prev && rx != null && tx != null) {
    const dtSec = (ts - prev.ts) / 1000;
    if (dtSec > 0 && rx >= prev.rx && tx >= prev.tx) {
      out.wan_rx_mbps = ((rx - prev.rx) * 8) / dtSec / 1e6;
      out.wan_tx_mbps = ((tx - prev.tx) * 8) / dtSec / 1e6;
    }
  }
  if (rx != null && tx != null) prevCounters.set(deviceId, { ts, rx, tx });

  const optRx = num(flat[PATH_OPT_RX]);
  const optTx = num(flat[PATH_OPT_TX]);
  out.optical_rx_dbm = optRx != null ? optRx / 1000 : null;
  out.optical_tx_dbm = optTx != null ? optTx / 1000 : null;

  const temp = num(flat[PATH_OPT_TEMP]);
  out.optical_temp_c = temp != null ? temp / 256 : null;

  return out;
}

async function pollDevice(deviceId: string, ts: number): Promise<number> {
  const flat = await uspGet(deviceId, POLL_PATHS);
  const metrics = computeMetrics(deviceId, flat, ts);
  let stored = 0;
  for (const [key, value] of Object.entries(metrics)) {
    if (value == null) continue;
    await db.insertUspTelemetry(deviceId, key, value, ts);
    stored++;
  }
  return stored;
}

async function pollOnce(): Promise<void> {
  if (polling) return;
  polling = true;
  const ts = Date.now();
  try {
    const devices = await listDevices();
    state.lastDeviceCount = devices.length;
    const results = await Promise.allSettled(devices.map((d) => pollDevice(d.id, ts)));
    let stored = 0;
    for (const r of results) if (r.status === "fulfilled") stored += r.value;
    state.totalSamples += stored;
    state.lastPollAt = ts;
    state.lastError = null;

    // retention
    try { await db.pruneUspTelemetry(Date.now() - RETENTION_MS); } catch {}
  } catch (e: any) {
    state.lastError = e?.message || String(e);
  } finally {
    polling = false;
  }
}

export function telemetryStatus() {
  return {
    running: state.running,
    intervalSec: state.intervalSec,
    startedAt: state.startedAt,
    lastPollAt: state.lastPollAt,
    lastError: state.lastError,
    deviceCount: state.lastDeviceCount,
    totalSamples: state.totalSamples,
    metrics: TELEMETRY_METRICS
  };
}

export function startTelemetry(intervalSec?: number): void {
  if (intervalSec && Number.isFinite(intervalSec)) {
    state.intervalSec = Math.min(3600, Math.max(5, Math.floor(intervalSec)));
  }
  if (state.running) {
    // restart with possibly new interval
    if (timer) clearInterval(timer);
  } else {
    state.running = true;
    state.startedAt = Date.now();
  }
  timer = setInterval(() => { pollOnce().catch(() => {}); }, state.intervalSec * 1000);
  // fire immediately (don't await)
  pollOnce().catch(() => {});
}

export function stopTelemetry(): void {
  state.running = false;
  if (timer) clearInterval(timer);
  timer = null;
}

export async function telemetrySamples(deviceId: string, from: number, to: number, limit = 5000) {
  const rows = await db.queryUspTelemetry(deviceId, from, to, limit);
  const series: Record<string, { t: number; v: number }[]> = {};
  for (const m of TELEMETRY_METRICS) series[m.key] = [];
  for (const r of rows) {
    if (series[r.metric]) series[r.metric].push({ t: r.ts, v: r.value });
  }
  return series;
}
