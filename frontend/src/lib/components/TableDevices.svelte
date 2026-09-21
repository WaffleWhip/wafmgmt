<script lang="ts">
  import { onMount } from "svelte";
  import { copyText } from "$lib/clipboard";
  import { listDevices, deleteDevice, type Device } from "$lib/api/devices";
  import { appState } from "$lib/store.svelte";
  import { authState } from "$lib/auth.svelte";
  import { TERMINAL_ENABLED } from "$lib/registry";
  import { goto } from "$app/navigation";
  import ModalDeviceForm from "./ModalDeviceForm.svelte";
  import Button from "./ui/Button.svelte";
  import Input from "./ui/Input.svelte";
  import {
    Plus, Server, Trash2, Pencil, ExternalLink, Search, Shield, Globe, Network,
    LayoutGrid, List, Copy, Check, Terminal, ArrowUpRight
  } from "lucide-svelte";

  let { onOpenTerminal } = $props<{
    onOpenTerminal?: (device: Device) => void;
  }>();

  let search = $state("");
  let devices = $state<Device[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let editing = $state<Device | null>(null);
  let showForm = $state(false);
  let viewMode = $state<"grid" | "list">("grid");
  let copiedId = $state<string | null>(null);

  // Auto-sync from SSE global state
  $effect(() => {
    if (appState.devices.length > 0) {
      devices = appState.devices as Device[];
      loading = false;
    }
  });

  async function load() {
    loading = true;
    error = null;
    try {
      const list = await listDevices();
      devices = list;
      appState.devices = list;
    } catch (e: any) {
      error = e?.message ?? "Failed to load devices";
    } finally {
      loading = false;
    }
  }

  async function remove(d: Device) {
    if (!confirm(`Delete "${d.name}"?`)) return;
    try {
      await deleteDevice(d.id);
      devices = devices.filter((x) => x.id !== d.id);
      appState.devices = devices;
    } catch (e: any) {
      // Allow local optimistic removal in mock/dev mode
      devices = devices.filter((x) => x.id !== d.id);
      appState.devices = devices;
    }
  }

  function normalizePath(v: string | null | undefined): string {
    if (!v) return "";
    const t = v.trim();
    if (!t) return "";
    return t.startsWith("/") ? t : "/" + t;
  }

  function endpoint(d: Device): string {
    if (!d.ip) return "—";
    const base = d.port ? `${d.ip}:${d.port}` : d.ip;
    return base + normalizePath((d as any).path);
  }

  function deviceUrl(d: Device): string | null {
    if (!d.ip) return null;
    const ip = d.ip.trim();
    const suffix = normalizePath((d as any).path);
    if (/^https?:\/\//i.test(ip)) return ip + suffix;
    if (d.port) {
      const scheme = d.port === 443 || d.port === 8006 ? "https" : "http";
      return `${scheme}://${ip}:${d.port}${suffix}`;
    }
    return `http://${ip}${suffix}`;
  }

  function onIconError(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    img.style.display = "none";
  }

  async function copyIp(d: Device, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    if (!d.ip) return;
    try {
        await copyText(d.ip);
      copiedId = d.id;
      setTimeout(() => {
        if (copiedId === d.id) copiedId = null;
      }, 1500);
    } catch {}
  }

  const filteredDevices = $derived(
    devices.filter((d) =>
      `${d.name} ${d.ip ?? ""} ${(d as any).path ?? ""} ${d.notes ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())
    )
  );

  onMount(load);
</script>

<div class="space-y-4">
  <!-- Top Bar: Title, Search, and Primary Action -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-cream-300">
    <div class="flex items-baseline gap-2">
      <h1 class="text-large font-bold text-black tracking-tight">Devices & Services</h1>
      <span class="text-std text-stone-400 font-mono">({devices.length})</span>
    </div>

    <div class="flex items-center gap-2">
      <!-- Search Input -->
      <div class="min-w-[220px]">
        <Input
          bind:value={search}
          placeholder="Filter devices…"
          icon={Search}
        />
      </div>

      <!-- Add Device Button (Admin only) -->
      {#if authState.user.role === 'admin'}
        <Button
          variant="primary"
          onclick={() => { editing = null; showForm = true; }}
        >
          <Plus class="w-3.5 h-3.5" />
          <span>Add</span>
        </Button>
      {/if}
    </div>
  </div>

  {#if error}
    <div class="banner banner-info text-std font-mono">
      {error}
    </div>
  {/if}

  <!-- Devices Table -->
  {#if loading && devices.length === 0}
    <div class="py-12 text-center text-std text-stone-400 font-mono">
      Loading devices…
    </div>
  {:else if devices.length === 0}
    <div class="py-12 text-center border border-dashed border-cream-300 rounded-md">
      <p class="text-std font-semibold text-stone-600">No devices configured</p>
      <button
        type="button"
        onclick={() => { editing = null; showForm = true; }}
        class="mt-2 text-std text-black underline underline-offset-4 hover:text-stone-600 cursor-pointer"
      >
        Add your first device
      </button>
    </div>
  {:else if filteredDevices.length === 0}
    <div class="py-8 text-center text-std text-stone-500">
      No devices match "{search}"
    </div>
  {:else}
    <div class="surface overflow-hidden">
      <div class="divide-y divide-cream-200">
        {#each filteredDevices as d (d.id)}
          {@const url = deviceUrl(d)}
          {#if url}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center justify-between px-3.5 py-2 hover:bg-cream-100/70 transition-colors group cursor-pointer text-inherit no-underline"
              title="Open {endpoint(d)}"
            >
              <!-- Left: Icon, Name & Description under name -->
              <div class="flex items-center gap-3 min-w-0 flex-1 mr-4">
                {#if d.icon}
                  <img src={d.icon} alt={d.name} class="w-8 h-8 object-contain shrink-0" onerror={onIconError} />
                {:else}
                  <Server class="w-7 h-7 text-stone-400 group-hover:text-black shrink-0 transition-colors" />
                {/if}

                <div class="min-w-0">
                  <div class="text-std font-bold text-black truncate leading-tight group-hover:underline underline-offset-2">
                    {d.name}
                  </div>
                  {#if d.notes}
                    <div class="text-small text-stone-400 truncate leading-tight mt-0.5">
                      {d.notes}
                    </div>
                  {/if}
                </div>
              </div>

              <!-- Right: Endpoint, Quick Actions -->
              <div class="flex items-center gap-2 shrink-0">
                {#if d.ip}
                  <button
                    type="button"
                    onclick={(e) => copyIp(d, e)}
                    class="h-7 px-2 rounded hover:bg-cream-200 font-mono text-small text-stone-600 hover:text-black inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Click to copy endpoint"
                  >
                    <span>{endpoint(d)}</span>
                    {#if copiedId === d.id}
                      <Check class="w-3 h-3 text-emerald-600" />
                    {:else}
                      <Copy class="w-3 h-3 text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    {/if}
                  </button>
                {:else}
                  <span class="text-small font-mono text-stone-400">—</span>
                {/if}

                <!-- Row Actions (SSH, Edit & Remove) -->
                <div class="flex items-center">
                  {#if TERMINAL_ENABLED && authState.user.role === 'admin' && d.ssh_port}
                    <button
                      type="button"
                      onclick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (onOpenTerminal) onOpenTerminal(d);
                        else goto(`/terminal?deviceId=${encodeURIComponent(d.id)}`);
                      }}
                      class="btn-icon"
                      title="Open Web SSH Terminal (Port {d.ssh_port})"
                    >
                      <Terminal class="w-3.5 h-3.5" />
                    </button>
                  {/if}

                  {#if authState.user.role === 'admin'}
                    <button
                      type="button"
                      onclick={(e) => { e.preventDefault(); e.stopPropagation(); editing = d; showForm = true; }}
                      class="btn-icon"
                      title="Edit"
                    >
                      <Pencil class="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onclick={(e) => { e.preventDefault(); e.stopPropagation(); remove(d); }}
                      class="btn-icon hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  {/if}
                </div>
              </div>
            </a>
          {:else}
            <div class="flex items-center justify-between px-3.5 py-2 hover:bg-cream-100/60 transition-colors group">
              <!-- Left: Icon, Name & Description under name -->
              <div class="flex items-center gap-3 min-w-0 flex-1 mr-4">
                {#if d.icon}
                  <img src={d.icon} alt={d.name} class="w-8 h-8 object-contain shrink-0" onerror={onIconError} />
                {:else}
                  <Server class="w-7 h-7 text-stone-400 shrink-0" />
                {/if}

                <div class="min-w-0">
                  <div class="text-std font-bold text-black truncate leading-tight">
                    {d.name}
                  </div>
                  {#if d.notes}
                    <div class="text-small text-stone-400 truncate leading-tight mt-0.5">
                      {d.notes}
                    </div>
                  {/if}
                </div>
              </div>

              <!-- Right: Endpoint, Quick Actions -->
              <div class="flex items-center gap-2 shrink-0">
                {#if d.ip}
                  <button
                    type="button"
                    onclick={(e) => copyIp(d, e)}
                    class="h-7 px-2 rounded hover:bg-cream-200 font-mono text-small text-stone-600 hover:text-black inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Click to copy endpoint"
                  >
                    <span>{endpoint(d)}</span>
                    {#if copiedId === d.id}
                      <Check class="w-3 h-3 text-emerald-600" />
                    {:else}
                      <Copy class="w-3 h-3 text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    {/if}
                  </button>
                {:else}
                  <span class="text-small font-mono text-stone-400">—</span>
                {/if}

                <!-- Row Actions (SSH, Edit & Remove) -->
                <div class="flex items-center">
                  {#if TERMINAL_ENABLED && authState.user.role === 'admin' && d.ssh_port}
                    <button
                      type="button"
                      onclick={() => {
                        if (onOpenTerminal) onOpenTerminal(d);
                        else goto(`/terminal?deviceId=${encodeURIComponent(d.id)}`);
                      }}
                      class="btn-icon"
                      title="Open Web SSH Terminal (Port {d.ssh_port})"
                    >
                      <Terminal class="w-3.5 h-3.5" />
                    </button>
                  {/if}

                  {#if authState.user.role === 'admin'}
                    <button
                      type="button"
                      onclick={() => { editing = d; showForm = true; }}
                      class="btn-icon"
                      title="Edit"
                    >
                      <Pencil class="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onclick={() => remove(d)}
                      class="btn-icon hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
</div>

{#if showForm}
  <ModalDeviceForm
    edit={editing}
    onClose={() => { showForm = false; editing = null; }}
    onSaved={() => {
      showForm = false;
      editing = null;
      load();
    }}
  />
{/if}

