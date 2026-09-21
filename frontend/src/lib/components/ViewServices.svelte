<script lang="ts">
  import { appState } from "$lib/store.svelte";
  import { Plus, Trash2, ExternalLink, Globe } from "lucide-svelte";
  import PageHeader from "$lib/components/ui/PageHeader.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Badge from "$lib/components/ui/Badge.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";

  let { onAddApp }: { onAddApp: () => void } = $props();

  async function deleteService(id: string) {
    if (!confirm("Delete this shortcut?")) return;
    await fetch(`/api/services/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
</script>

<div class="space-y-4">
  <PageHeader title="Service Shortcuts" count={appState.services.length}>
    {#snippet actions()}
      <Button variant="primary" onclick={onAddApp}>
        <Plus class="w-3.5 h-3.5" />
        <span>Add Service</span>
      </Button>
    {/snippet}
  </PageHeader>

  {#if appState.services.length === 0}
    <div class="surface">
      <EmptyState icon={Globe} title="No service shortcuts" description="Add quick-access links to your applications." />
    </div>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
      {#each appState.services as s}
        <div class="group surface p-4 hover:border-accent-600/40 transition-colors flex flex-col justify-between">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 rounded-md bg-cream-100 border border-cream-200 flex items-center justify-center shrink-0">
                {#if s.icon}
                  <img src={s.icon} alt={s.name} class="w-5 h-5 object-contain" />
                {:else}
                  <Globe class="w-4 h-4 text-stone-500" />
                {/if}
              </div>
              <div class="min-w-0">
                <h3 class="font-bold text-large text-black truncate">{s.name}</h3>
                <Badge variant="muted">{s.category || "General"}</Badge>
              </div>
            </div>
            <button onclick={() => deleteService(s.id)} class="btn-icon opacity-0 group-hover:opacity-100 hover:text-accent-600">
              <Trash2 class="w-3.5 h-3.5" />
            </button>
          </div>

          {#if s.desc}
            <p class="text-std text-stone-500 mt-2 line-clamp-2">{s.desc}</p>
          {/if}

          <div class="mt-4 pt-2 border-t border-cream-200 flex items-center justify-between">
            <a href={s.url} target="_blank" rel="noreferrer" class="btn-link text-small p-0 inline-flex items-center gap-1">
              <span>Open</span>
              <ExternalLink class="w-3 h-3" />
            </a>
            <Badge variant="dark">Online</Badge>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
