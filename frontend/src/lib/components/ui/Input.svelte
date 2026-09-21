<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLInputAttributes } from "svelte/elements";

  interface Props extends HTMLInputAttributes {
    value?: any;
    icon?: any;
    class?: string;
  }

  let {
    value = $bindable(""),
    icon: Icon = null,
    class: className = "",
    type = "text",
    placeholder = "",
    disabled = false,
    ...rest
  }: Props = $props();
</script>

<div class="relative w-full">
  {#if Icon}
    <div class="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-stone-400 flex items-center justify-center">
      <Icon class="w-3.5 h-3.5" />
    </div>
  {/if}
  <input
    {type}
    bind:value
    {placeholder}
    {disabled}
    class="w-full h-8 {Icon ? 'pl-8' : 'px-2.5'} pr-2.5 text-std bg-cream-50 border border-cream-300 rounded-md outline-none focus:border-stone-800 transition-colors disabled:opacity-50 disabled:bg-cream-100 {className}"
    {...rest}
  />
</div>
