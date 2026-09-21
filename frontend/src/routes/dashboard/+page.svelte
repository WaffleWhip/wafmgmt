<script lang="ts">
  import { goto } from "$app/navigation";
  import type { Device } from "$lib/api/devices";
  import TableDevices from "$lib/components/TableDevices.svelte";

  function openTerminalFor(device: Device) {
    goto(`/terminal?deviceId=${encodeURIComponent(device.id)}`);
  }
</script>

<div class="h-full w-full">
  <TableDevices onOpenTerminal={openTerminalFor} />
</div>
