<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    count?: number | string;
    actions?: Snippet;
  }

  let { title, count, actions }: Props = $props();
</script>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-cream-300">
  <div class="flex items-baseline gap-2 min-w-0">
    <h1 class="text-large font-bold text-black tracking-tight truncate">{title}</h1>
    {#if count !== undefined}
      <span class="text-std text-stone-400 font-mono shrink-0">({count})</span>
    {/if}
  </div>
  {#if actions}
    <div class="flex items-center gap-2">
      {@render actions()}
    </div>
  {/if}
</div>
