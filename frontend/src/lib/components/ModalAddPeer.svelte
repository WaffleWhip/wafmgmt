<script lang="ts">
  import { X } from "lucide-svelte";
  let { onClose, edit = null }: { onClose: () => void; edit?: any } = $props();

  let name = $state(edit?.name || "");
  let ip = $state(edit?.ip || "");
  let dns = $state(edit?.dns || "");
  let allowedIps = $state(edit?.allowedIps || "");
  let saving = $state(false);

  async function handleSave(e: Event) {
    e.preventDefault();
    if (!name.trim()) return;
    saving = true;
    try {
      if (edit) {
        await fetch(`/api/peers/${encodeURIComponent(edit.pubkey)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, ip, dns, allowedIps, isEdit: true })
        });
      } else {
        await fetch("/api/peers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, ip, dns, allowedIps })
        });
      }
      onClose();
    } catch {}
    saving = false;
  }
</script>

<div class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
  <div class="w-full max-w-md bg-white border border-cream-300 rounded-lg">
    <div class="px-5 py-3 border-b border-cream-300 flex items-center justify-between">
      <h3 class="text-large font-bold text-black">{edit ? 'Edit Client' : 'Add WireGuard Client'}</h3>
      <button onclick={onClose} class="btn-icon"><X class="w-4 h-4" /></button>
    </div>

    <form onsubmit={handleSave} class="p-5 space-y-3.5 text-std">
      <div>
        <label for="peer-name" class="block font-semibold text-stone-700 mb-1">Client Name *</label>
        <input id="peer-name" bind:value={name} placeholder="e.g. Laptop-Wahyu" required class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std outline-none focus:border-stone-800" />
      </div>

      <div>
        <label for="peer-ip" class="block font-semibold text-stone-700 mb-1">Virtual IP (optional auto-assign)</label>
        <input id="peer-ip" bind:value={ip} placeholder="10.8.0.2/32" class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std font-mono outline-none focus:border-stone-800" />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label for="peer-dns" class="block font-semibold text-stone-700 mb-1">DNS</label>
          <input id="peer-dns" bind:value={dns} placeholder="10.8.0.1" class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std font-mono outline-none focus:border-stone-800" />
        </div>
        <div>
          <label for="peer-allowed" class="block font-semibold text-stone-700 mb-1">Allowed IPs</label>
          <input id="peer-allowed" bind:value={allowedIps} placeholder="10.8.0.0/24" class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std font-mono outline-none focus:border-stone-800" />
        </div>
      </div>

      <div class="pt-3 flex justify-end gap-2 border-t border-cream-200">
        <button type="button" onclick={onClose} class="px-3 py-1.5 text-std text-stone-600 hover:text-black cursor-pointer rounded">Cancel</button>
        <button type="submit" disabled={saving} class="px-3.5 py-1.5 text-std bg-black hover:bg-stone-800 text-white font-semibold rounded cursor-pointer disabled:opacity-50">
          {saving ? 'Saving...' : edit ? 'Save Changes' : 'Generate Client'}
        </button>
      </div>
    </form>
  </div>
</div>
