<script lang="ts">
  import { X } from "lucide-svelte";
  let { onClose, onSave }: { onClose: () => void; onSave: (route: any) => void } = $props();

  let name = $state("");
  let subnet = $state("");
  let desc = $state("");
  let isDefault = $state(true);

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (!name.trim() || !subnet.trim()) return;
    onSave({ name, subnet, desc, isDefault });
    onClose();
  }
</script>

<div class="modal-overlay" onclick={onClose}>
  <div class="modal-card max-w-md w-full" onclick={(e) => e.stopPropagation()}>
    <div class="px-5 py-3 border-b border-cream-200 flex items-center justify-between">
      <h3 class="text-large font-bold text-black">Add Subnet Route</h3>
      <button onclick={onClose} class="btn-icon"><X class="w-4 h-4" /></button>
    </div>

    <form onsubmit={handleSubmit} class="p-5 space-y-3">
      <div>
        <label for="route-name" class="label">Route Name *</label>
        <input id="route-name" bind:value={name} placeholder="e.g. Lab VLAN 41" required class="input input-bold" />
      </div>

      <div>
        <label for="route-subnet" class="label">Subnet (CIDR) *</label>
        <input id="route-subnet" bind:value={subnet} placeholder="192.168.41.0/24" required class="input font-mono" />
      </div>

      <div>
        <label for="route-desc" class="label">Description</label>
        <input id="route-desc" bind:value={desc} placeholder="Device testing environment" class="input" />
      </div>

      <div class="pt-2 flex justify-end gap-2">
        <button type="button" onclick={onClose} class="btn btn-secondary">Cancel</button>
        <button type="submit" class="btn btn-primary">Add Route</button>
      </div>
    </form>
  </div>
</div>
