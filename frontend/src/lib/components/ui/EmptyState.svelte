<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    icon?: any;
    title: string;
    description?: string;
    action?: Snippet;
  }

  let { icon: Icon = null, title, description = "", action }: Props = $props();
</script>

<div class="py-12 text-center">
  {#if Icon}
    <Icon class="w-6 h-6 text-stone-400 mx-auto mb-2" />
  {/if}
  <p class="text-std font-semibold text-stone-700">{title}</p>
  {#if description}
    <p class="text-std text-stone-500 mt-0.5">{description}</p>
  {/if}
  {#if action}
    <div class="mt-2">{@render action()}</div>
  {/if}
</div>
