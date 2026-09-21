<script lang="ts">
  import { logout } from "$lib/auth.svelte";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { LogOut, Sun, Moon } from "lucide-svelte";

  let { activeTabName }: { activeTabName: string } = $props();

  let dark = $state(false);

  onMount(() => {
    dark = document.documentElement.classList.contains("dark");
  });

  function toggleTheme() {
    dark = !dark;
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {}
  }

  function handleLogout() {
    logout();
    goto("/", { replaceState: true });
  }
</script>

<header class="topbar">
  <div class="topbar-title">{activeTabName}</div>

  <div class="ml-auto flex items-center gap-2">
    <button
      type="button"
      onclick={toggleTheme}
      class="btn-icon"
      title={dark ? "Light mode" : "Dark mode"}
    >
      {#if dark}
        <Sun class="w-4 h-4" />
      {:else}
        <Moon class="w-4 h-4" />
      {/if}
    </button>

    <button
      type="button"
      onclick={handleLogout}
      class="h-7 px-2 rounded hover:bg-cream-100 text-stone-500 hover:text-red-600 inline-flex items-center gap-1.5 text-std font-semibold transition-colors cursor-pointer"
      title="Sign Out"
    >
      <LogOut class="w-3.5 h-3.5" />
      <span>Sign out</span>
    </button>
  </div>
</header>

<style>
  .topbar {
    height: 3rem;
    border-bottom: 1px solid var(--border-base);
    background-color: var(--bg-base);
    padding: 0 1.5rem;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
  .topbar-title {
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--text-base);
    letter-spacing: -0.01em;
  }
</style>
