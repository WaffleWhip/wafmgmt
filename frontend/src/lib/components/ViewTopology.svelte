<script lang="ts">
  import { appState } from "$lib/store.svelte";
  import { Plus, Trash2, Network } from "lucide-svelte";
  import PageHeader from "$lib/components/ui/PageHeader.svelte";
  import StatCard from "$lib/components/ui/StatCard.svelte";
  import Card from "$lib/components/ui/Card.svelte";
  import FormField from "$lib/components/ui/FormField.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";

  let routeName = $state("");
  let routeSubnet = $state("");
  let routeDesc = $state("");

  const defaultCount = $derived(appState.routes.filter((r) => r.isDefault).length);

  async function addRoute() {
    if (!routeSubnet) return;
    await fetch("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: routeName || "Subnet", subnet: routeSubnet, desc: routeDesc, isDefault: true })
    });
    routeName = ""; routeSubnet = ""; routeDesc = "";
  }

  async function deleteRoute(id: string) {
    if (!confirm("Remove this subnet route?")) return;
    await fetch(`/api/routes/${id}`, { method: "DELETE" });
  }
</script>

<div class="space-y-4">
  <PageHeader title="Subnet Routes" count={appState.routes.length} />

  <div class="grid grid-cols-2 gap-3">
    <StatCard label="Subnet Routes" value={appState.routes.length} icon={Network} />
    <StatCard label="In VPN AllowedIPs" value={defaultCount} suffix={`/ ${appState.routes.length}`} icon={Plus} />
  </div>

  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
    <div class="md:col-span-2 surface overflow-x-auto">
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>CIDR Subnet</th>
            <th>Description</th>
            <th class="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#if appState.routes.length === 0}
            <tr>
              <td colspan="4">
                <EmptyState icon={Network} title="No subnets configured" description="Add a subnet to advertise it through the VPN." />
              </td>
            </tr>
          {:else}
            {#each appState.routes as r}
              <tr>
                <td class="font-bold text-black">{r.name}</td>
                <td class="font-mono font-bold text-accent-700">{r.subnet}</td>
                <td class="text-stone-600">{r.desc || "—"}</td>
                <td class="text-right">
                  <button onclick={() => deleteRoute(r.id)} title="Delete" class="btn-icon hover:text-red-600">
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>

    <Card title="Add Subnet Route" class="self-start">
      <div class="space-y-3">
        <FormField label="Subnet Name" id="topo-name">
          <Input id="topo-name" bind:value={routeName} placeholder="e.g. DMZ Subnet" class="input-bold" />
        </FormField>
        <FormField label="CIDR Notation" id="topo-subnet">
          <Input id="topo-subnet" bind:value={routeSubnet} placeholder="e.g. 192.168.41.0/24" class="font-mono font-bold text-accent-700" />
        </FormField>
        <FormField label="Description" id="topo-desc">
          <Input id="topo-desc" bind:value={routeDesc} placeholder="e.g. Lab Backend" />
        </FormField>
        <Button variant="primary" class="w-full" onclick={addRoute} disabled={!routeSubnet.trim()}>
          <span>Add Route</span>
        </Button>
      </div>
    </Card>
  </div>
</div>
