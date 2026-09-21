<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { RefreshCw } from "lucide-svelte";

  let {
    devices = [],
    selectedDeviceId = $bindable("")
  } = $props<{
    devices: Device[];
    selectedDeviceId?: string;
  }>();

  let selectedDevice = $derived(devices.find(d => d.id === selectedDeviceId) || null);

  let termContainer: HTMLDivElement | undefined = $state();
  let ws: WebSocket | null = null;
  let status = $state<"idle" | "connecting" | "connected" | "disconnected" | "error">("idle");
  let errorMessage = $state<string | null>(null);

  let lines = $state<string[]>([]);
  let currentInput = $state<string>("");
  let inputEl: HTMLInputElement | undefined = $state();

  function appendOutput(text: string) {
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const newLines = normalized.split("\n");

    if (lines.length === 0) {
      lines = newLines;
    } else {
      const last = lines[lines.length - 1];
      lines[lines.length - 1] = last + newLines[0];
      if (newLines.length > 1) {
        lines.push(...newLines.slice(1));
      }
    }

    if (lines.length > 2500) {
      lines = lines.slice(lines.length - 2500);
    }

    tick().then(() => {
      if (termContainer) {
        termContainer.scrollTop = termContainer.scrollHeight;
      }
    });
  }

  function disconnect() {
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }
  }

  function connect() {
    if (!selectedDevice || !selectedDevice.ip) {
      status = "idle";
      lines = ["Select a device to start an SSH session."];
      return;
    }

    disconnect();
    status = "connecting";
    errorMessage = null;
    lines = [
      `Connecting to ${selectedDevice.name} (${selectedDevice.ip}:${selectedDevice.ssh_port || 22})...`,
      ""
    ];

    const loc = window.location;
    const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${loc.host}/ssh?deviceId=${encodeURIComponent(selectedDevice.id)}&ip=${encodeURIComponent(selectedDevice.ip || '')}&port=${encodeURIComponent(String(selectedDevice.ssh_port || 22))}`;

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        status = "connected";
        inputEl?.focus();
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "data") {
            appendOutput(msg.data);
          } else if (msg.type === "status") {
            appendOutput(`\n[System] ${msg.message}\n`);
          } else if (msg.type === "error") {
            status = "error";
            errorMessage = msg.message;
            appendOutput(`\n[Error] ${msg.message}\n`);
          }
        } catch {
          appendOutput(e.data);
        }
      };

      ws.onerror = () => {
        status = "error";
        errorMessage = "WebSocket connection failed";
        appendOutput("\n[Error] Failed to connect to SSH gateway.\n");
      };

      ws.onclose = () => {
        if (status !== "error") {
          status = "disconnected";
          appendOutput("\n[Connection closed]\n");
        }
      };
    } catch (e: any) {
      status = "error";
      errorMessage = e.message;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (e.key === "Enter") {
      ws.send(JSON.stringify({ type: "input", data: currentInput + "\n" }));
      currentInput = "";
      e.preventDefault();
    } else if (e.key === "c" && e.ctrlKey) {
      ws.send(JSON.stringify({ type: "input", data: "\x03" }));
      currentInput = "";
      e.preventDefault();
    } else if (e.key === "d" && e.ctrlKey) {
      ws.send(JSON.stringify({ type: "input", data: "\x04" }));
      e.preventDefault();
    }
  }

  $effect(() => {
    if (selectedDeviceId && (!ws || ws.readyState === WebSocket.CLOSED)) {
      connect();
    }
  });

  onMount(() => {
    if (!selectedDeviceId) {
      const sshDev = devices.find(d => d.ssh_port != null);
      if (sshDev) selectedDeviceId = sshDev.id;
      else if (devices.length > 0) selectedDeviceId = devices[0].id;
    }
    if (selectedDeviceId) connect();
  });

  onDestroy(() => {
    disconnect();
  });
</script>

<div class="h-full flex flex-col rounded-lg border border-stone-800 bg-stone-950 text-white overflow-hidden">
  <!-- Top Bar: Minimal Header with Device Selector & Action Buttons -->
  <div class="px-3 py-2 bg-stone-900 border-b border-stone-800 flex items-center justify-between gap-3 shrink-0">
    <div class="flex items-center gap-2 min-w-0">
      <select
        bind:value={selectedDeviceId}
        onchange={() => connect()}
        class="h-7 px-2.5 text-std font-mono bg-stone-950 border border-stone-700 text-white rounded outline-none focus:border-stone-500 cursor-pointer max-w-[280px] truncate"
      >
        {#each devices as dev}
          <option value={dev.id} class="bg-stone-900 text-white">
            {dev.name} ({dev.ip || 'no-ip'}{dev.ssh_port ? `:${dev.ssh_port}` : ''})
          </option>
        {/each}
      </select>

      {#if selectedDevice?.ip}
        <span class="text-std font-mono text-stone-400 hidden sm:inline truncate">
          {selectedDevice.ip}:{selectedDevice.ssh_port || 22}
        </span>
      {/if}
    </div>

    <div class="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onclick={connect}
        title="Reconnect"
        class="h-7 px-2.5 rounded flex items-center gap-1.5 text-std font-mono text-stone-300 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer border border-stone-800"
      >
        <RefreshCw class="w-3 h-3" />
        <span>Reconnect</span>
      </button>
    </div>
  </div>

  <!-- Terminal Output Lines -->
  <div
    bind:this={termContainer}
    class="flex-1 p-3 font-mono text-std overflow-y-auto bg-black text-stone-200 select-text space-y-0.5 leading-relaxed cursor-text"
    onclick={() => inputEl?.focus()}
  >
    {#each lines as line}
      <div class="whitespace-pre-wrap break-all">{line}</div>
    {/each}
  </div>

  <!-- Terminal Prompt Input -->
  <div class="p-2 bg-stone-900 border-t border-stone-800 flex items-center gap-2 shrink-0">
    <span class="text-std font-mono text-stone-400 shrink-0 font-bold">$</span>
    <input
      bind:this={inputEl}
      type="text"
      bind:value={currentInput}
      onkeydown={handleKeydown}
      disabled={status !== "connected"}
      placeholder={status === "connected" ? "Type command…" : "Waiting connection…"}
      class="flex-1 bg-transparent border-none outline-none font-mono text-std text-white placeholder:text-stone-600 focus:ring-0"
    />
  </div>
</div>
