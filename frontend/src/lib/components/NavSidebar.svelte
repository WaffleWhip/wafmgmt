<script lang="ts">
  import { page } from "$app/stores";
  import { fly } from "svelte/transition";
  import { appState } from "$lib/store.svelte";
  import {
    LayoutGrid, Shield, Globe, Network, Radio, Bot,
    Server, Cpu, Database, Activity, Boxes, Gauge, Settings, Users, User,
    PanelLeftClose, PanelLeftOpen, Terminal
  } from "lucide-svelte";
  import { authState } from "$lib/auth.svelte";
  import ModalProfile from "./ModalProfile.svelte";

  const iconMap: Record<string, any> = {
    LayoutGrid, Shield, Globe, Network, Radio, Bot,
    Server, Cpu, Database, Activity, Boxes, Gauge, Settings, Users, Terminal
  };

  function getIcon(name: string) {
    return iconMap[name] ?? LayoutGrid;
  }

  const isAdmin = $derived(authState.user.role === 'admin');
  const userPermissions = $derived.by(() => {
    if (isAdmin) return [];
    const perms = authState.user.permissions;
    if (Array.isArray(perms)) return perms;
    if (typeof perms === "string") {
      try { return JSON.parse(perms); } catch { return []; }
    }
    return [];
  });

  const items = $derived(appState.apps.filter((a) => !a.hidden));
  const coreItems = $derived(items.filter((a) => a.group !== 'system'));
  const adminItems = $derived.by(() => {
    if (isAdmin) return items.filter((a) => a.group === 'system');
    // Non-admin user: only show system pages explicitly permitted
    return items.filter((a) => a.group === 'system' && userPermissions.includes(a.path));
  });

  let showProfileModal = $state(false);

  function isActive(path: string): boolean {
    const p = $page.url.pathname;
    if (p === "/" && path === "/dashboard") return true;
    return p === path || p.startsWith(path + "/");
  }

  let collapsed = $state(false);

  $effect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("sidebar:collapsed", collapsed ? "1" : "0");
    }
  });

  $effect(() => {
    if (typeof localStorage === "undefined") return;
    const stored = localStorage.getItem("sidebar:collapsed");
    if (stored !== null) collapsed = stored === "1";
  });
</script>

<aside class="sidebar-shell {collapsed ? 'sidebar-shell-collapsed' : 'sidebar-shell-expanded'}">
  <!-- Brand Header -->
  <div class="relative h-14 flex items-center shrink-0 px-2 overflow-hidden">
    {#if collapsed}
      <!-- Collapsed: Logo swaps to Expand Icon on hover -->
      <button
        onclick={() => (collapsed = !collapsed)}
        title="Expand sidebar"
        class="group relative w-10 h-10 rounded-md flex items-center justify-center hover:bg-cream-100 transition-colors cursor-pointer shrink-0"
      >
        <!-- Logo Image or Fallback: hides on hover -->
        <div class="transition-opacity duration-150 group-hover:opacity-0 flex items-center justify-center">
          {#if appState.config.logoUrl && !appState.config.logoUrl.startsWith('[')}
            <img
              src={appState.config.logoUrl}
              alt="Logo"
              class="w-7 h-7 object-contain rounded"
            />
          {:else}
            <div class="w-7 h-7 rounded bg-black text-white flex items-center justify-center text-std font-bold">
              {(appState.config.brandName || '[brand]').replace(/[\[\]]/g, '').charAt(0).toUpperCase()}
            </div>
          {/if}
        </div>

        <!-- Sidebar Expand Icon: appears on hover -->
        <PanelLeftOpen class="w-4 h-4 text-stone-700 absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
      </button>
    {:else}
      <!-- Expanded: Full Brand Header with Collapse Icon on Right -->
      <div class="flex items-center w-full min-w-0">
        <div class="w-10 h-10 flex items-center justify-center shrink-0">
          {#if appState.config.logoUrl && !appState.config.logoUrl.startsWith('[')}
            <img
              src={appState.config.logoUrl}
              alt="Logo"
              class="w-7 h-7 object-contain rounded"
            />
          {:else}
            <div class="w-7 h-7 rounded bg-black text-white flex items-center justify-center text-std font-bold">
              {(appState.config.brandName || '[brand]').replace(/[\[\]]/g, '').charAt(0).toUpperCase()}
            </div>
          {/if}
        </div>

        <div class="min-w-0 flex-1 pl-2">
          <h1 class="text-large font-bold text-black tracking-tight leading-none truncate">{appState.config.brandName || '[brand]'}</h1>
          <p class="text-small text-stone-500 font-medium truncate mt-0.5">{appState.config.brandSubtitle || '[subheader]'}</p>
        </div>

        <button
          onclick={() => (collapsed = !collapsed)}
          title="Collapse sidebar"
          class="btn-icon shrink-0 ml-1"
        >
          <PanelLeftClose class="w-4 h-4" />
        </button>
      </div>
    {/if}
  </div>

  <!-- Navigation -->
  <nav class="flex-1 overflow-y-auto px-2 py-3 space-y-1 overflow-x-hidden">
    <!-- Core Items -->
    {#each coreItems as item (item.id)}
      {@const active = isActive(item.path)}
      {@const Icon = getIcon(item.icon)}
      <a
        href={item.path}
        title={collapsed ? item.label : ''}
        class="flex items-center rounded-md transition-colors cursor-pointer group h-9 px-2 gap-2.5
          {active
            ? 'bg-black text-white font-bold'
            : 'text-stone-700 hover:bg-cream-100 hover:text-black font-semibold'}"
      >
        <div class="w-6 h-6 flex items-center justify-center shrink-0">
          <Icon class="w-4 h-4 transition-transform group-hover:scale-105 {active ? 'text-white' : 'text-stone-500 group-hover:text-black'}" />
        </div>
        <span class="text-std truncate transition-all duration-200 ease-out {collapsed ? 'opacity-0 -translate-x-3 pointer-events-none w-0' : 'opacity-100 translate-x-0'}">
          {item.label}
        </span>
      </a>
    {/each}

    <!-- Admin Section Divider -->
    {#if coreItems.length > 0 && adminItems.length > 0}
      {#if collapsed}
        <div class="py-2 px-2 flex">
          <div class="w-6 flex justify-center">
            <div class="w-4 border-t border-cream-300"></div>
          </div>
        </div>
      {:else}
        <div class="pt-3 pb-1 px-2 flex items-center gap-2">
          <span class="text-small font-bold text-stone-400 font-mono">Admin</span>
          <div class="flex-1 border-t border-cream-200"></div>
        </div>
      {/if}
    {/if}

    <!-- Admin Items -->
    {#each adminItems as item (item.id)}
      {@const active = isActive(item.path)}
      {@const Icon = getIcon(item.icon)}
      <a
        href={item.path}
        title={collapsed ? item.label : ''}
        class="flex items-center rounded-md transition-colors cursor-pointer group h-9 px-2 gap-2.5
          {active
            ? 'bg-black text-white font-bold'
            : 'text-stone-700 hover:bg-cream-100 hover:text-black font-semibold'}"
      >
        <div class="w-6 h-6 flex items-center justify-center shrink-0">
          <Icon class="w-4 h-4 transition-transform group-hover:scale-105 {active ? 'text-white' : 'text-stone-500 group-hover:text-black'}" />
        </div>
        <span class="text-std truncate transition-all duration-200 ease-out {collapsed ? 'opacity-0 -translate-x-3 pointer-events-none w-0' : 'opacity-100 translate-x-0'}">
          {item.label}
        </span>
      </a>
    {/each}
  </nav>

  <!-- Bottom User Profile Card -->
  <div class="border-t border-cream-300 shrink-0 px-2 py-2 overflow-hidden">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      onclick={() => (showProfileModal = true)}
      class="flex items-center rounded-md transition-colors cursor-pointer group h-9 px-2 gap-2.5 text-stone-700 hover:bg-cream-100 hover:text-black font-semibold"
      title={collapsed ? (authState.user.name || authState.user.username) : ''}
    >
      <!-- Profile Avatar -->
      <div class="w-7 h-7 flex items-center justify-center shrink-0">
        <div class="w-7 h-7 rounded-full bg-cream-200 text-stone-600 flex items-center justify-center border border-cream-300 overflow-hidden">
          {#if authState.user.avatar}
            <img src={authState.user.avatar} alt="Avatar" class="w-full h-full object-cover" />
          {:else}
            <span class="text-small font-bold text-stone-600">
              {(authState.user.name || authState.user.username || 'U').charAt(0)}
            </span>
          {/if}
        </div>
      </div>

      <!-- User Info & Role Badge -->
      <div class="min-w-0 flex-1 flex items-center justify-between gap-1 transition-all duration-200 ease-out {collapsed ? 'opacity-0 -translate-x-3 pointer-events-none w-0 hidden' : 'opacity-100 translate-x-0'}">
        <span class="text-std truncate text-black font-semibold">
          {authState.user.name || authState.user.username}
        </span>
        <span class="text-small font-mono text-stone-400">
          {authState.user.role}
        </span>
      </div>
    </div>
  </div>
</aside>

{#if showProfileModal}
  <ModalProfile onClose={() => (showProfileModal = false)} />
{/if}
