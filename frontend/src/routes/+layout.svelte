<script lang="ts">
  import '../app.css';
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { appState, initSSE, loadRegistry } from "$lib/store.svelte";
  import NavSidebar from "$lib/components/NavSidebar.svelte";
  import NavTopbar from "$lib/components/NavTopbar.svelte";

  import { authState } from "$lib/auth.svelte";
  import { goto } from "$app/navigation";

  let { children } = $props();

  let isPublicPage = $derived($page.url.pathname === "/");

  const tabTitles: Record<string, string> = {
    "/": "Sign In",
    "/dashboard": "Dashboard",
    "/terminal": "Terminal",
    "/wireguard": "WireGuard",
    "/nginx": "Nginx Proxy",
    "/usp": "USP Controller",
    "/routes": "Routes",
    "/users": "Users",
    "/settings": "Settings"
  };

  const adminOnlyPaths = ["/terminal", "/wireguard", "/nginx", "/routes", "/users", "/settings", "/database"];

  let pageTitle = $derived(tabTitles[$page.url.pathname] || "Dashboard");

  $effect(() => {
    if (!isPublicPage && !authState.isLoggedIn) {
      goto("/", { replaceState: true });
    } else if (
      !isPublicPage &&
      authState.isLoggedIn &&
      authState.user.role !== "admin"
    ) {
      let allowedPaths: string[] = [];
      const perms = authState.user.permissions;
      if (Array.isArray(perms)) allowedPaths = perms;
      else if (typeof perms === "string") {
        try { allowedPaths = JSON.parse(perms); } catch {}
      }

      const isRestricted = adminOnlyPaths.some(p => $page.url.pathname === p || $page.url.pathname.startsWith(p + "/"));
      const isExplicitlyAllowed = allowedPaths.some(p => $page.url.pathname === p || $page.url.pathname.startsWith(p + "/"));

      if (isRestricted && !isExplicitlyAllowed) {
        goto("/dashboard", { replaceState: true });
      }
    }
  });

  onMount(() => {
    initSSE();
    loadRegistry();
  });
</script>

<svelte:head>
  <title>{appState.config.brandName || 'BAN'} - {pageTitle}</title>
  <link rel="icon" href={appState.config.logoUrl || '/logo/logo.png'} />
</svelte:head>

{#if isPublicPage}
  {@render children()}
{:else}
  <div class="app-shell">
    <NavSidebar />

    <div class="app-main">
      <NavTopbar activeTabName={pageTitle} />

      <main class="app-content {$page.url.pathname === '/terminal' ? '!p-0 overflow-hidden' : ''}">
        <div class="w-full h-full">
          {@render children()}
        </div>
      </main>
    </div>
  </div>
{/if}

<style>
  .app-shell {
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    display: flex;
  }
  .app-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    border-left: 1px solid var(--color-cream-300);
  }
  .app-content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }
</style>
