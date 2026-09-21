<script lang="ts">
  import { ChevronDown, Check } from "lucide-svelte";

  interface OptionItem {
    value: string;
    label: string;
    sublabel?: string;
    badge?: string;
  }

  let {
    value = $bindable(""),
    options = [],
    placeholder = "Select option",
    label = "",
    disabled = false,
    className = ""
  }: {
    value: string;
    options: OptionItem[];
    placeholder?: string;
    label?: string;
    disabled?: boolean;
    className?: string;
  } = $props();

  let open = $state(false);
  let containerRef: HTMLDivElement | null = null;

  const selectedOption = $derived(options.find((o) => o.value === value));

  function selectOption(optVal: string) {
    value = optVal;
    open = false;
  }

  function handleOutsideClick(e: MouseEvent) {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      open = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") open = false;
  }

  $effect(() => {
    if (open) {
      document.addEventListener("click", handleOutsideClick, true);
      document.addEventListener("keydown", handleKeydown);
      return () => {
        document.removeEventListener("click", handleOutsideClick, true);
        document.removeEventListener("keydown", handleKeydown);
      };
    }
  });
</script>

<div class="relative inline-block text-left {className}" bind:this={containerRef}>
  <button
    type="button"
    onclick={() => { if (!disabled) open = !open; }}
    {disabled}
    class="select-trigger {open ? 'select-trigger-open' : ''}"
  >
    <div class="flex items-center gap-1.5 truncate text-left">
      {#if label}
        <span class="text-stone-500 font-normal text-small select-none">{label}</span>
      {/if}
      {#if selectedOption}
        <span class="text-black font-bold truncate">{selectedOption.label}</span>
        {#if selectedOption.badge}
          <span class="px-1.5 py-0.2 rounded text-small font-bold bg-cream-200 text-stone-700">
            {selectedOption.badge}
          </span>
        {/if}
      {:else}
        <span class="text-stone-400 font-normal">{placeholder}</span>
      {/if}
    </div>
    <ChevronDown class="w-3.5 h-3.5 text-stone-500 shrink-0 transition-transform duration-150 {open ? 'rotate-180 text-black' : ''}" />
  </button>

  {#if open}
    <div
      class="absolute right-0 z-50 mt-1 min-w-[14rem] max-w-xs w-max bg-white border border-cream-300 rounded-md overflow-hidden py-1 max-h-60 overflow-y-auto text-std"
    >
      {#if options.length === 0}
        <div class="px-3 py-2 text-stone-400 italic text-small">No options available</div>
      {:else}
        {#each options as opt (opt.value)}
          {@const isSelected = opt.value === value}
          <button
            type="button"
            onclick={() => selectOption(opt.value)}
            class="w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition cursor-pointer
              {isSelected ? 'bg-cream-100 font-bold text-black' : 'text-stone-800 hover:bg-cream-50'}"
          >
            <div class="truncate flex flex-col">
              <div class="flex items-center gap-1.5 truncate">
                <span class="truncate">{opt.label}</span>
                {#if opt.badge}
                  <span class="px-1.5 py-0.2 rounded text-small font-bold bg-cream-200 text-stone-600">
                    {opt.badge}
                  </span>
                {/if}
              </div>
              {#if opt.sublabel}
                <span class="text-small text-stone-400 font-normal truncate">{opt.sublabel}</span>
              {/if}
            </div>
            {#if isSelected}
              <Check class="w-3.5 h-3.5 text-black shrink-0" />
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>
