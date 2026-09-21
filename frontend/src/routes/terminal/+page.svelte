<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { page } from "$app/stores";
  import { listDevices, type Device } from "$lib/api/devices";
  import { Plus, X, RefreshCw, Terminal } from "lucide-svelte";
  import "@xterm/xterm/css/xterm.css";

  type TabStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

  interface TabMeta {
    id: string;
    deviceId: string;
    status: TabStatus;
  }

  interface TermRef {
    term: any;
    fit: any;
    el: HTMLDivElement;
    ws: WebSocket | null;
    dataDisposable: { dispose: () => void } | null;
    observer: ResizeObserver | null;
  }

  let devices = $state<Device[]>([]);
  let tabs = $state<TabMeta[]>([]);
  let activeTabId = $state<string>("");
  let termHost: HTMLDivElement | undefined = $state();

  // xterm instances are kept OUT of $state so Svelte's deep proxy never wraps
  // the class instances (which would break them).
  const refs = new Map<string, TermRef>();

  let activeTab = $derived(tabs.find(t => t.id === activeTabId) || null);

  // crypto.randomUUID() only exists in secure contexts (HTTPS/localhost);
  // fall back to a random id so the terminal works over plain HTTP too.
  function newTabId(): string {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch {}
    return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  let xtermPromise: Promise<any> | null = null;
  function loadXterm() {
    if (!xtermPromise) {
      xtermPromise = Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
    }
    return xtermPromise;
  }

  const XTERM_THEME = {
    background: "#181818",
    foreground: "#d4d4d4",
    cursor: "#e6e6e6",
    cursorAccent: "#181818",
    selectionBackground: "#3a3a3a",
    black: "#1c1c1c",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#d4d4d4",
    brightBlack: "#5c6370",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff"
  };

  async function createTerm(tabId: string): Promise<TermRef | null> {
    if (!termHost) return null;
    const [xtermMod, fitMod] = await loadXterm();
    const { Terminal } = xtermMod;
    const { FitAddon } = fitMod;

    const el = document.createElement("div");
    el.className = "absolute inset-0";
    el.style.display = "none";
    termHost.appendChild(el);

    const term = new Terminal({
      fontFamily: 'ui-monospace, "Cascadia Mono", "Consolas", "Courier New", monospace',
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      theme: XTERM_THEME
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try { fit.fit(); } catch {}

    const ref: TermRef = { term, fit, el, ws: null, dataDisposable: null, observer: null };
    refs.set(tabId, ref);

    // Every keystroke goes straight to the SSH session.
    ref.dataDisposable = term.onData((data: string) => {
      const r = refs.get(tabId);
      if (r?.ws && r.ws.readyState === WebSocket.OPEN) {
        r.ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    const observer = new ResizeObserver(() => {
      const r = refs.get(tabId);
      if (r && r.el.style.display !== "none") {
        try { r.fit.fit(); } catch {}
      }
    });
    observer.observe(el);
    ref.observer = observer;

    return ref;
  }

  function writeSystem(ref: TermRef, text: string) {
    ref.term.write(`\r\n\x1b[90m${text}\x1b[0m\r\n`);
  }

  function showTab(id: string) {
    for (const [tid, r] of refs) {
      r.el.style.display = tid === id ? "block" : "none";
    }
    const ref = refs.get(id);
    if (ref) {
      tick().then(() => {
        try { ref.fit.fit(); ref.term.focus(); } catch {}
      });
    }
  }

  function disconnectTab(tabId: string) {
    const ref = refs.get(tabId);
    if (ref?.ws) {
      try { ref.ws.close(); } catch {}
      ref.ws = null;
    }
  }

  async function connectTab(tab: TabMeta) {
    const dev = devices.find(d => d.id === tab.deviceId);
    if (!dev || !dev.ip) {
      tab.status = "idle";
      const ref = refs.get(tab.id);
      if (ref) ref.term.write("\r\n\x1b[90mDevice does not have an IP address.\x1b[0m\r\n");
      return;
    }

    const ref = refs.get(tab.id) ?? (await createTerm(tab.id));
    if (!ref) return;
    ref.term.reset();

    disconnectTab(tab.id);
    tab.status = "connecting";

    const loc = window.location;
    const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${loc.host}/ssh?deviceId=${encodeURIComponent(dev.id)}&ip=${encodeURIComponent(dev.ip || "")}&port=${encodeURIComponent(String(dev.ssh_port || 22))}`;

    try {
      const socket = new WebSocket(wsUrl);
      ref.ws = socket;

      socket.onopen = () => {
        tab.status = "connected";
        if (tab.id === activeTabId) ref.term.focus();
      };

      socket.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "data") {
            ref.term.write(msg.data);
          } else if (msg.type === "status") {
            writeSystem(ref, `[System] ${msg.message}`);
          } else if (msg.type === "error") {
            tab.status = "error";
            writeSystem(ref, `[Error] ${msg.message}`);
          }
        } catch {
          ref.term.write(e.data);
        }
      };

      socket.onerror = () => {
        tab.status = "error";
        writeSystem(ref, "[Error] Failed to connect to SSH gateway.");
      };

      socket.onclose = () => {
        if (tab.status !== "error") {
          tab.status = "disconnected";
          writeSystem(ref, "[Connection closed]");
        }
      };
    } catch (e: any) {
      tab.status = "error";
      writeSystem(ref, `[Error] ${e.message}`);
    }
  }

  async function addTab(preferredDeviceId?: string) {
    let targetDeviceId = preferredDeviceId;
    if (!targetDeviceId) {
      const sshDev = devices.find(d => d.ssh_port != null);
      targetDeviceId = sshDev ? sshDev.id : (devices[0]?.id || "");
    }

    const newTab: TabMeta = {
      id: newTabId(),
      deviceId: targetDeviceId,
      status: "idle"
    };

    await createTerm(newTab.id);
    tabs.push(newTab);
    activeTabId = newTab.id;
    showTab(newTab.id);

    if (targetDeviceId) connectTab(newTab);
  }

  function closeTab(tabId: string, e?: Event) {
    e?.stopPropagation();
    const idx = tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    disconnectTab(tabId);
    const ref = refs.get(tabId);
    if (ref) {
      ref.observer?.disconnect();
      ref.dataDisposable?.dispose();
      try { ref.term.dispose(); } catch {}
      ref.el.remove();
      refs.delete(tabId);
    }
    tabs.splice(idx, 1);

    if (activeTabId === tabId) {
      if (tabs.length > 0) {
        activeTabId = tabs[Math.max(0, idx - 1)].id;
      } else {
        addTab();
      }
    } else {
      showTab(activeTabId);
    }
  }

  function selectTab(tabId: string) {
    activeTabId = tabId;
    showTab(tabId);
  }

  async function init() {
    try {
      devices = await listDevices();
      const targetId = $page.url.searchParams.get("deviceId");
      if (targetId && devices.some(d => d.id === targetId)) {
        await addTab(targetId);
      } else {
        await addTab();
      }
    } catch {
      await addTab();
    }
  }

  onMount(init);

  onDestroy(() => {
    for (const [tid] of refs) {
      disconnectTab(tid);
      const ref = refs.get(tid);
      ref?.observer?.disconnect();
      ref?.dataDisposable?.dispose();
      try { ref?.term.dispose(); } catch {}
    }
    refs.clear();
  });
</script>

<div class="h-full w-full flex flex-col bg-[#1c1c1c] text-[#e6e6e6]">
  <!-- Windows Terminal style Top Tab Bar -->
  <div class="h-9 bg-[#242424] border-b border-[#333333] flex items-center px-2 gap-1 shrink-0 select-none overflow-x-auto">
    {#each tabs as tab (tab.id)}
      {@const dev = devices.find(d => d.id === tab.deviceId)}
      {@const isActive = tab.id === activeTabId}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        onclick={() => selectTab(tab.id)}
        class="h-7 px-2.5 flex items-center gap-2 rounded text-std font-mono transition-colors cursor-pointer border max-w-[200px] shrink-0
          {isActive
            ? 'bg-[#1c1c1c] text-[#e6e6e6] border-[#3a3a3a] font-bold'
            : 'bg-[#2a2a2a]/80 text-[#a0a0a0] hover:text-[#e6e6e6] border-transparent hover:bg-[#2a2a2a]'}"
      >
        <Terminal class="w-3 h-3 shrink-0 {isActive ? 'text-[#e6e6e6]' : 'text-[#707070]'}" />
        <span class="truncate text-small leading-none">
          {dev ? dev.name : 'Terminal'}
        </span>

        <button
          type="button"
          onclick={(e) => closeTab(tab.id, e)}
          class="w-4 h-4 rounded flex items-center justify-center text-[#707070] hover:text-[#e6e6e6] hover:bg-[#333333] transition-colors ml-1 shrink-0"
          title="Close tab"
        >
          <X class="w-3 h-3" />
        </button>
      </div>
    {/each}

    <!-- New Tab Button -->
    <button
      type="button"
      onclick={() => addTab()}
      class="h-7 w-7 rounded flex items-center justify-center text-[#a0a0a0] hover:text-[#e6e6e6] hover:bg-[#2a2a2a] transition-colors shrink-0 cursor-pointer"
      title="Open new tab"
    >
      <Plus class="w-3.5 h-3.5" />
    </button>

    <div class="ml-auto flex items-center gap-2 shrink-0 pr-1">
      {#if activeTab}
        {@const dev = devices.find(d => d.id === activeTab.deviceId)}
        <!-- Device Switcher for current tab -->
        <select
          bind:value={activeTab.deviceId}
          onchange={() => activeTab && connectTab(activeTab)}
          class="h-6 px-2 text-small font-mono bg-[#1c1c1c] border border-[#333333] text-[#d0d0d0] rounded outline-none focus:border-[#555555] cursor-pointer max-w-[180px] truncate"
        >
          {#each devices as d}
            <option value={d.id} class="bg-[#242424] text-[#e6e6e6]">
              {d.name} ({d.ip || 'no-ip'})
            </option>
          {/each}
        </select>

        {#if dev?.ip}
          <span class="text-small font-mono text-[#8a8a8a] hidden md:inline truncate">
            {dev.ip}:{dev.ssh_port || 22}
          </span>
        {/if}

        <button
          type="button"
          onclick={() => activeTab && connectTab(activeTab)}
          class="h-6 px-2 rounded flex items-center gap-1 text-small font-mono text-[#a0a0a0] hover:text-[#e6e6e6] hover:bg-[#2a2a2a] transition-colors cursor-pointer border border-[#333333]"
          title="Reconnect"
        >
          <RefreshCw class="w-2.5 h-2.5" />
          <span class="hidden sm:inline">Reconnect</span>
        </button>
      {/if}
    </div>
  </div>

  <!-- Real terminal (xterm.js) -->
  <div bind:this={termHost} class="relative flex-1 min-h-0 bg-[#181818]"></div>
</div>
