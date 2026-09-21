<script lang="ts">
  import { appState } from "$lib/store.svelte";
  import { X, Save } from "lucide-svelte";
  let { onClose }: { onClose: () => void } = $props();

  let endpointWan = $state(appState.config.endpointWan || "");
  let dnsDefault = $state(appState.config.dnsDefault || "");
  let address = $state(appState.config.address || "");
  let allowedIpsTemplate = $state(appState.config.allowedIpsTemplate || "");
  let saving = $state(false);

  async function handleSave(e: Event) {
    e.preventDefault();
    saving = true;
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpointWan, dnsDefault, address, allowedIpsTemplate })
    });
    saving = false;
    onClose();
  }
</script>

<div class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
  <div class="w-full max-w-md bg-white border border-cream-300 rounded-lg">
    <div class="px-5 py-3 border-b border-cream-300 flex items-center justify-between">
      <h3 class="text-large font-bold text-black">WireGuard Server Settings</h3>
      <button onclick={onClose} class="btn-icon"><X class="w-4 h-4" /></button>
    </div>

    <form onsubmit={handleSave} class="p-5 space-y-3.5 text-std">
      <div>
        <label for="wg-endpoint" class="block font-semibold text-stone-700 mb-1">Server Endpoint WAN (IP / Domain:Port) *</label>
        <input id="wg-endpoint" bind:value={endpointWan} placeholder="vpn.example.com:51820" required class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std font-mono outline-none focus:border-stone-800" />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label for="wg-addr" class="block font-semibold text-stone-700 mb-1">Server Gateway IP</label>
          <input id="wg-addr" bind:value={address} placeholder="10.8.0.1/24" class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std font-mono outline-none focus:border-stone-800" />
        </div>
        <div>
          <label for="wg-dns" class="block font-semibold text-stone-700 mb-1">Client Default DNS</label>
          <input id="wg-dns" bind:value={dnsDefault} placeholder="10.8.0.1" class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std font-mono outline-none focus:border-stone-800" />
        </div>
      </div>

      <div>
        <label for="wg-allowed" class="block font-semibold text-stone-700 mb-1">Client Default Allowed IPs</label>
        <input id="wg-allowed" bind:value={allowedIpsTemplate} placeholder="10.8.0.0/24" class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std font-mono outline-none focus:border-stone-800" />
      </div>

      <div class="pt-3 flex justify-end gap-2 border-t border-cream-200">
        <button type="button" onclick={onClose} class="px-3 py-1.5 text-std text-stone-600 hover:text-black cursor-pointer rounded">Cancel</button>
        <button type="submit" disabled={saving} class="px-3.5 py-1.5 text-std bg-black hover:bg-stone-800 text-white font-semibold rounded cursor-pointer disabled:opacity-50">
          <span>{saving ? 'Saving...' : 'Save Settings'}</span>
        </button>
      </div>
    </form>
  </div>
</div>
