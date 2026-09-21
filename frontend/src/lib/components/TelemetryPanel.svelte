<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import TelemetryChart from "./TelemetryChart.svelte";
  import CustomSelect from "./CustomSelect.svelte";
  import { RefreshCw, Trash2 } from "lucide-svelte";

  interface DeviceLike {
    id: string;
    name?: string;
    status?: string;
    ip?: string;
  }

  let {
    devices = [],
    activeDevice = $bindable("")
  }: { devices?: DeviceLike[]; activeDevice?: string } = $props();

  const META: Record<string, { label: string; unit: string }> = {
    cpu: { label: "CPU", unit: "%" },
    mem_pct: { label: "Memory", unit: "%" },
    wan_rx_mbps: { label: "Download", unit: "Mbps" },
    wan_tx_mbps: { label: "Upload", unit: "Mbps" },
    optical_rx_dbm: { label: "RX Power", unit: "dBm" },
    optical_tx_dbm: { label: "TX Power", unit: "dBm" },
    optical_temp_c: { label: "Temperature", unit: "°C" }
  };

  const GROUPS: { id: string; title: string; unit: string; metrics: string[] }[] = [
    { id: "cpu", title: "CPU", unit: "%", metrics: ["cpu"] },
    { id: "mem", title: "Memory", unit: "%", metrics: ["mem_pct"] },
    { id: "throughput", title: "WAN Throughput", unit: "Mbps", metrics: ["wan_rx_mbps", "wan_tx_mbps"] },
    { id: "optical_power", title: "Optical Power", unit: "dBm", metrics: ["optical_rx_dbm", "optical_tx_dbm"] },
    { id: "optical_temp", title: "Optical Temperature", unit: "°C", metrics: ["optical_temp_c"] }
  ];

  const COLORS = ["#EC1C24", "#8a8a8a"];

  const RANGES: Record<string, number> = {
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "1h": 60 * 60_000,
    "6h": 6 * 60 * 60_000,
    "24h": 24 * 60 * 60_000
  };

  let status = $state<any>({ running: false, intervalSec: 15, lastPollAt: null, totalSamples: 0 });
  let range = $state("15m");
  let series = $state<Record<string, { t: number; v: number }[]>>({});
  let loading = $state(false);
  let toggling = $state(false);
  let error = $state<string | null>(null);
  let timer: any = null;

  const deviceOptions = $derived(
    devices.map((d) => ({ value: d.id, label: d.name || d.id, sublabel: d.status || "" }))
  );

  async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) }
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(data?.error || "HTTP " + res.status);
    return data as T;
  }

  async function fetchStatus() {
    try {
      status = await api("/api/usp/telemetry/status");
    } catch (e: any) {
      error = e.message;
    }
  }

  async function fetchSamples() {
    if (!activeDevice) return;
    const to = Date.now();
    const from = to - (RANGES[range] || RANGES["15m"]);
    try {
      const data = await api(`/api/usp/telemetry?device_id=${encodeURIComponent(activeDevice)}&from=${from}&to=${to}&limit=8000`);
      series = data.series || {};
      error = null;
    } catch (e: any) {
      error = e.message;
    }
  }

  async function toggleRecord() {
    toggling = true;
    try {
      status = await api("/api/usp/telemetry/record", {
        method: "POST",
        body: JSON.stringify({ enabled: !status.running, intervalSec: status.intervalSec })
      });
      await fetchSamples();
    } catch (e: any) {
      error = e.message;
    } finally {
      toggling = false;
    }
  }

  async function clearData() {
    if (!activeDevice) return;
    await api(`/api/usp/telemetry?device_id=${encodeURIComponent(activeDevice)}`, { method: "DELETE" }).catch(() => {});
    await fetchSamples();
  }

  async function refreshAll() {
    loading = true;
    await Promise.all([fetchStatus(), fetchSamples()]);
    loading = false;
  }

  onMount(async () => {
    await fetchStatus();
    if (!activeDevice && devices[0]) activeDevice = devices[0].id;
    await fetchSamples();
    timer = setInterval(() => { fetchStatus(); fetchSamples(); }, 5000);
  });

  onDestroy(() => { if (timer) clearInterval(timer); });

  $effect(() => {
    activeDevice;
    range;
    if (timer) fetchSamples();
  });

  function groupSeries(g: { metrics: string[] }) {
    return g.metrics.map((key, i) => ({
      label: META[key]?.label || key,
      color: COLORS[i % COLORS.length],
      points: series[key] || []
    }));
  }

  function fmtTime(ts: number | null) {
    if (!ts) return "—";
    return new Date(ts).toLocaleTimeString();
  }
</script>

<div class="space-y-4">
  <!-- Header -->
  <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
    <div class="flex items-center gap-2 flex-wrap">
      <CustomSelect bind:value={activeDevice} options={deviceOptions} label="Agent:" placeholder="Select ONT" className="w-64" />
      <CustomSelect
        bind:value={range}
        options={Object.keys(RANGES).map((r) => ({ value: r, label: r }))}
        label="Range:"
        placeholder="15m"
      />
    </div>

    <div class="flex items-center gap-2 flex-wrap">
      <!-- Record on/off switch -->
      <button
        type="button"
        onclick={toggleRecord}
        disabled={toggling}
        class="flex items-center gap-2 h-8 pl-2.5 pr-3 rounded-md border transition-colors cursor-pointer
          {status.running ? 'border-accent-600 bg-accent-50' : 'border-cream-300 bg-white'}"
        title={status.running ? "Stop recording" : "Start recording"}
      >
        <span class="relative inline-block w-9 h-5 rounded-full transition-colors {status.running ? 'bg-accent-600' : 'bg-stone-300'}">
          <span class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform {status.running ? 'translate-x-4' : ''}"></span>
        </span>
        <span class="text-std font-bold {status.running ? 'text-accent-700' : 'text-stone-600'}">
          {status.running ? `Recording ${status.intervalSec}s` : "Record Off"}
        </span>
      </button>

      <button onclick={refreshAll} disabled={loading} class="btn btn-secondary" title="Refresh">
        <RefreshCw class="w-3.5 h-3.5 {loading ? 'animate-spin' : ''}" />
        <span>Refresh</span>
      </button>

      <button onclick={clearData} class="btn btn-danger" title="Clear stored telemetry for this device">
        <Trash2 class="w-3.5 h-3.5" />
        <span>Clear</span>
      </button>
    </div>
  </div>

  <!-- Status line -->
  <div class="flex items-center gap-4 flex-wrap text-small font-mono text-stone-500 px-1">
    <span class="inline-flex items-center gap-1.5">
      <span class="w-1.5 h-1.5 rounded-full {status.running ? 'bg-emerald-500 animate-pulse' : 'bg-stone-400'}"></span>
      {status.running ? "Recording" : "Idle"}
    </span>
    <span>Last poll: {fmtTime(status.lastPollAt)}</span>
    <span>Stored samples: {status.totalSamples ?? 0}</span>
    {#if status.lastError}<span class="text-red-600">Last error: {status.lastError}</span>{/if}
  </div>

  {#if error}
    <div class="p-2 rounded bg-red-50 border border-red-200 text-std text-red-700">{error}</div>
  {/if}

  {#if !activeDevice}
    <div class="text-std text-stone-500 py-8 text-center">Select an ONT to view telemetry.</div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      {#each GROUPS as g (g.id)}
        <TelemetryChart title={g.title} unit={g.unit} series={groupSeries(g)} />
      {/each}
    </div>
  {/if}
</div>
