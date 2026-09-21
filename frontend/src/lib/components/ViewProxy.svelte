<script lang="ts">
  import { appState } from "$lib/store.svelte";
  import { Plus, Trash2, FileCode, Search, Globe, Pencil } from "lucide-svelte";
  import PageHeader from "$lib/components/ui/PageHeader.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import Badge from "$lib/components/ui/Badge.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";

  let {
    onAddRoute,
    onEditRoute,
    onOpenRaw
  }: {
    onAddRoute: () => void;
    onEditRoute?: (route: any) => void;
    onOpenRaw: () => void;
  } = $props();

  let search = $state("");

  const filteredRoutes = $derived(
    appState.nginxRoutes.filter((r) =>
      `${r.domain} ${r.upstream} ${r.desc}`.toLowerCase().includes(search.trim().toLowerCase())
    )
  );

  async function deleteRoute(id: string) {
    if (!confirm("Delete this proxy route?")) return;
    await fetch(`/api/nginx/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
</script>

<div class="space-y-4">
  <PageHeader title="Proxy Routes" count={appState.nginxRoutes.length}>
    {#snippet actions()}
      <div class="w-[220px]">
        <Input bind:value={search} placeholder="Filter domain, upstream…" icon={Search} />
      </div>
      <Button variant="outline" onclick={onOpenRaw} title="View Nginx Config">
        <FileCode class="w-3.5 h-3.5" />
        <span>Nginx Config</span>
      </Button>
      <Button variant="primary" onclick={onAddRoute}>
        <Plus class="w-3.5 h-3.5" />
        <span>Add Route</span>
      </Button>
    {/snippet}
  </PageHeader>

  {#if appState.nginxRoutes.length === 0}
    <div class="surface">
      <EmptyState icon={Globe} title="No proxy routes" description="Create your first reverse proxy route.">
        {#snippet action()}
          <Button variant="primary" onclick={onAddRoute}>
            <Plus class="w-3.5 h-3.5" />
            <span>Add Route</span>
          </Button>
        {/snippet}
      </EmptyState>
    </div>
  {:else if filteredRoutes.length === 0}
    <div class="surface">
      <EmptyState icon={Search} title="No matching routes" description={`Nothing matches "${search}".`} />
    </div>
  {:else}
    <div class="surface overflow-hidden">
      <div class="divide-y divide-cream-200">
        {#each filteredRoutes as r}
          <div class="flex items-center justify-between px-3.5 py-2.5 hover:bg-cream-50 transition-colors">
            <div class="min-w-0 flex-1 mr-4">
              <div class="flex items-center gap-2">
                <span class="text-std font-bold text-black font-mono truncate">{r.domain}</span>
                <Badge variant={r.enabled ? "dark" : "muted"}>{r.enabled ? "active" : "disabled"}</Badge>
                {#if r.tlsInternal}
                  <Badge variant="muted">internal tls</Badge>
                {/if}
              </div>
              <div class="text-small text-stone-500 font-mono truncate mt-0.5">
                {r.upstream}{#if r.desc} <span class="text-stone-400">· {r.desc}</span>{/if}
              </div>
            </div>

            <div class="flex items-center gap-1 shrink-0">
              {#if onEditRoute}
                <button type="button" onclick={() => onEditRoute(r)} class="btn-icon" title="Edit Route">
                  <Pencil class="w-3.5 h-3.5" />
                </button>
              {/if}
              <button type="button" onclick={() => deleteRoute(r.id)} class="btn-icon hover:text-red-600" title="Delete Route">
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
