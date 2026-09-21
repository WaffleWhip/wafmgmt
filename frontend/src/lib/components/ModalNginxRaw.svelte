<script lang="ts">
  import { onMount } from "svelte";
  import { X, Save } from "lucide-svelte";
  let { onClose }: { onClose: () => void } = $props();

  let raw = $state("");
  let saving = $state(false);

  onMount(async () => {
    const res = await fetch("/api/nginx/raw");
    const data = await res.json();
    raw = data.raw || "";
  });

  async function saveRaw() {
    saving = true;
    await fetch("/api/nginx/raw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw })
    });
    saving = false;
    onClose();
  }
</script>

<div class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
  <div class="w-full max-w-2xl bg-white border border-cream-300 rounded-lg">
    <div class="px-5 py-3 border-b border-cream-300 flex items-center justify-between">
      <h3 class="text-large font-bold text-black">Raw Nginx Config Editor</h3>
      <button onclick={onClose} class="btn-icon"><X class="w-4 h-4" /></button>
    </div>
    <div class="p-5">
      <textarea bind:value={raw} rows="14" class="w-full p-4 bg-white border border-cream-300 focus:border-accent-600 outline-none text-std text-black resize-none rounded-md"></textarea>
    </div>
    <div class="px-5 py-3 border-t border-cream-300 flex items-center justify-end gap-2 text-std">
      <button onclick={onClose} class="px-3 py-1.5 text-stone-600 hover:text-black cursor-pointer rounded-md">Cancel</button>
      <button onclick={saveRaw} disabled={saving} class="flex items-center gap-1.5 px-4 py-1.5 bg-black hover:bg-accent-600 text-white font-semibold cursor-pointer rounded-md disabled:opacity-50">
        <Save class="w-3.5 h-3.5" />
        <span>{saving ? 'Reloading...' : 'Save & Reload'}</span>
      </button>
    </div>
  </div>
</div>
