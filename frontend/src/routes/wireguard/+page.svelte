<script lang="ts">
  import ViewWireguard from "$lib/components/ViewWireguard.svelte";
  import ModalAddPeer from "$lib/components/ModalAddPeer.svelte";
  import ModalPeerDetail from "$lib/components/ModalPeerDetail.svelte";
  import ModalWgSettings from "$lib/components/ModalWgSettings.svelte";

  let showAddPeer = $state(false);
  let editingPeer = $state<any>(null);
  let selectedPeer = $state<any>(null);
  let showWgSettings = $state(false);
</script>

<ViewWireguard
  onAddPeer={() => { editingPeer = null; showAddPeer = true; }}
  onEditPeer={(peer) => { editingPeer = peer; showAddPeer = true; }}
  onViewPeer={(peer) => (selectedPeer = peer)}
  onOpenWgSettings={() => (showWgSettings = true)}
/>

{#if showAddPeer}
  <ModalAddPeer onClose={() => { showAddPeer = false; editingPeer = null; }} edit={editingPeer} />
{/if}

{#if selectedPeer}
  <ModalPeerDetail peer={selectedPeer} onClose={() => (selectedPeer = null)} />
{/if}

{#if showWgSettings}
  <ModalWgSettings onClose={() => (showWgSettings = false)} />
{/if}
