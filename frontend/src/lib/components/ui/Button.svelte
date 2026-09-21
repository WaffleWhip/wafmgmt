<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "icon";
  type Size = "sm" | "md" | "lg" | "icon";

  interface Props extends HTMLButtonAttributes {
    variant?: Variant;
    size?: Size;
    loading?: boolean;
    children?: Snippet;
    class?: string;
  }

  let {
    variant = "primary",
    size = "md",
    loading = false,
    children,
    class: className = "",
    type = "button",
    disabled = false,
    ...rest
  }: Props = $props();

  const baseStyles = "inline-flex items-center justify-center font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none outline-none shrink-0";

  const variants: Record<Variant, string> = {
    primary: "bg-black text-white hover:bg-stone-800",
    secondary: "bg-cream-100 text-stone-800 hover:bg-cream-200 border border-cream-300",
    outline: "bg-white text-stone-700 hover:bg-cream-100 border border-cream-300 hover:text-black",
    ghost: "text-stone-600 hover:text-black hover:bg-cream-100",
    danger: "bg-red-600 text-white hover:bg-red-700",
    icon: "text-stone-500 hover:text-black"
  };

  const sizes: Record<Size, string> = {
    sm: "h-7 px-2.5 text-small rounded gap-1",
    md: "h-8 px-3 text-std rounded-md gap-1.5",
    lg: "h-9 px-4 text-std rounded-md gap-2",
    icon: "w-7 h-7 p-0 rounded"
  };
</script>

<button
  {type}
  disabled={disabled || loading}
  class="{baseStyles} {variants[variant]} {size === 'icon' || variant === 'icon' ? sizes.icon : sizes[size]} {className}"
  {...rest}
>
  {#if loading}
    <span class="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
  {/if}
  {#if children}
    {@render children()}
  {/if}
</button>
