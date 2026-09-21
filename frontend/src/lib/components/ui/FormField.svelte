<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    label?: string;
    id?: string;
    required?: boolean;
    hint?: string;
    error?: string | null;
    children?: Snippet;
    class?: string;
  }

  let {
    label = "",
    id = "",
    required = false,
    hint = "",
    error = null,
    children,
    class: className = ""
  }: Props = $props();
</script>

<div class="space-y-1.5 {className}">
  {#if label}
    <div class="flex items-center justify-between">
      <label for={id} class="text-std font-semibold text-stone-600">
        {label}
        {#if required}
          <span class="text-red-500 ml-0.5">*</span>
        {/if}
      </label>
      {#if hint}
        <span class="text-small text-stone-400 font-normal">{hint}</span>
      {/if}
    </div>
  {/if}

  {#if children}
    {@render children()}
  {/if}

  {#if error}
    <p class="text-small text-red-600 font-medium">{error}</p>
  {/if}
</div>
