<script lang="ts">
  import ViewProxy from "$lib/components/ViewProxy.svelte";
  import ModalNginxRoute from "$lib/components/ModalNginxRoute.svelte";
  import ModalNginxRaw from "$lib/components/ModalNginxRaw.svelte";

  let showAddRoute = $state(false);
  let editingRoute = $state<any>(null);
  let showNginxRaw = $state(false);
</script>

<ViewProxy
  onAddRoute={() => { editingRoute = null; showAddRoute = true; }}
  onEditRoute={(route) => { editingRoute = route; showAddRoute = true; }}
  onOpenRaw={() => (showNginxRaw = true)}
/>

{#if showAddRoute}
  <ModalNginxRoute
    edit={editingRoute}
    onClose={() => { showAddRoute = false; editingRoute = null; }}
    onSaved={() => { showAddRoute = false; editingRoute = null; }}
  />
{/if}

{#if showNginxRaw}
  <ModalNginxRaw onClose={() => (showNginxRaw = false)} />
{/if}
