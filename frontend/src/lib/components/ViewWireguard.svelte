<script lang="ts">
  import { appState } from "$lib/store.svelte";
  import { Plus, Trash2, QrCode, Download, Shield, ArrowDownLeft, ArrowUpRight, Settings, Pencil, Search, Copy, Check, Activity } from "lucide-svelte";
  import { copyText } from "$lib/clipboard";
  import PageHeader from "$lib/components/ui/PageHeader.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";

  let {
    onAddPeer,
    onEditPeer,
    onViewPeer,
    onOpenWgSettings
  }: {
    onAddPeer: () => void;
    onEditPeer?: (peer: any) => void;
    onViewPeer: (peer: any) => void;
    onOpenWgSettings: () => void;
  } = $props();

  let search = $state("");
  let copied = $state(false);

  // Live throughput sampling (SSE metrics every ~1.5s; rxBytes/txBytes are cumulative)
  let rxSpark = $state<number[]>([]);
  let txSpark = $state<number[]>([]);
  let _rxHistory: number[] = [];
  let _txHistory: number[] = [];
  let _lastRx = 0;
  let _lastTx = 0;
  let _lastTs = 0;

  $effect(() => {
    const rx = appState.peers.reduce((s: number, p: any) => s + (p.rxBytes || 0), 0);
    const tx = appState.peers.reduce((s: number, p: any) => s + (p.txBytes || 0), 0);
    const now = Date.now();

    if (rx < _lastRx || tx < _lastTx) {
      // Counter reset (interface bounce) — start over
      _rxHistory = [];
      _txHistory = [];
    } else if (_lastTs) {
      const dt = (now - _lastTs) / 1000;
      if (dt >= 1) {
        _rxHistory = [..._rxHistory, (rx - _lastRx) / dt].slice(-60);
        _txHistory = [..._txHistory, (tx - _lastTx) / dt].slice(-60);
        rxSpark = _rxHistory;
        txSpark = _txHistory;
      }
    }
    _lastRx = rx;
    _lastTx = tx;
    _lastTs = now;
  });

  const rxRate = $derived(rxSpark.length > 0 ? rxSpark[rxSpark.length - 1] : 0);
  const txRate = $derived(txSpark.length > 0 ? txSpark[txSpark.length - 1] : 0);
  const sparkMax = $derived(Math.max(...rxSpark, ...txSpark, 1));

  const filteredPeers = $derived(
    appState.peers.filter((p) =>
      `${p.name} ${p.ip} ${p.endpoint}`.toLowerCase().includes(search.trim().toLowerCase())
    )
  );

  function fmtRate(bps: number): string {
    if (bps < 1024) return `${Math.round(bps)} B/s`;
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    if (bps < 1024 * 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
    return `${(bps / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
  }

  function sparkPoints(hist: number[]): string {
    if (hist.length < 2) return "";
    return hist
      .map((v, i) => `${((i / (hist.length - 1)) * 60).toFixed(1)},${(22 - (v / sparkMax) * 20).toFixed(1)}`)
      .join(" ");
  }

  function truncateKey(key: string): string {
    return key.length > 20 ? `${key.slice(0, 12)}…${key.slice(-6)}` : key;
  }

  async function copyPubkey() {
    if (!appState.serverPubkey) return;
    await copyText(appState.serverPubkey);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  async function deletePeer(pubkey: string) {
    if (!confirm("Delete this peer?")) return;
    await fetch(`/api/peers/${encodeURIComponent(pubkey)}`, { method: "DELETE" });
  }

  function downloadConf(peer: any) {
    const blob = new Blob([peer.conf || ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${peer.name || 'client'}.conf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyIp(ip: string, e: Event) {
    e.stopPropagation();
    copyText(ip);
  }
</script>

<div class="space-y-4">
  <PageHeader title="WireGuard Clients" count={appState.peers.length}>
    {#snippet actions()}
      <div class="w-[220px]">
        <Input bind:value={search} placeholder="Filter clients, IP…" icon={Search} />
      </div>
      <button type="button" onclick={onOpenWgSettings} title="WireGuard Settings" class="btn-icon shrink-0">
        <Settings class="w-3.5 h-3.5" />
      </button>
      <Button variant="primary" onclick={onAddPeer}>
        <Plus class="w-3.5 h-3.5" />
        <span>Add Peer</span>
      </Button>
    {/snippet}
  </PageHeader>

  <!-- Peer List Surface -->
  {#if appState.peers.length === 0}
    <div class="surface">
      <EmptyState icon={Shield} title="No WireGuard peers" description="Add your first peer to connect a client.">
        {#snippet action()}
          <Button variant="primary" onclick={onAddPeer}>
            <Plus class="w-3.5 h-3.5" />
            <span>Add Peer</span>
          </Button>
        {/snippet}
      </EmptyState>
    </div>
  {:else if filteredPeers.length === 0}
    <div class="surface">
      <EmptyState icon={Search} title="No matching clients" description={`Nothing matches "${search}".`} />
    </div>
  {:else}
    <div class="surface overflow-hidden">
      <div class="divide-y divide-cream-200">
        {#each filteredPeers as peer}
          <div class="flex items-center justify-between px-3.5 py-2.5 hover:bg-cream-100/60 transition-colors group">
            <!-- Left: Status Indicator, Name & Handshake -->
            <div class="flex items-center gap-3 min-w-0 flex-1 mr-4">
              <!-- Online status dot indicator -->
              <div class="w-2 h-2 rounded-full shrink-0 {peer.online ? 'bg-emerald-500 ring-4 ring-emerald-100' : 'bg-stone-300'}"></div>

              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-std font-bold text-black truncate">{peer.name}</span>
                  {#if peer.online}
                    <span class="text-small font-mono text-emerald-700 font-medium">active</span>
                  {/if}
                </div>
                <div class="text-small text-stone-400 font-mono truncate mt-0.5">
                  {#if peer.lastHandshake && peer.lastHandshake !== "—"}
                    Handshake: {peer.lastHandshake}
                  {:else}
                    Never connected
                  {/if}
                  {#if peer.endpoint && peer.endpoint !== "—"}
                    · {peer.endpoint}
                  {/if}
                </div>
              </div>
            </div>

            <!-- Right: Assigned IP & Actions -->
            <div class="flex items-center gap-2 shrink-0">
              <!-- IP badge -->
              <button
                type="button"
                onclick={(e) => copyIp(peer.ip, e)}
                class="h-7 px-2 rounded hover:bg-cream-200 font-mono text-small text-stone-600 hover:text-black inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Click to copy IP"
              >
                <span>{peer.ip}</span>
                <Copy class="w-3 h-3 text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>

              <!-- Transfer info -->
              {#if peer.rx || peer.tx}
                <div class="hidden sm:flex items-center gap-1 font-mono text-small text-stone-400 mr-1">
                  <span>↓{peer.rx || '0B'}</span>
                  <span>↑{peer.tx || '0B'}</span>
                </div>
              {/if}

              <!-- Actions -->
              <div class="flex items-center">
                {#if onEditPeer}
                  <button
                    type="button"
                    onclick={() => onEditPeer(peer)}
                    class="btn-icon"
                    title="Edit Client"
                  >
                    <Pencil class="w-3.5 h-3.5" />
                  </button>
                {/if}

                <button
                  type="button"
                  onclick={() => onViewPeer(peer)}
                  class="btn-icon"
                  title="View QR Code & Config"
                >
                  <QrCode class="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onclick={() => downloadConf(peer)}
                  class="btn-icon"
                  title="Download .conf"
                >
                  <Download class="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onclick={() => deletePeer(peer.pubkey)}
                  class="btn-icon hover:text-red-600"
                  title="Delete"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
