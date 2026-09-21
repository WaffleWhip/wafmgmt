<script lang="ts">
  import { X } from "lucide-svelte";
  let { onClose, onSave, categories = [] }: { onClose: () => void; onSave: (service: any) => void; categories?: string[] } = $props();

  let name = $state("");
  let url = $state("");
  let icon = $state("");
  let category = $state("General");
  let desc = $state("");

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;
    onSave({ name, url, icon, category, desc });
    onClose();
  }
</script>

<div class="modal-overlay" onclick={onClose}>
  <div class="modal-card max-w-md w-full" onclick={(e) => e.stopPropagation()}>
    <div class="px-5 py-3 border-b border-cream-200 flex items-center justify-between">
      <h3 class="text-large font-bold text-black">Add Service Shortcut</h3>
      <button onclick={onClose} class="btn-icon"><X class="w-4 h-4" /></button>
    </div>

    <form onsubmit={handleSubmit} class="p-5 space-y-3">
      <div>
        <label for="app-name" class="label">App Name *</label>
        <input id="app-name" bind:value={name} placeholder="e.g. Grafana" required class="input input-bold" />
      </div>

      <div>
        <label for="app-url" class="label">URL *</label>
        <input id="app-url" bind:value={url} placeholder="https://grafana.example.com" required class="input font-mono" />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label for="app-icon" class="label">Icon URL (optional)</label>
          <input id="app-icon" bind:value={icon} placeholder="/icons/grafana.png" class="input text-std" />
        </div>
        <div>
          <label for="app-cat" class="label">Category</label>
          <input id="app-cat" bind:value={category} placeholder="Monitoring" class="input" />
        </div>
      </div>

      <div>
        <label for="app-desc" class="label">Description</label>
        <input id="app-desc" bind:value={desc} placeholder="Metrics and telemetry dashboard" class="input" />
      </div>

      <div class="pt-2 flex justify-end gap-2">
        <button type="button" onclick={onClose} class="btn btn-secondary">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Shortcut</button>
      </div>
    </form>
  </div>
</div>
