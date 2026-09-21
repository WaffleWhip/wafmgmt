<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Search, Play, Trash2, Plus, AlertCircle, X } from "lucide-svelte";
  import CustomSelect from "./CustomSelect.svelte";
  import Button from "./ui/Button.svelte";
  import Input from "./ui/Input.svelte";
  import Modal from "./ui/Modal.svelte";

  type Device = { id: string; name?: string; ip?: string; status?: string };
  type TemplateField = {
    name: string;
    label: string;
    type: "text" | "password" | "number";
    required: boolean;
    defaultValue?: string;
    placeholder?: string;
  };
  type TemplateDef = {
    id: string;
    name: string;
    description: string;
    category: string;
    destructive: boolean;
    fields: TemplateField[];
  };
  type LogLine = { ts: number; level: string; text: string };

  let { devices = [], activeDevice = $bindable("") } = $props<{
    devices: Device[];
    activeDevice?: string;
  }>();

  let templates = $state<TemplateDef[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let search = $state("");

  let activeTemplate = $state<TemplateDef | null>(null);
  let runDevice = $state("");
  let inputs = $state<Record<string, string>>({});
  let running = $state(false);
  let runLog = $state<LogLine[]>([]);
  let runSummary = $state<any>(null);
  let brokerLines = $state<string[]>([]);
  let brokerTimer: any = null;

  let editorOpen = $state(false);
  let saving = $state(false);
  let draft = $state({
    id: "",
    name: "",
    description: "",
    category: "WAN",
    destructive: false,
    variablesText: "{}",
    stepsText: "[]",
    targetsText: ""
  });

  async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
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

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await api("/api/usp/templates");
      templates = res.templates ?? [];
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function pollBroker() {
    try {
      const res = await api("/api/usp/broker-logs?limit=40");
      brokerLines = res.logs ?? [];
    } catch {}
  }

  function startBrokerPoll() {
    stopBrokerPoll();
    pollBroker();
    brokerTimer = setInterval(pollBroker, 1500);
  }

  function stopBrokerPoll() {
    if (brokerTimer) {
      clearInterval(brokerTimer);
      brokerTimer = null;
    }
  }

  onDestroy(stopBrokerPoll);

  function openRun(t: TemplateDef) {
    activeTemplate = t;
    runDevice = activeDevice || devices[0]?.id || "";
    const initial: Record<string, string> = {};
    for (const field of t.fields) initial[field.name] = field.defaultValue ?? "";
    inputs = initial;
    runLog = [];
    runSummary = null;
    brokerLines = [];
    error = null;
  }

  function closeRun() {
    if (running) return;
    stopBrokerPoll();
    activeTemplate = null;
  }

  async function execute() {
    if (!activeTemplate || !runDevice) return;
    running = true;
    error = null;
    runLog = [];
    runSummary = null;
    startBrokerPoll();
    try {
      const res = await api("/api/usp/templates/run", {
        method: "POST",
        body: JSON.stringify({
          template: activeTemplate.id,
          device_id: runDevice,
          inputs
        })
      });
      runLog = res.log ?? [];
      runSummary = res.summary ?? null;
      activeDevice = runDevice;
    } catch (e: any) {
      error = e.message;
    } finally {
      running = false;
      stopBrokerPoll();
    }
  }

  function openEditor() {
    draft = {
      id: "",
      name: "",
      description: "",
      category: "WAN",
      destructive: false,
      variablesText: "{}",
      stepsText: "[]",
      targetsText: ""
    };
    error = null;
    editorOpen = true;
  }

  async function saveTemplate() {
    saving = true;
    error = null;
    try {
      const variables = JSON.parse(draft.variablesText || "{}");
      const steps = JSON.parse(draft.stepsText || "[]");
      const targets = draft.targetsText.trim() ? JSON.parse(draft.targetsText) : undefined;
      if (!Array.isArray(steps) && !Array.isArray(targets)) {
        throw new Error("Isi steps[] atau targets[]");
      }
      await api("/api/usp/templates", {
        method: "POST",
        body: JSON.stringify({
          id: draft.id.trim().toLowerCase(),
          name: draft.name.trim(),
          description: draft.description.trim(),
          category: draft.category.trim() || "General",
          destructive: draft.destructive,
          variables,
          steps: Array.isArray(steps) ? steps : undefined,
          targets
        })
      });
      editorOpen = false;
      await load();
    } catch (e: any) {
      error = e.message;
    } finally {
      saving = false;
    }
  }

  async function remove(t: TemplateDef) {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    try {
      await api("/api/usp/templates/" + encodeURIComponent(t.id), { method: "DELETE" });
      await load();
    } catch (e: any) {
      error = e.message;
    }
  }

  function timeOf(ts: number): string {
    const d = new Date(ts);
    return d.toTimeString().split(" ")[0] + "." + String(d.getMilliseconds()).padStart(3, "0");
  }

  function levelColor(level: string): string {
    if (level === "error") return "text-rose-400";
    if (level === "ok") return "text-emerald-400";
    return "text-cyan-400";
  }

  const deviceOptions = $derived(
    devices.map((d) => ({
      value: d.id,
      label: d.name ? `${d.name} — ${d.id}` : d.id
    }))
  );

  const filteredTemplates = $derived(
    templates.filter((t) =>
      `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(search.trim().toLowerCase())
    )
  );

  onMount(load);
</script>

<div class="space-y-4">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-cream-300">
    <div class="flex items-baseline gap-2">
      <h2 class="text-std font-bold text-black tracking-tight">Templates</h2>
      <span class="text-std text-stone-400 font-mono">({templates.length})</span>
    </div>

    <div class="flex items-center gap-2">
      <div class="min-w-[200px]">
        <Input bind:value={search} placeholder="Filter templates…" icon={Search} />
      </div>
      <Button variant="primary" onclick={openEditor}>
        <Plus class="w-3.5 h-3.5" />
        <span>New</span>
      </Button>
    </div>
  </div>

  {#if error && !activeTemplate && !editorOpen}
    <div class="banner banner-info text-std font-mono">{error}</div>
  {/if}

  {#if loading}
    <div class="py-12 text-center text-std text-stone-400 font-mono">Loading templates…</div>
  {:else if filteredTemplates.length > 0}
    <div class="surface overflow-hidden">
      <div class="divide-y divide-cream-200">
        {#each filteredTemplates as t (t.id)}
          <div class="flex items-center justify-between px-3.5 py-2 hover:bg-cream-100/70 transition-colors group">
            <div class="min-w-0 flex-1 mr-4">
              <div class="text-std font-bold text-black truncate leading-tight">{t.name}</div>
              <div class="text-small text-stone-400 truncate leading-tight mt-0.5">{t.description}</div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <span class="text-small font-mono text-stone-500 hidden sm:inline">{t.category}</span>
              <Button variant={t.destructive ? "danger" : "primary"} size="sm" onclick={() => openRun(t)}>
                <Play class="w-3 h-3" />
                <span>Run</span>
              </Button>
              <button
                type="button"
                onclick={() => remove(t)}
                class="btn-icon hover:text-red-600"
                title="Delete template"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

{#if editorOpen}
  <Modal title="New Template" subtitle="File disimpan di data/usp-templates/{id}.json" maxWidth="max-w-2xl" onClose={() => (editorOpen = false)}>
    <div class="space-y-3">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-small font-bold text-stone-500 mb-1">ID</label>
          <input type="text" bind:value={draft.id} placeholder="wan-pppoe" class="w-full px-3 py-2 text-std bg-white border border-cream-300 focus:border-accent-600 outline-none rounded-md font-mono" />
        </div>
        <div>
          <label class="block text-small font-bold text-stone-500 mb-1">Name</label>
          <input type="text" bind:value={draft.name} placeholder="WAN PPPoE" class="w-full px-3 py-2 text-std bg-white border border-cream-300 focus:border-accent-600 outline-none rounded-md" />
        </div>
      </div>

      <div>
        <label class="block text-small font-bold text-stone-500 mb-1">Description</label>
        <input type="text" bind:value={draft.description} placeholder="Bikin WAN PPPoE." class="w-full px-3 py-2 text-std bg-white border border-cream-300 focus:border-accent-600 outline-none rounded-md" />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-small font-bold text-stone-500 mb-1">Category</label>
          <input type="text" bind:value={draft.category} class="w-full px-3 py-2 text-std bg-white border border-cream-300 focus:border-accent-600 outline-none rounded-md font-mono" />
        </div>
        <label class="flex items-center gap-2 text-std text-stone-600 cursor-pointer self-end pb-2">
          <input type="checkbox" bind:checked={draft.destructive} class="accent-black" />
          <span>Destructive</span>
        </label>
      </div>

      <div>
        <label class="block text-small font-bold text-stone-500 mb-1">Variables (JSON)</label>
        <textarea bind:value={draft.variablesText} rows="3" class="w-full px-3 py-2 text-small bg-cream-50 border border-cream-300 focus:border-accent-600 outline-none rounded-md font-mono"></textarea>
      </div>

      <div>
        <label class="block text-small font-bold text-stone-500 mb-1">Steps (JSON)</label>
        <textarea bind:value={draft.stepsText} rows="8" class="w-full px-3 py-2 text-small bg-cream-50 border border-cream-300 focus:border-accent-600 outline-none rounded-md font-mono"></textarea>
      </div>

      <div>
        <label class="block text-small font-bold text-stone-500 mb-1">Targets (JSON, optional)</label>
        <textarea bind:value={draft.targetsText} rows="4" class="w-full px-3 py-2 text-small bg-cream-50 border border-cream-300 focus:border-accent-600 outline-none rounded-md font-mono" placeholder='[&#123;"base_path":"Device.PPP.Interface.","min_index_to_delete":0&#125;]'></textarea>
      </div>

      {#if error}
        <div class="p-3 bg-red-50 border border-red-200 rounded-md text-std text-red-800 flex items-start justify-between gap-2 font-mono">
          <div class="flex items-center gap-2">
            <AlertCircle class="w-4 h-4 text-red-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onclick={() => (error = null)} class="btn-icon text-red-600 hover:text-red-800">
            <X class="w-3.5 h-3.5" />
          </button>
        </div>
      {/if}
    </div>

    {#snippet footer()}
      <Button variant="secondary" onclick={() => (editorOpen = false)} disabled={saving}>Cancel</Button>
      <Button variant="primary" onclick={saveTemplate} loading={saving}>Save</Button>
    {/snippet}
  </Modal>
{/if}

{#if activeTemplate}
  <Modal
    title={activeTemplate.name}
    subtitle={`Template: ${activeTemplate.id} · ${activeTemplate.category}`}
    maxWidth="max-w-3xl"
    onClose={closeRun}
  >
    <div class="space-y-3">
      <div>
        <label class="block text-small font-bold text-stone-500 mb-1">Target Device</label>
        <CustomSelect bind:value={runDevice} options={deviceOptions} placeholder="Select ONT" />
      </div>

      {#each activeTemplate.fields as field (field.name)}
        <div>
          <label class="block text-small font-bold text-stone-500 mb-1">
            {field.label}{#if field.required}<span class="text-red-600"> *</span>{/if}
          </label>
          <input
            type={field.type}
            bind:value={inputs[field.name]}
            placeholder={field.placeholder ?? ""}
            class="w-full px-3 py-2 text-std bg-white border border-cream-300 focus:border-accent-600 outline-none rounded-md font-mono"
          />
        </div>
      {/each}

      <div class="border border-cream-300 rounded-md overflow-hidden">
        <div class="p-2 bg-cream-100 border-b border-cream-300 flex items-center justify-between">
          <span class="text-small font-bold text-black">Execution Log</span>
          <span class="text-small font-mono text-stone-600">
            {#if running}running…{:else}{runLog.length} baris{/if}{#if runSummary?.connection_status} · PPPoE {runSummary.connection_status}{/if}
          </span>
        </div>
        <div class="p-3 bg-stone-950 text-stone-200 font-mono text-small max-h-56 overflow-y-auto space-y-1 leading-relaxed">
          {#if runLog.length === 0 && !running}
            <div class="text-stone-600">—</div>
          {:else}
            {#each runLog as line, i (i)}
              <div class="flex items-start gap-2">
                <span class="text-stone-500 shrink-0">[{timeOf(line.ts)}]</span>
                <span class="shrink-0 font-bold {levelColor(line.level)}">[{line.level}]</span>
                <span class="text-stone-200 break-all">{line.text}</span>
              </div>
            {/each}
            {#if running}
              <div class="text-stone-500">…</div>
            {/if}
          {/if}
        </div>
      </div>

      <div class="border border-cream-300 rounded-md overflow-hidden">
        <div class="p-2 bg-cream-100 border-b border-cream-300 flex items-center justify-between">
          <span class="text-small font-bold text-black">Broker Log</span>
          <button onclick={pollBroker} class="text-small text-stone-500 hover:text-black font-semibold">Refresh</button>
        </div>
        <div class="p-3 bg-stone-950 text-stone-300 font-mono text-small max-h-40 overflow-y-auto space-y-0.5 leading-relaxed">
          {#if brokerLines.length === 0}
            <div class="text-stone-600">—</div>
          {:else}
            {#each brokerLines as line, i (i)}
              <div class="break-all">{line}</div>
            {/each}
          {/if}
        </div>
      </div>

      {#if error}
        <div class="p-3 bg-red-50 border border-red-200 rounded-md text-std text-red-800 flex items-start justify-between gap-2 font-mono">
          <div class="flex items-center gap-2">
            <AlertCircle class="w-4 h-4 text-red-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onclick={() => (error = null)} class="btn-icon text-red-600 hover:text-red-800">
            <X class="w-3.5 h-3.5" />
          </button>
        </div>
      {/if}
    </div>

    {#snippet footer()}
      <Button variant="secondary" onclick={closeRun} disabled={running}>Close</Button>
      <Button
        variant={activeTemplate.destructive ? "danger" : "primary"}
        onclick={execute}
        loading={running}
        disabled={!runDevice}
      >
        <span>Execute</span>
      </Button>
    {/snippet}
  </Modal>
{/if}
