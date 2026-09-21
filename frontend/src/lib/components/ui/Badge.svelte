<script lang="ts">
  import type { Snippet } from "svelte";

  type Variant = "muted" | "dark" | "success" | "danger";

  interface Props {
    variant?: Variant;
    class?: string;
    children?: Snippet;
  }

  let { variant = "muted", class: className = "", children }: Props = $props();

  const variants: Record<Variant, string> = {
    muted: "bg-cream-200 text-stone-700",
    dark: "bg-black text-white",
    success: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    danger: "bg-red-50 text-red-700 border border-red-200"
  };
</script>

<span class="inline-flex items-center px-2 py-0.5 rounded text-small font-semibold font-mono {variants[variant]} {className}">
  {#if children}{@render children()}{/if}
</span>
