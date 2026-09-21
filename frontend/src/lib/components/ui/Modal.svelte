<script lang="ts">
  import type { Snippet } from "svelte";
  import { X } from "lucide-svelte";
  import Button from "./Button.svelte";

  interface Props {
    title: string;
    subtitle?: string;
    maxWidth?: string;
    onClose: () => void;
    children?: Snippet;
    footer?: Snippet;
  }

  let {
    title,
    subtitle = "",
    maxWidth = "max-w-md",
    onClose,
    children,
    footer
  }: Props = $props();
</script>

<div class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
  <div class="w-full {maxWidth} bg-white border border-cream-300 rounded-lg flex flex-col max-h-[90vh] overflow-hidden">
    <!-- Header -->
    <div class="px-5 py-3 border-b border-cream-300 flex items-center justify-between shrink-0 bg-white">
      <div>
        <h3 class="text-large font-bold text-black">{title}</h3>
        {#if subtitle}
          <p class="text-small text-stone-500 mt-0.5">{subtitle}</p>
        {/if}
      </div>
      <Button variant="ghost" size="icon" onclick={onClose} title="Close">
        <X class="w-4 h-4" />
      </Button>
    </div>

    <!-- Body -->
    <div class="p-5 overflow-y-auto space-y-3.5">
      {#if children}
        {@render children()}
      {/if}
    </div>

    <!-- Footer -->
    {#if footer}
      <div class="px-5 py-3 border-t border-cream-200 bg-cream-50/50 flex items-center justify-end gap-2 shrink-0">
        {@render footer()}
      </div>
    {/if}
  </div>
</div>
