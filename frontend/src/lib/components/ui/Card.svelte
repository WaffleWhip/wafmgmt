<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title?: string;
    description?: string;
    action?: Snippet;
    children?: Snippet;
    footer?: Snippet;
    class?: string;
  }

  let {
    title = "",
    description = "",
    action,
    children,
    footer,
    class: className = ""
  }: Props = $props();
</script>

<div class="bg-white border border-cream-300 rounded-lg overflow-hidden {className}">
  {#if title || action}
    <div class="px-4 py-3 border-b border-cream-300 flex items-center justify-between">
      <div>
        {#if title}
          <h3 class="text-std font-bold text-black">{title}</h3>
        {/if}
        {#if description}
          <p class="text-small text-stone-500 mt-0.5">{description}</p>
        {/if}
      </div>
      {#if action}
        <div class="flex items-center gap-2">
          {@render action()}
        </div>
      {/if}
    </div>
  {/if}

  {#if children}
    <div class="p-4">
      {@render children()}
    </div>
  {/if}

  {#if footer}
    <div class="px-4 py-2.5 border-t border-cream-200 bg-cream-50/50 flex items-center justify-end gap-2">
      {@render footer()}
    </div>
  {/if}
</div>
