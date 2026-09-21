<script lang="ts">
  import { X, Download, Copy, Check } from "lucide-svelte";
  import { copyText } from "$lib/clipboard";
  let { peer, onClose }: { peer: any; onClose: () => void } = $props();

  let copied = $state(false);

  function copyConf() {
    copyText(peer.conf || "");
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  function downloadConf() {
    const blob = new Blob([peer.conf || ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${peer.name || 'client'}.conf`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
  <div class="w-full max-w-lg bg-white border border-cream-300 rounded-lg">
    <div class="px-5 py-3 border-b border-cream-300 flex items-center justify-between">
      <div class="flex items-center space-x-2">
        <h3 class="text-large font-bold text-black">{peer.name}</h3>
        <span class="px-1.5 py-0.2 rounded text-small font-mono bg-cream-200 text-stone-700">{peer.ip}</span>
      </div>
      <button onclick={onClose} class="btn-icon"><X class="w-4 h-4" /></button>
    </div>

    <div class="p-5 space-y-4 text-std">
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <label class="block font-semibold text-stone-700" for="raw-conf">WireGuard Configuration</label>
          <div class="flex items-center space-x-1.5">
            <button onclick={copyConf} class="px-2 py-1 rounded border border-cream-300 bg-white hover:bg-cream-100 text-small font-medium text-stone-700 cursor-pointer inline-flex items-center gap-1">
              {#if copied}
                <Check class="w-3 h-3 text-black" />
                <span>Copied</span>
              {:else}
                <Copy class="w-3 h-3" />
                <span>Copy</span>
              {/if}
            </button>
            <button onclick={downloadConf} class="px-2 py-1 rounded border border-cream-300 bg-white hover:bg-cream-100 text-small font-medium text-stone-700 cursor-pointer inline-flex items-center gap-1">
              <Download class="w-3 h-3" />
              <span>Download .conf</span>
            </button>
          </div>
        </div>
        <textarea id="raw-conf" readonly rows={8} class="w-full p-3 bg-stone-950 text-emerald-400 font-mono text-std rounded border border-stone-800 outline-none resize-none" value={peer.conf || ""}></textarea>
      </div>
    </div>

    <div class="px-5 py-3 border-t border-cream-200 flex justify-end">
      <button onclick={onClose} class="px-3.5 py-1.5 text-std bg-black hover:bg-stone-800 text-white font-semibold rounded cursor-pointer">Close</button>
    </div>
  </div>
</div>
