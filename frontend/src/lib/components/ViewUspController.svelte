<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { copyText } from "$lib/clipboard";
  import {
    RefreshCw,
    Search,
    Plus,
    Trash2,
    Send,
    CheckCircle2,
    AlertCircle,
    X,
    ChevronRight,
    ChevronDown,
    Copy,
    FileSpreadsheet,
    Terminal
  } from "lucide-svelte";
  import * as XLSX from "xlsx";
  import CustomSelect from "./CustomSelect.svelte";
  import TelemetryPanel from "./TelemetryPanel.svelte";
  import UspTemplates from "./UspTemplates.svelte";

  type Device = {
    id: string;
    topic: string;
    source: "auto" | "manual";
    firstSeenAt: number | null;
    lastSeenAt: number | null;
  };

  type ParamItem = {
    path: string;
    value: string;
  };

  type StagedParam = {
    path: string;
    originalValue: string;
    newValue: string;
  };

  type LogMessage = {
    id: string;
    timestamp: string;
    type: "info" | "success" | "error";
    message: string;
  };

  type ExecEntry = {
    id: number;
    ts: number;
    operator: string;
    op: string;
    device: string;
    target: string;
    params?: any;
    result: string;
    detail?: any;
    durationMs: number;
  };

  type RawMessage = {
    ts: number;
    direction: "tx" | "rx";
    agent: string;
    topic: string;
    msgId: string;
    msg: any;
  };

  let base = $state("");
  let activeTab = $state<"telemetry" | "template" | "params" | "objects" | "operate" | "logs" | "protocol">("telemetry");

  // Device & Health
  let health = $state<any>(null);
  let devices = $state<Device[]>([]);
  let activeDevice = $state("");
  let busy = $state(false);
  let lastError = $state<string | null>(null);

  // Parameters Explorer & Staging
  let queryPath = $state("Device.");
  let queryDepth = $state("0");
  let allParams = $state<ParamItem[]>([]);
  let paramSearch = $state("");
  let stagedParams = $state<StagedParam[]>([]);
  let isExecutingBatch = $state(false);
  let collapsedParents = $state<Set<string>>(new Set());
  let paramsLogs = $state<LogMessage[]>([]);

  // Object Manager
  let addObjPath = $state("Device.PPP.Interface.");
  let addAllowPartial = $state(true);
  let addParamRows = $state<{ name: string; val: string }[]>([
    { name: "Enable", val: "1" }
  ]);
  let delObjPath = $state("");
  let objectOutputFormat = $state<"xml" | "json">("xml");
  let objectLogs = $state<LogMessage[]>([]);
  let lastObjectExecution = $state<{
    action: "ADD" | "DELETE";
    status: string;
    target: string;
    rawResult: any;
  } | null>(null);

  // Operate Manager
  let operateCommand = $state("Device.Reboot()");
  let operateKey = $state("reboot-cmd-1");
  let operateArgs = $state<{ key: string; val: string }[]>([]);
  let operateLogs = $state<LogMessage[]>([]);
  let lastOperateResult = $state<any>(null);

  // Execution & Protocol Logs
  let execEntries = $state<ExecEntry[]>([]);
  let execFilter = $state("");
  let showExecDetail = $state<ExecEntry | null>(null);
  let rawMessages = $state<RawMessage[]>([]);
  let execPage = $state(0);
  const PAGE_SIZE = 50;

  // Live Mosquitto Broker Logs Split Pane
  let showLiveBrokerLog = $state(false);
  let brokerLogs = $state<string[]>([]);
  let brokerLogFilter = $state("");
  let autoScrollBrokerLog = $state(true);
  let brokerLogContainer = $state<HTMLDivElement | null>(null);
  let brokerLogTimer: any = null;
  let loadingBrokerLogs = $state(false);

  async function fetchBrokerLogs() {
    try {
      loadingBrokerLogs = true;
      const data = await api("/api/usp/broker-logs?limit=300");
      if (Array.isArray(data?.logs)) {
        brokerLogs = data.logs;
        if (autoScrollBrokerLog && brokerLogContainer) {
          setTimeout(() => {
            if (brokerLogContainer) {
              brokerLogContainer.scrollTop = brokerLogContainer.scrollHeight;
            }
          }, 50);
        }
      }
    } catch {} finally {
      loadingBrokerLogs = false;
    }
  }

  function toggleLiveBrokerLog() {
    showLiveBrokerLog = !showLiveBrokerLog;
    if (showLiveBrokerLog) {
      fetchBrokerLogs();
      if (!brokerLogTimer) {
        brokerLogTimer = setInterval(fetchBrokerLogs, 2000);
      }
    } else {
      if (brokerLogTimer) {
        clearInterval(brokerLogTimer);
        brokerLogTimer = null;
      }
    }
  }

  onDestroy(() => {
    if (brokerLogTimer) {
      clearInterval(brokerLogTimer);
      brokerLogTimer = null;
    }
  });

  let filteredBrokerLogs = $derived.by(() => {
    if (!brokerLogFilter.trim()) return brokerLogs;
    const q = brokerLogFilter.toLowerCase().trim();
    return brokerLogs.filter((l) => l.toLowerCase().includes(q));
  });

  function addLog(target: "params" | "objects" | "operate", type: "info" | "success" | "error", message: string) {
    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0] + "." + String(now.getMilliseconds()).padStart(3, "0");
    const entry: LogMessage = { id: String(Date.now()) + Math.random(), timestamp: timeStr, type, message };

    if (target === "params") {
      paramsLogs = [entry, ...paramsLogs.slice(0, 99)];
    } else if (target === "objects") {
      objectLogs = [entry, ...objectLogs.slice(0, 99)];
    } else {
      operateLogs = [entry, ...operateLogs.slice(0, 99)];
    }
  }

  async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(base + path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) }
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) throw new Error("HTTP " + res.status + ": " + (data?.error || res.statusText));
    return data as T;
  }

  async function refresh() {
    busy = true;
    lastError = null;
    try {
      health = await api("/api/usp/health").catch(() => null);
      const d = await api("/api/usp/devices");
      devices = d.devices ?? [];
      if (!activeDevice && devices[0]) activeDevice = devices[0].id;
      const e = await api("/api/usp/exec?limit=200");
      execEntries = e.entries ?? [];
      const m = await api("/api/usp/messages?limit=100");
      rawMessages = m.messages ?? [];
    } catch (e: any) {
      lastError = e.message;
    } finally {
      busy = false;
    }
  }

  async function executeGet() {
    if (!activeDevice) {
      lastError = "Select an active agent first";
      return;
    }
    if (!queryPath.trim()) return;
    busy = true;
    lastError = null;
    addLog("params", "info", `[START] Executing USP GET for "${queryPath.trim()}" (Depth: ${queryDepth}) on ${activeDevice}...`);

    try {
      const res = await api("/api/usp/" + encodeURIComponent(activeDevice) + "/get", {
        method: "POST",
        body: JSON.stringify({
          paths: [queryPath.trim()],
          maxDepth: parseInt(queryDepth, 10) || 0,
          timeout: 60
        })
      });

      const list: ParamItem[] = [];
      const resp = res?.result?.msg?.body?.response || res?.body?.response;
      const getResp = resp?.getResp || resp?.get_resp;
      const reqResults = getResp?.reqPathResults || getResp?.req_path_results || [];

      reqResults.forEach((r: any) => {
        const resolvedPaths = r.resolvedPathResults || r.resolved_path_results || [];
        resolvedPaths.forEach((resolved: any) => {
          const basePath = resolved.resolvedPath || resolved.resolved_path || r.requestedPath || r.requested_path || "";
          const params = resolved.resultParams || resolved.result_params || {};
          for (const [k, v] of Object.entries(params)) {
            list.push({ path: `${basePath}${k}`, value: String(v) });
          }
        });
      });

      allParams = list.sort((a, b) => a.path.localeCompare(b.path));

      const counts: Record<string, number> = {};
      allParams.forEach((p) => {
        const lastDot = p.path.lastIndexOf(".");
        const parent = lastDot !== -1 ? p.path.substring(0, lastDot + 1) : "Device.";
        counts[parent] = (counts[parent] || 0) + 1;
      });
      const newCollapsed = new Set<string>();
      Object.keys(counts).forEach((k) => {
        if (counts[k] >= 2) newCollapsed.add(k);
      });
      collapsedParents = newCollapsed;
      addLog("params", "success", `[GET OK] Loaded ${allParams.length} parameter(s).`);
      await refresh();
    } catch (e: any) {
      lastError = e.message;
      addLog("params", "error", `[GET FAILED] ${e.message}`);
    } finally {
      busy = false;
    }
  }

  function stageParam(item: ParamItem) {
    if (!stagedParams.some((p) => p.path === item.path)) {
      stagedParams = [...stagedParams, { path: item.path, originalValue: item.value, newValue: item.value }];
      addLog("params", "info", `[STAGE ADD] Queued "${item.path}" (Current: "${item.value}")`);
    }
  }

  function unstageParam(path: string) {
    stagedParams = stagedParams.filter((p) => p.path !== path);
    addLog("params", "info", `[STAGE REMOVE] Unqueued "${path}"`);
  }

  function clearStaged() {
    stagedParams = [];
    addLog("params", "info", `[STAGE CLEAR] Queue cleared.`);
  }

  async function executeBatchSet() {
    if (!activeDevice || stagedParams.length === 0) return;
    isExecutingBatch = true;
    lastError = null;

    const riskyLowerLayers = stagedParams.filter((item) => {
      const name = item.path.substring(item.path.lastIndexOf(".") + 1);
      return (
        name === "LowerLayers" &&
        item.originalValue.includes("Bridging.") &&
        !item.newValue.includes("Bridging.")
      );
    });
    if (riskyLowerLayers.length > 0) {
      const detail = riskyLowerLayers
        .map((r) => `- ${r.path}\n    ${r.originalValue || "(empty)"}  ->  ${r.newValue}`)
        .join("\n");
      const proceed = window.confirm(
        `WARNING: ${riskyLowerLayers.length} LowerLayers parameter(s) appear bound to the LAN bridge.\n` +
          `Changing them can cut off LAN/ONT management (the Ethernet.Link.1 / br0 case).\n\n` +
          `${detail}\n\nProceed with the Batch SET?`
      );
      if (!proceed) {
        addLog("params", "info", "[ABORTED] Batch SET cancelled by operator (LowerLayers LAN bridge guard).");
        isExecutingBatch = false;
        return;
      }
      addLog("params", "info", "[GUARD] Operator confirmed the risky LowerLayers change.");
    }

    addLog("params", "info", `[START] Initiating Batch SET for ${stagedParams.length} parameter(s)...`);

    const grouped: Record<string, Array<{ name: string; value: string; required: boolean }>> = {};
    stagedParams.forEach((item) => {
      const lastDot = item.path.lastIndexOf(".");
      const parentPath = lastDot !== -1 ? item.path.substring(0, lastDot + 1) : item.path;
      const paramName = lastDot !== -1 ? item.path.substring(lastDot + 1) : "";
      if (!grouped[parentPath]) grouped[parentPath] = [];
      grouped[parentPath].push({ name: paramName, value: item.newValue, required: false });
    });

    const updates = Object.keys(grouped).map((objPath) => ({
      objPath,
      params: grouped[objPath]
    }));

    try {
      const res = await api("/api/usp/" + encodeURIComponent(activeDevice) + "/set", {
        method: "POST",
        body: JSON.stringify({ updates, allowPartial: true })
      });

      const summary = res?.summary || {};
      if (summary.status === "REJECTED") {
        addLog("params", "error", `[SET REJECTED] Code ${summary.errorCode}: ${summary.errorMsg}`);
      } else {
        if (Array.isArray(summary.updatedParams)) {
          summary.updatedParams.forEach((up: any) => {
            addLog("params", "success", `[PARAM OK] ${up.path} = "${up.value}"`);
            const target = allParams.find((p) => p.path === up.path);
            if (target) target.value = up.value;
          });
        } else {
          stagedParams.forEach((sp) => {
            addLog("params", "success", `[PARAM OK] ${sp.path} = "${sp.newValue}"`);
            const target = allParams.find((p) => p.path === sp.path);
            if (target) target.value = sp.newValue;
          });
        }

        if (Array.isArray(summary.paramErrors)) {
          summary.paramErrors.forEach((pe: any) => {
            addLog("params", "error", `[PARAM FAILED] ${pe.path} => Code ${pe.errCode}: ${pe.errMsg}`);
          });
        }
        addLog("params", summary.failCount > 0 ? "error" : "success", `[SUMMARY] Batch SET Finished: ${summary.successCount ?? stagedParams.length} ok, ${summary.failCount ?? 0} err`);
      }

      await refresh();
    } catch (e: any) {
      lastError = e.message;
      addLog("params", "error", `[EXCEPTION] Batch SET Failed: ${e.message}`);
    } finally {
      isExecutingBatch = false;
    }
  }

  async function dispatchAddObject() {
    if (!activeDevice || !addObjPath.trim()) return;
    busy = true;
    lastError = null;
    const params = addParamRows
      .filter((r) => r.name.trim() !== "")
      .map((r) => ({ name: r.name.trim(), value: r.val, required: false }));

    addLog("objects", "info", `[START] Initiating USP ADD for "${addObjPath.trim()}"...`);
    params.forEach((p) => {
      addLog("objects", "info", `[PARAM QUEUE] Setting: ${p.name} = "${p.value}"`);
    });

    try {
      const res = await api("/api/usp/" + encodeURIComponent(activeDevice) + "/add", {
        method: "POST",
        body: JSON.stringify({
          createObjs: [{ objPath: addObjPath.trim(), params }],
          allowPartial: addAllowPartial
        })
      });

      const summary = res?.summary || {};
      if (summary.status === "REJECTED") {
        addLog("objects", "error", `[ADD REJECTED] Code ${summary.errorCode}: ${summary.errorMsg}`);
      } else {
        (summary.createdInstances || []).forEach((inst: string) => {
          addLog("objects", "success", `[INSTANCE CREATED] ${inst}`);
        });
        (summary.paramErrors || []).forEach((pe: any) => {
          addLog("objects", "error", `[PARAM FAILED] ${pe.param} => Code ${pe.errCode}: ${pe.errMsg}`);
        });
        addLog("objects", "success", `[COMPLETED] Object ADD response processed.`);
      }

      lastObjectExecution = {
        action: "ADD",
        status: res?.ok ? "SUCCESS" : "FAILED",
        target: addObjPath.trim(),
        rawResult: res
      };
      await refresh();
    } catch (e: any) {
      lastError = e.message;
      addLog("objects", "error", `[EXCEPTION] USP ADD Failed: ${e.message}`);
    } finally {
      busy = false;
    }
  }

  async function dispatchDeleteObject() {
    if (!activeDevice || !delObjPath.trim()) return;
    busy = true;
    lastError = null;
    addLog("objects", "info", `[START] Initiating USP DELETE for "${delObjPath.trim()}"...`);

    try {
      const res = await api("/api/usp/" + encodeURIComponent(activeDevice) + "/delete", {
        method: "POST",
        body: JSON.stringify({
          objPaths: [delObjPath.trim()],
          allowPartial: true
        })
      });

      const summary = res?.summary || {};
      if (summary.status === "REJECTED") {
        addLog("objects", "error", `[DELETE REJECTED] Code ${summary.errorCode}: ${summary.errorMsg}`);
      } else {
        (summary.deletedPaths || [delObjPath.trim()]).forEach((p: string) => {
          addLog("objects", "success", `[DELETE OK] Deleted instance: ${p}`);
        });
        (summary.unaffectedErrors || []).forEach((ue: any) => {
          addLog("objects", "error", `[DELETE ERR] ${ue.unaffectedPath} => Code ${ue.errCode}: ${ue.errMsg}`);
        });
      }

      lastObjectExecution = {
        action: "DELETE",
        status: res?.ok ? "SUCCESS" : "FAILED",
        target: delObjPath.trim(),
        rawResult: res
      };
      await refresh();
    } catch (e: any) {
      lastError = e.message;
      addLog("objects", "error", `[EXCEPTION] USP DELETE Failed: ${e.message}`);
    } finally {
      busy = false;
    }
  }

  async function dispatchOperate() {
    if (!activeDevice || !operateCommand.trim()) return;
    busy = true;
    lastError = null;
    addLog("operate", "info", `[START] Initiating USP OPERATE "${operateCommand.trim()}"...`);

    const inputArgs: Record<string, string> = {};
    operateArgs.forEach((a) => {
      if (a.key.trim()) inputArgs[a.key.trim()] = a.val;
    });

    try {
      const res = await api("/api/usp/" + encodeURIComponent(activeDevice) + "/operate", {
        method: "POST",
        body: JSON.stringify({
          command: operateCommand.trim(),
          commandKey: operateKey.trim(),
          sendResp: true,
          inputArgs
        })
      });

      lastOperateResult = res;
      if (res?.ok) {
        addLog("operate", "success", `[OPERATE OK] Command ${operateCommand.trim()} executed.`);
      } else {
        addLog("operate", "error", `[OPERATE FAILED] ${res?.error || "Failed"}`);
      }
      await refresh();
    } catch (e: any) {
      lastError = e.message;
      addLog("operate", "error", `[EXCEPTION] USP OPERATE Failed: ${e.message}`);
    } finally {
      busy = false;
    }
  }

  function escapeXml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function jsonToXml(value: any, tag: string, indent: string): string {
    const safeTag = (tag.match(/^[A-Za-z_]/) ? tag : `_${tag}`).replace(/[^A-Za-z0-9_.-]/g, "_");
    if (value === null || value === undefined) return `${indent}<${safeTag}/>`;
    if (Array.isArray(value)) {
      if (value.length === 0) return `${indent}<${safeTag}/>`;
      return value.map((item) => jsonToXml(item, safeTag, indent)).join("\n");
    }
    if (typeof value === "object") {
      const inner = Object.entries(value)
        .map(([k, v]) => jsonToXml(v, k, indent + "  "))
        .join("\n");
      return `${indent}<${safeTag}>\n${inner}\n${indent}</${safeTag}>`;
    }
    return `${indent}<${safeTag}>${escapeXml(String(value))}</${safeTag}>`;
  }

  function generateObjectXml(exec: typeof lastObjectExecution): string {
    if (!exec) return "<!-- Ready -->";
    const payload = (exec.rawResult as any)?.result ?? exec.rawResult ?? null;
    if (!payload) return "<!-- No response payload -->";
    return `<?xml version="1.0" encoding="UTF-8"?>\n` + jsonToXml(payload, "usp-response", "");
  }

  function toggleGroup(parent: string) {
    const next = new Set(collapsedParents);
    if (next.has(parent)) next.delete(parent);
    else next.add(parent);
    collapsedParents = next;
  }

  function exportParametersExcel() {
    if (allParams.length === 0) {
      alert("No parameters to export.");
      return;
    }
    const rows = allParams.map((p, idx) => {
      const lastDot = p.path.lastIndexOf(".");
      const parent = lastDot !== -1 ? p.path.substring(0, lastDot + 1) : "Device.";
      const name = lastDot !== -1 ? p.path.substring(lastDot + 1) : p.path;
      return {
        No: idx + 1,
        "Parameter Path": p.path,
        "Parent Object": parent,
        "Parameter Name": name,
        "Current Value": p.value
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "TR-181 Parameters");
    const agent = (activeDevice || "ONT").replace(/[^a-zA-Z0-9_-]/g, "_");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    XLSX.writeFile(wb, `USP_Parameters_${agent}_${ts}.xlsx`);
  }

  function exportLogsExcel() {
    if (execEntries.length === 0) {
      alert("No execution logs to export.");
      return;
    }
    const rows = execEntries.map((e) => ({
      ID: e.id,
      Timestamp: new Date(e.ts).toISOString(),
      Operator: e.operator,
      Operation: e.op.toUpperCase(),
      Device: e.device,
      "Target Path": e.target || "—",
      Result: e.result.toUpperCase(),
      "Duration (ms)": e.durationMs,
      Payload: JSON.stringify(e.params || {}),
      Response: JSON.stringify(e.detail || {})
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "USP Execution Logs");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    XLSX.writeFile(wb, `USP_Logs_${ts}.xlsx`);
  }

  let filteredParams = $derived.by(() => {
    if (!paramSearch.trim()) return allParams;
    const q = paramSearch.toLowerCase().trim();
    return allParams.filter((p) => p.path.toLowerCase().includes(q) || p.value.toLowerCase().includes(q));
  });

  let groupedParams = $derived.by(() => {
    const groups: { parent: string; items: ParamItem[]; isMulti: boolean }[] = [];
    const map = new Map<string, ParamItem[]>();

    filteredParams.forEach((item) => {
      const lastDot = item.path.lastIndexOf(".");
      const parent = lastDot !== -1 ? item.path.substring(0, lastDot + 1) : "Device.";
      if (!map.has(parent)) map.set(parent, []);
      map.get(parent)!.push(item);
    });

    map.forEach((items, parent) => {
      groups.push({ parent, items, isMulti: items.length >= 2 });
    });
    return groups;
  });

  let filteredExec = $derived(
    execFilter
      ? execEntries.filter(
          (e) =>
            e.op.includes(execFilter) ||
            e.device.includes(execFilter) ||
            e.target.includes(execFilter) ||
            e.operator.includes(execFilter) ||
            e.result.includes(execFilter)
        )
      : execEntries
  );

  let pagedExec = $derived(
    filteredExec.slice().reverse().slice(execPage * PAGE_SIZE, (execPage + 1) * PAGE_SIZE)
  );

  const depthOptions = [
    { value: "9999", label: "Full Subtree (Unlimited)" },
    { value: "1", label: "Depth 1 (Immediate Children)" },
    { value: "2", label: "Depth 2" }
  ];

  let deviceOptions = $derived(
    devices.map((d) => ({
      value: d.id,
      label: d.id
    }))
  );

  onMount(refresh);
</script>

<div class="{showLiveBrokerLog ? 'flex flex-col h-full gap-4' : 'space-y-6'}">
  <!-- Top Bar -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <h2 class="text-large font-bold text-black">USP Controller</h2>

    <div class="flex items-center gap-2 flex-wrap">
      <CustomSelect
        bind:value={activeDevice}
        options={deviceOptions}
        label="Agent:"
        placeholder="Select ONT"
        className="w-64"
      />

      <button
        onclick={refresh}
        disabled={busy}
        class="btn btn-secondary"
      >
        <RefreshCw class="w-3.5 h-3.5 {busy ? 'animate-spin' : ''}" />
        <span>Refresh</span>
      </button>

      <button
        onclick={toggleLiveBrokerLog}
        class="btn {showLiveBrokerLog ? 'btn-primary' : 'btn-secondary'}"
        title="Toggle live broker log panel"
      >
        <Terminal class="w-3.5 h-3.5 {showLiveBrokerLog ? 'text-accent-400' : 'text-stone-600'}" />
        <span>Broker Log</span>
        {#if showLiveBrokerLog}
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5"></span>
        {/if}
      </button>
    </div>
  </div>

  {#if lastError}
    <div class="p-3 bg-red-50 border border-red-200 rounded-md text-std text-red-800 flex items-start justify-between gap-2 font-mono">
      <div class="flex items-center gap-2">
        <AlertCircle class="w-4 h-4 text-red-600 shrink-0" />
        <span>{lastError}</span>
      </div>
      <button onclick={() => (lastError = null)} class="btn-icon text-red-600 hover:text-red-800">
        <X class="w-3.5 h-3.5" />
      </button>
    </div>
  {/if}

  <div class="{showLiveBrokerLog ? 'grid grid-cols-1 lg:grid-cols-4 gap-4 flex-1 min-h-0' : 'space-y-6'}">
    <!-- Main Content Area -->
    <div class="{showLiveBrokerLog ? 'lg:col-span-3 min-w-0 space-y-6 overflow-y-auto pr-1' : 'space-y-6 min-w-0'}">
      <!-- Sub-tabs Navigation (Clean, No Icon Fluff) -->
      <div class="flex items-center space-x-2 border-b border-cream-300 pb-2">
    <button
      onclick={() => (activeTab = "telemetry")}
      class="tab-pill {activeTab === 'telemetry' ? 'tab-pill-active' : ''}"
    >
      Telemetry
    </button>

    <button
      onclick={() => (activeTab = "template")}
      class="tab-pill {activeTab === 'template' ? 'tab-pill-active' : ''}"
    >
      Template
    </button>

    <button
      onclick={() => (activeTab = "params")}
      class="tab-pill {activeTab === 'params' ? 'tab-pill-active' : ''}"
    >
      Parameters
    </button>

    <button
      onclick={() => (activeTab = "objects")}
      class="tab-pill {activeTab === 'objects' ? 'tab-pill-active' : ''}"
    >
      Objects
    </button>

    <button
      onclick={() => (activeTab = "operate")}
      class="tab-pill {activeTab === 'operate' ? 'tab-pill-active' : ''}"
    >
      Operate
    </button>

    <button
      onclick={() => (activeTab = "logs")}
      class="tab-pill {activeTab === 'logs' ? 'tab-pill-active' : ''}"
    >
      <span>Logs</span>
      {#if execEntries.length > 0}
        <span class="px-1.5 py-0.2 rounded-full text-small {activeTab === 'logs' ? 'bg-accent-600 text-white' : 'bg-cream-200 text-stone-700'}">
          {execEntries.length}
        </span>
      {/if}
    </button>

    <button
      onclick={() => (activeTab = "protocol")}
      class="tab-pill {activeTab === 'protocol' ? 'tab-pill-active' : ''}"
    >
      Protocol
    </button>
  </div>

  <!-- TAB 0: TELEMETRY -->
  {#if activeTab === "telemetry"}
    <TelemetryPanel {devices} bind:activeDevice />
  {/if}

  <!-- TAB: TEMPLATE -->
  {#if activeTab === "template"}
    <UspTemplates {devices} bind:activeDevice />
  {/if}

  <!-- TAB 1: PARAMETERS -->
  {#if activeTab === "params"}
    <div class="space-y-6">
      <!-- Query Control Bar -->
      <div class="border border-cream-300 rounded-lg bg-white p-4 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-std font-bold text-black">Query TR-181 Parameters</span>
          <div class="flex items-center gap-1.5">
            <button onclick={() => { queryPath = "Device."; executeGet(); }} class="btn btn-secondary">Device.</button>
            <button onclick={() => { queryPath = "Device.DeviceInfo."; executeGet(); }} class="btn btn-secondary">DeviceInfo.</button>
            <button onclick={() => { queryPath = "Device.PPP.Interface."; executeGet(); }} class="btn btn-secondary">PPP.</button>
            <button onclick={() => { queryPath = "Device.IP.Interface."; executeGet(); }} class="btn btn-secondary">IP.</button>
            <button onclick={() => { queryPath = "Device.WiFi.Radio."; executeGet(); }} class="btn btn-secondary">WiFi.</button>
          </div>
        </div>

        <div class="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            bind:value={queryPath}
            placeholder="e.g. Device. or Device.DeviceInfo."
            class="flex-1 px-3 py-2 text-std bg-white border border-cream-300 focus:border-accent-600 outline-none rounded-md font-mono"
          />
          <div class="flex items-center space-x-2">
            <CustomSelect
              bind:value={queryDepth}
              options={depthOptions}
              placeholder="Select Depth"
            />
            <button
              onclick={executeGet}
              disabled={busy || !activeDevice}
              class="btn btn-primary"
            >
              Query ONT
            </button>
          </div>
        </div>
      </div>

      <!-- Split Table & Batch Modify Staging -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <!-- Parameters Table (Left) -->
        <div class="lg:col-span-8 border border-cream-300 bg-white rounded-lg overflow-hidden flex flex-col space-y-0">
          <div class="p-3 bg-cream-100 border-b border-cream-300 flex items-center justify-between gap-3">
            <div class="flex items-center space-x-2">
              <span class="text-std font-bold text-black">Parameters</span>
              <span class="px-2 py-0.5 rounded-full text-small font-bold bg-cream-200 text-stone-700 font-mono">
                {allParams.length}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <button
                onclick={exportParametersExcel}
                disabled={allParams.length === 0}
                class="btn btn-outline"
                title="Export parameters to Excel spreadsheet"
              >
                <FileSpreadsheet class="w-3.5 h-3.5" />
                <span>Export Excel</span>
              </button>
              <div class="relative">
                <Search class="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  type="text"
                  bind:value={paramSearch}
                  placeholder="Search parameter..."
                  class="w-48 pl-7 pr-2.5 py-1 text-std bg-white border border-cream-300 focus:border-accent-600 outline-none rounded-md font-mono"
                />
              </div>
            </div>
          </div>

          <div class="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table class="w-full text-left text-std">
              <thead class="bg-cream-50 border-b border-cream-200 text-stone-600 text-small font-semibold sticky top-0 z-10">
                <tr>
                  <th class="py-2.5 px-3">Parameter Path</th>
                  <th class="py-2.5 px-3">Current Value</th>
                  <th class="py-2.5 px-3 text-right">Stage</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-cream-200 font-mono text-std">
                {#if filteredParams.length === 0}
                  <tr>
                    <td colspan="3" class="py-12 text-center text-stone-400 font-sans italic">
                      No parameters loaded. Click "Query ONT" to fetch data model.
                    </td>
                  </tr>
                {:else}
                  {#each groupedParams as group}
                    {#if group.isMulti}
                      <tr
                        onclick={() => toggleGroup(group.parent)}
                        class="bg-cream-100/60 hover:bg-cream-100 cursor-pointer select-none transition border-y border-cream-300"
                      >
                        <td colspan="3" class="py-1.5 px-3 font-bold text-std text-stone-900">
                          <div class="flex items-center justify-between">
                            <div class="flex items-center space-x-1.5">
                              {#if collapsedParents.has(group.parent)}
                                <ChevronRight class="w-3.5 h-3.5 text-stone-500" />
                              {:else}
                                <ChevronDown class="w-3.5 h-3.5 text-stone-500" />
                              {/if}
                              <span class="text-black">{group.parent}</span>
                              <span class="px-1.5 py-0.2 rounded text-small font-bold bg-cream-200 text-stone-600">
                                {group.items.length}
                              </span>
                            </div>
                            <span class="text-small text-stone-400 font-sans font-normal">
                              {collapsedParents.has(group.parent) ? 'Expand' : 'Collapse'}
                            </span>
                          </div>
                        </td>
                      </tr>
                    {/if}

                    {#if !group.isMulti || !collapsedParents.has(group.parent)}
                      {#each group.items as item}
                        {@const isStaged = stagedParams.some((p) => p.path === item.path)}
                        <tr class="hover:bg-cream-50 transition {isStaged ? 'bg-accent-50/50' : ''}">
                          <td class="py-2 px-3 text-stone-900 break-all font-medium {group.isMulti ? 'pl-6' : ''}">
                            {#if group.isMulti}
                              <span class="text-stone-400 mr-1 select-none">└</span>
                              <span class="text-black font-semibold">{item.path.substring(group.parent.length)}</span>
                            {:else}
                              {item.path}
                            {/if}
                          </td>
                          <td class="py-2 px-3 text-stone-700">
                            <span class="px-1.5 py-0.5 bg-cream-50 border border-cream-300 rounded block truncate max-w-xs" title={item.value}>
                              {item.value || '(empty)'}
                            </span>
                          </td>
                          <td class="py-2 px-3 text-right">
                            <button
                              type="button"
                              onclick={() => stageParam(item)}
                              title={isStaged ? "Staged" : "Stage for batch edit"}
                              class="p-1 border rounded-md transition {isStaged ? 'bg-black text-white border-black' : 'border-cream-300 hover:border-black text-black'}"
                            >
                              {#if isStaged}
                                <CheckCircle2 class="w-3.5 h-3.5 text-accent-400" />
                              {:else}
                                <Plus class="w-3.5 h-3.5" />
                              {/if}
                            </button>
                          </td>
                        </tr>
                      {/each}
                    {/if}
                  {/each}
                {/if}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Staged Batch Modifier (Right) -->
        <div class="lg:col-span-4 border border-cream-300 bg-white rounded-lg overflow-hidden flex flex-col space-y-0">
          <div class="p-3 bg-cream-100 border-b border-cream-300 flex items-center justify-between">
            <div class="flex items-center space-x-2">
              <span class="text-std font-bold text-black">Batch Staged Queue</span>
              <span class="px-2 py-0.5 rounded-full text-small font-bold bg-black text-white font-mono">
                {stagedParams.length}
              </span>
            </div>
            {#if stagedParams.length > 0}
              <button onclick={clearStaged} class="text-std text-stone-500 hover:text-red-700 font-semibold">
                Clear
              </button>
            {/if}
          </div>

          <div class="p-3 flex-1 overflow-y-auto max-h-[420px] space-y-3 bg-cream-50/30">
            {#if stagedParams.length === 0}
              <div class="py-16 text-center text-stone-400 space-y-1">
                <p class="text-std font-bold text-stone-600">No parameters staged</p>
                <p class="text-small text-stone-400 max-w-[200px] mx-auto">Click the (+) icon on any parameter row to stage it for batch modification.</p>
              </div>
            {:else}
              {#each stagedParams as item}
                <div class="bg-white border border-cream-300 rounded-lg p-2.5 space-y-2">
                  <div class="flex items-start justify-between gap-1">
                    <span class="text-small font-mono font-bold text-black break-all">{item.path}</span>
                    <button onclick={() => unstageParam(item.path)} class="text-stone-400 hover:text-red-600 p-0.5">
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div>
                    <label class="block text-small font-bold text-stone-500 mb-0.5">New Value</label>
                    <input
                      type="text"
                      bind:value={item.newValue}
                      class="w-full px-2 py-1 text-std bg-cream-50 border border-cream-300 focus:border-accent-600 outline-none rounded-md font-mono font-bold text-black"
                    />
                  </div>
                </div>
              {/each}
            {/if}
          </div>

          <div class="p-3 border-t border-cream-300 bg-white">
            <button
              onclick={executeBatchSet}
              disabled={stagedParams.length === 0 || isExecutingBatch}
              class="w-full py-2 bg-black text-white hover:bg-accent-600 font-semibold text-std rounded-md transition disabled:opacity-50 flex items-center justify-center space-x-1.5"
            >
              {#if isExecutingBatch}
                <RefreshCw class="w-3.5 h-3.5 animate-spin" />
                <span>Executing Batch SET...</span>
              {:else}
                <span>Execute Batch ({stagedParams.length} Parameters)</span>
              {/if}
            </button>
          </div>
        </div>
      </div>

      <!-- On-Page Execution Terminal Console for Parameters -->
      <div class="border border-cream-300 bg-white rounded-lg overflow-hidden space-y-0">
        <div class="p-3 bg-cream-100 border-b border-cream-300 flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <span class="text-std font-bold text-black">Parameters Execution Log</span>
            <span class="px-1.5 py-0.2 rounded text-small font-bold bg-cream-200 text-stone-700">{paramsLogs.length} events</span>
          </div>
          {#if paramsLogs.length > 0}
            <button onclick={() => (paramsLogs = [])} class="text-small text-stone-500 hover:text-black font-semibold">Clear</button>
          {/if}
        </div>
        <div class="p-3 bg-stone-950 text-stone-200 font-mono text-std max-h-48 overflow-y-auto space-y-1 leading-relaxed">
          {#if paramsLogs.length === 0}
            <div class="text-stone-500 italic py-2">Ready. Click "Query ONT" or "Execute Batch" to view execution trace.</div>
          {:else}
            {#each paramsLogs as log}
              <div class="flex items-start space-x-2">
                <span class="text-stone-500 shrink-0">[{log.timestamp}]</span>
                <span class="shrink-0 font-bold {log.type === 'success' ? 'text-emerald-400' : log.type === 'error' ? 'text-rose-400' : 'text-cyan-400'}">
                  [{log.type.toUpperCase()}]
                </span>
                <span class="text-stone-200 break-all">{log.message}</span>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- TAB 2: OBJECTS -->
  {#if activeTab === "objects"}
    <div class="space-y-6">
      <!-- Create Section -->
      <div class="border border-cream-300 bg-white rounded-lg overflow-hidden space-y-0">
        <div class="p-3 bg-cream-100 border-b border-cream-300 flex items-center justify-between">
          <h3 class="text-std font-bold text-black">
            Add Multi-Instance Object
          </h3>
          <span class="text-small font-mono text-stone-500">Header.ADD</span>
        </div>

        <div class="p-4 space-y-4">
          <div>
            <label class="block text-small font-bold text-stone-500 mb-1">Parent Object Path</label>
            <input
              type="text"
              bind:value={addObjPath}
              placeholder="e.g. Device.PPP.Interface. or Device.WiFi.SSID."
              class="w-full px-3 py-2 text-std bg-white border border-cream-300 focus:border-accent-600 outline-none rounded-md font-mono font-bold text-black"
            />
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-std font-bold text-black">Initial Parameter Values</span>
              <button
                type="button"
                onclick={() => (addParamRows = [...addParamRows, { name: "", val: "" }])}
                class="btn btn-secondary"
              >
                <Plus class="w-3 h-3" />
                <span>Add Row</span>
              </button>
            </div>

            <div class="border border-cream-300 rounded-md overflow-hidden">
              <table class="w-full text-left text-std font-mono">
                <thead class="bg-cream-50 border-b border-cream-300 text-stone-600 text-small">
                  <tr>
                    <th class="py-2 px-3 w-1/2">Parameter Name</th>
                    <th class="py-2 px-3 w-1/2">Value</th>
                    <th class="py-2 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-cream-200">
                  {#each addParamRows as row, i}
                    <tr>
                      <td class="p-2">
                        <input type="text" bind:value={row.name} placeholder="e.g. Enable" class="w-full px-2 py-1 text-std bg-cream-50 border border-cream-300 rounded-md font-mono" />
                      </td>
                      <td class="p-2">
                        <input type="text" bind:value={row.val} placeholder="e.g. 1" class="w-full px-2 py-1 text-std bg-cream-50 border border-cream-300 rounded-md font-mono" />
                      </td>
                      <td class="p-2 text-right">
                        <button type="button" onclick={() => (addParamRows = addParamRows.filter((_, idx) => idx !== i))} class="text-red-600 hover:text-red-800 text-std font-semibold">
                          Delete
                        </button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>

          <div class="flex items-center justify-between pt-2 border-t border-cream-200">
            <label class="flex items-center space-x-2 text-std text-stone-600 cursor-pointer">
              <input type="checkbox" bind:checked={addAllowPartial} class="accent-black" />
              <span>Allow Partial Creation</span>
            </label>

            <button
              onclick={dispatchAddObject}
              disabled={busy || !activeDevice}
              class="btn btn-primary"
            >
              Send USP ADD
            </button>
          </div>
        </div>
      </div>

      <!-- Delete Section -->
      <div class="border border-cream-300 bg-white rounded-lg overflow-hidden space-y-0">
        <div class="p-3 bg-cream-100 border-b border-cream-300 flex items-center justify-between">
          <h3 class="text-std font-bold text-black">
            Delete Object Instance
          </h3>
          <span class="text-small font-mono text-stone-500">Header.DELETE</span>
        </div>

        <div class="p-4 space-y-3">
          <label class="block text-small font-bold text-stone-500 mb-1">Target Instance Path (e.g. Device.PPP.Interface.2.)</label>
          <div class="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              bind:value={delObjPath}
              placeholder="e.g. Device.PPP.Interface.2."
              class="flex-1 px-3 py-2 text-std bg-white border border-cream-300 focus:border-accent-600 outline-none rounded-md font-mono font-bold text-black"
            />
            <button
              onclick={dispatchDeleteObject}
              disabled={busy || !activeDevice}
              class="btn btn-danger"
            >
              Send USP DELETE
            </button>
          </div>
        </div>
      </div>

      <!-- Result Section (XML & JSON) -->
      {#if lastObjectExecution}
        <div class="border border-cream-300 bg-white rounded-lg overflow-hidden space-y-0">
          <div class="p-3 bg-cream-100 border-b border-cream-300 flex items-center justify-between">
            <div class="flex items-center space-x-2">
              <span class="text-std font-bold text-black">Execution Output</span>
              <span class="px-2 py-0.5 rounded text-small font-bold font-mono {lastObjectExecution.status === 'SUCCESS' ? 'bg-black text-white' : 'bg-red-50 text-red-800 border border-red-200'}">
                {lastObjectExecution.action} {lastObjectExecution.status}
              </span>
            </div>

            <div class="flex items-center space-x-2">
              <div class="flex rounded-md border border-cream-300 p-0.5 bg-white text-std">
                <button
                  onclick={() => (objectOutputFormat = "xml")}
                  class="px-2 py-0.5 rounded font-semibold {objectOutputFormat === 'xml' ? 'bg-black text-white' : 'text-stone-600'}"
                >
                  XML
                </button>
                <button
                  onclick={() => (objectOutputFormat = "json")}
                  class="px-2 py-0.5 rounded font-semibold {objectOutputFormat === 'json' ? 'bg-black text-white' : 'text-stone-600'}"
                >
                  JSON
                </button>
              </div>

              <button
                onclick={() => copyText(objectOutputFormat === 'xml' ? generateObjectXml(lastObjectExecution) : JSON.stringify(lastObjectExecution?.rawResult, null, 2))}
                class="btn btn-outline"
              >
                <Copy class="w-3 h-3" />
                <span>Copy</span>
              </button>
            </div>
          </div>

          <pre class="p-4 bg-cream-50 font-mono text-std text-black max-h-64 overflow-auto select-all leading-relaxed">{objectOutputFormat === 'xml' ? generateObjectXml(lastObjectExecution) : JSON.stringify(lastObjectExecution?.rawResult, null, 2)}</pre>
        </div>
      {/if}

      <!-- On-Page Execution Terminal Console for Objects -->
      <div class="border border-cream-300 bg-white rounded-lg overflow-hidden space-y-0">
        <div class="p-3 bg-cream-100 border-b border-cream-300 flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <span class="text-std font-bold text-black">Object Execution Log</span>
            <span class="px-1.5 py-0.2 rounded text-small font-bold bg-cream-200 text-stone-700">{objectLogs.length} events</span>
          </div>
          {#if objectLogs.length > 0}
            <button onclick={() => (objectLogs = [])} class="text-small text-stone-500 hover:text-black font-semibold">Clear</button>
          {/if}
        </div>
        <div class="p-3 bg-stone-950 text-stone-200 font-mono text-std max-h-48 overflow-y-auto space-y-1 leading-relaxed">
          {#if objectLogs.length === 0}
            <div class="text-stone-500 italic py-2">Ready. Click "Send USP ADD" or "Send USP DELETE" to view transaction logs.</div>
          {:else}
            {#each objectLogs as log}
              <div class="flex items-start space-x-2">
                <span class="text-stone-500 shrink-0">[{log.timestamp}]</span>
                <span class="shrink-0 font-bold {log.type === 'success' ? 'text-emerald-400' : log.type === 'error' ? 'text-rose-400' : 'text-cyan-400'}">
                  [{log.type.toUpperCase()}]
                </span>
                <span class="text-stone-200 break-all">{log.message}</span>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- TAB 3: OPERATE -->
  {#if activeTab === "operate"}
    <div class="space-y-6">
      <div class="border border-cream-300 bg-white rounded-lg overflow-hidden space-y-0">
        <div class="p-3 bg-cream-100 border-b border-cream-300 flex items-center justify-between">
          <h3 class="text-std font-bold text-black">
            Execute USP Command
          </h3>
          <span class="text-small font-mono text-stone-500">Header.OPERATE</span>
        </div>

        <div class="p-4 space-y-4">
          <div class="flex flex-wrap gap-2 pb-1">
            <span class="text-small font-bold text-stone-500 block w-full">Command Presets</span>
            <button onclick={() => { operateCommand = "Device.Reboot()"; operateKey = "reboot-1"; }} class="btn btn-secondary">Device.Reboot()</button>
            <button onclick={() => { operateCommand = "Device.FactoryReset()"; operateKey = "reset-1"; }} class="btn btn-secondary">Device.FactoryReset()</button>
            <button onclick={() => { operateCommand = "Device.IP.Diagnostics.IPPing()"; operateKey = "ping-1"; }} class="btn btn-secondary">Device.IP.Diagnostics.IPPing()</button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-small font-bold text-stone-500 mb-1">Command Path</label>
              <input
                type="text"
                bind:value={operateCommand}
                placeholder="e.g. Device.Reboot()"
                class="w-full px-3 py-2 text-std bg-white border border-cream-300 focus:border-accent-600 outline-none rounded-md font-mono font-bold text-black"
              />
            </div>
            <div>
              <label class="block text-small font-bold text-stone-500 mb-1">Command Key</label>
              <input
                type="text"
                bind:value={operateKey}
                placeholder="e.g. cmd-key-1"
                class="w-full px-3 py-2 text-std bg-white border border-cream-300 focus:border-accent-600 outline-none rounded-md font-mono font-bold text-black"
              />
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-std font-bold text-black">Input Arguments (Optional)</span>
              <button
                type="button"
                onclick={() => (operateArgs = [...operateArgs, { key: "", val: "" }])}
                class="btn btn-secondary"
              >
                <Plus class="w-3 h-3" />
                <span>Add Argument</span>
              </button>
            </div>

            {#if operateArgs.length > 0}
              <div class="border border-cream-300 rounded-md overflow-hidden">
                <table class="w-full text-left text-std font-mono">
                  <thead class="bg-cream-50 border-b border-cream-300 text-stone-600 text-small">
                    <tr>
                      <th class="py-2 px-3 w-1/2">Argument Key</th>
                      <th class="py-2 px-3 w-1/2">Value</th>
                      <th class="py-2 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-cream-200">
                    {#each operateArgs as arg, i}
                      <tr>
                        <td class="p-2">
                          <input type="text" bind:value={arg.key} placeholder="Host" class="w-full px-2 py-1 text-std bg-cream-50 border border-cream-300 rounded-md font-mono" />
                        </td>
                        <td class="p-2">
                          <input type="text" bind:value={arg.val} placeholder="8.8.8.8" class="w-full px-2 py-1 text-std bg-cream-50 border border-cream-300 rounded-md font-mono" />
                        </td>
                        <td class="p-2 text-right">
                          <button type="button" onclick={() => (operateArgs = operateArgs.filter((_, idx) => idx !== i))} class="text-red-600 hover:text-red-800 text-std font-semibold">Delete</button>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </div>

          <div class="flex justify-end pt-2 border-t border-cream-200">
            <button
              onclick={dispatchOperate}
              disabled={busy || !activeDevice}
              class="btn btn-primary"
            >
              Send USP OPERATE
            </button>
          </div>
        </div>
      </div>

      {#if lastOperateResult}
        <div class="border border-cream-300 bg-white rounded-lg overflow-hidden space-y-0">
          <div class="p-3 bg-cream-100 border-b border-cream-300 flex items-center justify-between">
            <span class="text-std font-bold text-black">Operate Response</span>
            <span class="px-2 py-0.5 rounded text-small font-bold font-mono {lastOperateResult.ok ? 'bg-black text-white' : 'bg-red-50 text-red-800 border border-red-200'}">
              {lastOperateResult.ok ? 'SUCCESS' : 'FAILED'}
            </span>
          </div>
          <pre class="p-4 bg-cream-50 font-mono text-std text-black max-h-64 overflow-auto select-all leading-relaxed">{JSON.stringify(lastOperateResult, null, 2)}</pre>
        </div>
      {/if}

      <!-- On-Page Execution Terminal Console for Operate -->
      <div class="border border-cream-300 bg-white rounded-lg overflow-hidden space-y-0">
        <div class="p-3 bg-cream-100 border-b border-cream-300 flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <span class="text-std font-bold text-black">Operate Execution Log</span>
            <span class="px-1.5 py-0.2 rounded text-small font-bold bg-cream-200 text-stone-700">{operateLogs.length} events</span>
          </div>
          {#if operateLogs.length > 0}
            <button onclick={() => (operateLogs = [])} class="text-small text-stone-500 hover:text-black font-semibold">Clear</button>
          {/if}
        </div>
        <div class="p-3 bg-stone-950 text-stone-200 font-mono text-std max-h-48 overflow-y-auto space-y-1 leading-relaxed">
          {#if operateLogs.length === 0}
            <div class="text-stone-500 italic py-2">Ready. Click "Send USP OPERATE" to view command logs.</div>
          {:else}
            {#each operateLogs as log}
              <div class="flex items-start space-x-2">
                <span class="text-stone-500 shrink-0">[{log.timestamp}]</span>
                <span class="shrink-0 font-bold {log.type === 'success' ? 'text-emerald-400' : log.type === 'error' ? 'text-rose-400' : 'text-cyan-400'}">
                  [{log.type.toUpperCase()}]
                </span>
                <span class="text-stone-200 break-all">{log.message}</span>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- TAB 4: AUDIT HISTORY -->
  {#if activeTab === "logs"}
    <div class="border border-cream-300 bg-white rounded-lg overflow-hidden space-y-0">
      <div class="p-3 bg-cream-100 border-b border-cream-300 flex items-center justify-between gap-3 flex-wrap">
        <h3 class="text-std font-bold text-black">
          Audit History
        </h3>
        <div class="flex items-center gap-2">
          <button
            onclick={exportLogsExcel}
            disabled={execEntries.length === 0}
            class="btn btn-outline"
            title="Export logs to Excel spreadsheet"
          >
            <FileSpreadsheet class="w-3.5 h-3.5" />
            <span>Export Excel</span>
          </button>
          <input
            bind:value={execFilter}
            placeholder="Filter op/device/path..."
            class="w-48 px-2.5 py-1 text-std bg-white border border-cream-300 focus:border-accent-600 outline-none rounded-md font-mono"
          />
          <button
            onclick={async () => {
              if (!confirm("Clear execution logs?")) return;
              await api("/api/usp/exec/clear", { method: "POST" });
              execEntries = [];
            }}
            class="btn btn-danger"
          >
            Clear
          </button>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-std font-mono">
          <thead class="bg-cream-50 border-b border-cream-300 text-stone-600 text-small font-semibold">
            <tr>
              <th class="py-2.5 px-3">Timestamp</th>
              <th class="py-2.5 px-3">Op</th>
              <th class="py-2.5 px-3">Device SN</th>
              <th class="py-2.5 px-3">Target Path</th>
              <th class="py-2.5 px-3">Duration</th>
              <th class="py-2.5 px-3">Result</th>
              <th class="py-2.5 px-3 text-right">Inspect</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-cream-200">
            {#if pagedExec.length === 0}
              <tr>
                <td colspan="7" class="py-10 text-center text-stone-400 font-sans italic">
                  No operations recorded yet.
                </td>
              </tr>
            {:else}
              {#each pagedExec as e (e.id)}
                <tr class="hover:bg-cream-50 transition">
                  <td class="py-2 px-3 text-stone-500">{new Date(e.ts).toLocaleTimeString()}</td>
                  <td class="py-2 px-3 font-bold text-black">{e.op.toUpperCase()}</td>
                  <td class="py-2 px-3 text-stone-700">{e.device}</td>
                  <td class="py-2 px-3 text-accent-700 truncate max-w-xs">{e.target || "—"}</td>
                  <td class="py-2 px-3 text-stone-500">{e.durationMs}ms</td>
                  <td class="py-2 px-3">
                    <span class="px-1.5 py-0.5 text-small font-bold rounded {e.result === 'ok' ? 'bg-black text-white' : 'bg-red-50 text-red-800 border border-red-200'}">
                      {e.result.toUpperCase()}
                    </span>
                  </td>
                  <td class="py-2 px-3 text-right">
                    <button
                      onclick={() => (showExecDetail = e)}
                      class="px-2 py-0.5 border border-cream-300 hover:border-black rounded text-small font-semibold"
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- TAB 5: RAW PROTOCOL STREAM -->
  {#if activeTab === "protocol"}
    <div class="border border-cream-300 bg-white rounded-lg overflow-hidden space-y-0">
      <div class="p-3 bg-cream-100 border-b border-cream-300 flex items-center justify-between">
        <h3 class="text-std font-bold text-black">
          MQTT Protobuf Frames
        </h3>
        <span class="text-std font-mono text-stone-500">{rawMessages.length} frames</span>
      </div>

      <div class="overflow-x-auto max-h-[550px] overflow-y-auto">
        <table class="w-full text-left text-std font-mono">
          <thead class="bg-cream-50 border-b border-cream-300 text-stone-600 text-small font-semibold sticky top-0">
            <tr>
              <th class="py-2 px-3">Time</th>
              <th class="py-2 px-3">Dir</th>
              <th class="py-2 px-3">Agent</th>
              <th class="py-2 px-3">Topic</th>
              <th class="py-2 px-3">Msg ID</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-cream-200">
            {#if rawMessages.length === 0}
              <tr>
                <td colspan="5" class="py-10 text-center text-stone-400 font-sans italic">
                  No frames captured yet.
                </td>
              </tr>
            {:else}
              {#each rawMessages as m}
                <tr class="hover:bg-cream-50">
                  <td class="py-2 px-3 text-stone-500">{new Date(m.ts).toLocaleTimeString()}</td>
                  <td class="py-2 px-3 font-bold {m.direction === 'rx' ? 'text-accent-700' : 'text-black'}">{m.direction.toUpperCase()}</td>
                  <td class="py-2 px-3">{m.agent}</td>
                  <td class="py-2 px-3 text-stone-600 truncate max-w-xs">{m.topic}</td>
                  <td class="py-2 px-3 text-stone-500">{m.msgId}</td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
    </div>
    <!-- End Main Content Area -->

    <!-- Live Mosquitto Broker Logs Panel (Span 1 of 4) -->
    {#if showLiveBrokerLog}
      <aside class="lg:col-span-1 border border-cream-300 bg-white rounded-lg overflow-hidden flex flex-col min-h-0 h-full">
        <!-- Header -->
        <div class="px-3 py-2.5 bg-cream-100 border-b border-cream-300 flex items-center justify-between shrink-0">
          <div class="flex items-center space-x-2">
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <h3 class="text-std font-bold text-black">Broker Live</h3>
            <span class="text-small font-mono text-stone-500">({brokerLogs.length})</span>
          </div>

          <div class="flex items-center space-x-1">
            <button
              onclick={fetchBrokerLogs}
              title="Refresh log"
              class="btn-icon"
            >
              <RefreshCw class="w-3 h-3 {loadingBrokerLogs ? 'animate-spin' : ''}" />
            </button>
            <button
              onclick={() => (showLiveBrokerLog = false)}
              title="Close panel"
              class="btn-icon"
            >
              <X class="w-3 h-3" />
            </button>
          </div>
        </div>

        <!-- Controls / Search -->
        <div class="p-2 border-b border-cream-200 bg-cream-50 flex items-center gap-1.5 text-std shrink-0">
          <div class="relative flex-1">
            <Search class="w-3 h-3 text-stone-400 absolute left-2 top-2" />
            <input
              type="text"
              bind:value={brokerLogFilter}
              placeholder="Filter log..."
              class="w-full pl-6 pr-2 py-1 text-small bg-white border border-cream-300 rounded font-mono focus:border-black outline-none"
            />
          </div>
          <button
            onclick={() => (brokerLogs = [])}
            title="Clear current view"
            class="px-2 py-1 border border-cream-300 hover:border-black text-small font-semibold rounded bg-white cursor-pointer"
          >
            Clear
          </button>
        </div>

        <!-- Log Output Stream -->
        <div
          bind:this={brokerLogContainer}
          class="flex-1 min-h-0 p-2 bg-[#0f141c] text-[#d6deeb] font-mono text-small leading-relaxed overflow-y-auto select-text space-y-1"
        >
          {#if filteredBrokerLogs.length === 0}
            <div class="py-8 text-center text-stone-500 italic">
              {loadingBrokerLogs ? "Streaming broker logs..." : "No log entries found."}
            </div>
          {:else}
            {#each filteredBrokerLogs as log}
              <div class="break-all whitespace-pre-wrap hover:bg-white/5 px-1 py-0.5 rounded font-mono
                {log.includes('PING') ? 'text-stone-400' :
                 log.includes('PUBLISH') ? 'text-amber-300 font-semibold' :
                 log.includes('SUBSCRIBE') || log.includes('SUBACK') ? 'text-cyan-300' :
                 log.includes('disconnect') || log.includes('closed') ? 'text-rose-400' :
                 log.includes('connect') ? 'text-emerald-400 font-semibold' : 'text-slate-300'}">
                {log}
              </div>
            {/each}
          {/if}
        </div>

        <!-- Footer -->
        <div class="px-2.5 py-1.5 bg-cream-100 border-t border-cream-300 flex items-center justify-between text-small text-stone-600 font-mono shrink-0">
          <label class="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" bind:checked={autoScrollBrokerLog} class="w-3 h-3 rounded" />
            <span>Auto-scroll</span>
          </label>
          <span class="text-small text-stone-400">poll: 2s · limit: 300</span>
        </div>
      </aside>
    {/if}
  </div>
  <!-- End Grid/Split Area -->

  <!-- Detail Inspection Modal -->
  {#if showExecDetail}
    <div class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onclick={() => (showExecDetail = null)} role="dialog">
      <div class="w-full max-w-3xl bg-white border border-cream-300 rounded-lg max-h-[90vh] flex flex-col" onclick={(e) => e.stopPropagation()}>
        <div class="px-5 py-3 border-b border-cream-300 flex items-center justify-between bg-cream-50">
          <div>
            <h3 class="text-large font-bold text-black">Execution #{showExecDetail.id} · {showExecDetail.op.toUpperCase()}</h3>
            <p class="text-small text-stone-500 font-mono">{new Date(showExecDetail.ts).toISOString()} · {showExecDetail.durationMs}ms</p>
          </div>
          <button onclick={() => (showExecDetail = null)} class="btn-icon">
            <X class="w-4 h-4" />
          </button>
        </div>

        <div class="p-5 space-y-3 overflow-y-auto text-std font-mono">
          <div><span class="text-stone-500">Device:</span> <span class="font-bold">{showExecDetail.device}</span></div>
          <div><span class="text-stone-500">Target:</span> <span>{showExecDetail.target}</span></div>
          <div><span class="text-stone-500">Result:</span> <span class="font-bold {showExecDetail.result === 'ok' ? 'text-black' : 'text-red-600'}">{showExecDetail.result}</span></div>
          <div>
            <span class="text-stone-500 block mb-1">Payload / Params:</span>
            <pre class="p-3 bg-cream-50 border border-cream-300 rounded-md overflow-x-auto select-all">{JSON.stringify(showExecDetail.params, null, 2)}</pre>
          </div>
          <div>
            <span class="text-stone-500 block mb-1">Response Detail:</span>
            <pre class="p-3 bg-cream-50 border border-cream-300 rounded-md overflow-x-auto max-h-60 select-all">{JSON.stringify(showExecDetail.detail, null, 2)}</pre>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
