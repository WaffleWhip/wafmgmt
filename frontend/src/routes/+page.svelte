<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { appState } from "$lib/store.svelte";
  import { login } from "$lib/auth.svelte";
  import { ArrowRight, Lock, User } from "lucide-svelte";

  let username = $state("");
  let password = $state("");
  let error = $state<string | null>(null);
  let loading = $state(false);

  let canvasEl: HTMLCanvasElement | undefined = $state();

  // Dynamic canvas mesh animation
  onMount(() => {
    if (!canvasEl) return;
    const canvas = canvasEl;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    // Particle nodes representing mesh network nodes
    const count = Math.min(Math.floor((width * height) / 18000), 55);
    const nodes = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.45,
      radius: Math.random() * 1.5 + 1
    }));

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      // Connect lines
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 130) {
            const alpha = (1 - dist / 130) * 0.12;
            ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw node dots
      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;

        if (node.x < 0) node.x = width;
        else if (node.x > width) node.x = 0;
        if (node.y < 0) node.y = height;
        else if (node.y > height) node.y = 0;

        ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
    };
  });

  let showOnboarding = $state(false);
  let onboardingUser = $state<any>(null);
  let onboardingName = $state("");
  let onboardingPass = $state("");
  let onboardingPassConfirm = $state("");
  let onboardingAvatar = $state("");

  function handleOnboardingFile(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    if (file.size > 2 * 1024 * 1024) {
      error = "Image size must be at most 2MB";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onboardingAvatar = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  async function handleLogin(e: Event) {
    e.preventDefault();
    error = null;
    loading = true;

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Invalid username or password");
      }

      const data = await res.json();
      if (data.needsOnboarding) {
        onboardingUser = data.user;
        onboardingName = data.user.name || data.user.username;
        showOnboarding = true;
        return;
      }

      login(data.user);
      goto("/dashboard", { replaceState: true });
    } catch (err: any) {
      error = err.message || "Failed to sign in";
    } finally {
      loading = false;
    }
  }

  async function handleCompleteOnboarding(e: Event) {
    e.preventDefault();
    if (!onboardingName.trim()) {
      error = "Display name is required";
      return;
    }
    if (!onboardingPass.trim()) {
      error = "New password is required";
      return;
    }
    if (onboardingPass !== onboardingPassConfirm) {
      error = "Password confirmation does not match";
      return;
    }

    loading = true;
    error = null;

    try {
      const res = await fetch(`/api/users/${encodeURIComponent(onboardingUser.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: onboardingName.trim(),
          password: onboardingPass.trim(),
          avatar: onboardingAvatar,
          onboarded: 1
        })
      });

      if (!res.ok) {
        throw new Error("Failed to save the initial profile");
      }

      const updated = await res.json();
      login(updated);
      goto("/dashboard", { replaceState: true });
    } catch (err: any) {
      error = err?.message || "An error occurred while completing the profile";
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen w-full flex flex-col justify-between text-white relative overflow-hidden font-sans select-none bg-stone-950">
  <!-- Dynamic Atmospheric Background Layers -->
  {#if appState.config.landingBgUrl}
    <div
      class="absolute inset-0 bg-cover bg-center transition-all duration-700 opacity-60 scale-105 filter blur-xs"
      style="background-image: url('{appState.config.landingBgUrl}');"
    ></div>
    <div class="absolute inset-0 bg-stone-950/75 backdrop-blur-[2px]"></div>
  {:else}
    <!-- Subtle monochrome gradients (neutral gray/black only) -->
    <div class="absolute -top-32 -left-32 w-96 h-96 bg-white/[0.03] rounded-full blur-3xl pointer-events-none"></div>
    <div class="absolute -bottom-32 -right-32 w-96 h-96 bg-stone-750/30 rounded-full blur-3xl pointer-events-none"></div>

    <!-- Fine grid pattern -->
    <div
      class="absolute inset-0 opacity-[0.025] pointer-events-none"
      style="background-image: radial-gradient(#ffffff 1px, transparent 1px); background-size: 24px 24px;"
    ></div>
  {/if}

  <!-- Canvas Network Mesh Particles -->
  <canvas
    bind:this={canvasEl}
    class="absolute inset-0 w-full h-full pointer-events-none z-0 opacity-80"
  ></canvas>

  <!-- Header -->
  <header class="relative z-10 px-6 py-5 flex items-center gap-3">
    {#if appState.config.logoUrl && !appState.config.logoUrl.startsWith("[")}
      <img
        src={appState.config.logoUrl}
        alt="Logo"
        class="w-7 h-7 object-contain rounded shrink-0"
      />
    {:else}
      <div class="w-7 h-7 rounded bg-white/10 border border-white/15 text-white flex items-center justify-center text-std font-bold shrink-0">
        {(appState.config.brandName || "BAN").replace(/[\[\]]/g, "").charAt(0).toUpperCase()}
      </div>
    {/if}
    <div class="min-w-0">
      <h1 class="text-std font-bold tracking-tight text-white leading-none">
        {appState.config.brandName || "Oasis WAF"}
      </h1>
      {#if appState.config.brandSubtitle}
        <p class="text-small text-stone-400 leading-none mt-0.5">
          {appState.config.brandSubtitle}
        </p>
      {/if}
    </div>
  </header>

  <!-- Main Center: Login Form or Authenticated Status -->
  <main class="relative z-10 flex-1 flex items-center justify-center p-4">
    <div class="w-full max-w-xs">
      {#if showOnboarding}
        <!-- Initial Onboarding Box for New User -->
        <div class="p-6 rounded-xl bg-stone-900/90 border border-white/10 backdrop-blur-md">
          <div class="mb-4 text-center">
            <h2 class="text-std font-bold text-white">Complete Your Profile</h2>
            <p class="text-small text-stone-400 mt-1">Hi @{onboardingUser?.username}, please set your display name and password.</p>
          </div>

          {#if error}
            <div class="p-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-std mb-3">
              {error}
            </div>
          {/if}

          <form onsubmit={handleCompleteOnboarding} class="space-y-3 text-std">
            <!-- Avatar upload (optional) -->
            <div class="flex items-center gap-3">
              <div class="relative w-12 h-12 rounded-full bg-stone-800 border border-white/20 flex items-center justify-center overflow-hidden shrink-0">
                {#if onboardingAvatar}
                  <img src={onboardingAvatar} alt="Avatar" class="w-full h-full object-cover" />
                {:else}
                  <User class="w-5 h-5 text-stone-400" />
                {/if}
              </div>
              <div>
                <label class="px-2.5 py-1.5 rounded border border-white/20 bg-white/5 hover:bg-white/10 text-white text-std font-semibold cursor-pointer inline-flex items-center gap-1.5 transition-colors">
                  <span>Choose Photo</span>
                  <input type="file" accept="image/*" class="hidden" onchange={handleOnboardingFile} />
                </label>
                <p class="text-small text-stone-500 mt-0.5">Optional</p>
              </div>
            </div>

            <div>
              <label for="onboard-name" class="block text-small font-medium text-stone-400 mb-1">
                Display Name *
              </label>
              <input
                id="onboard-name"
                type="text"
                bind:value={onboardingName}
                required
                placeholder="e.g. John Doe"
                class="w-full h-8.5 px-3 text-std text-white bg-white/5 border border-white/10 rounded-md outline-none focus:border-white/40 transition-colors"
              />
            </div>

            <div>
              <label for="onboard-pass" class="block text-small font-medium text-stone-400 mb-1">
                New Password *
              </label>
              <input
                id="onboard-pass"
                type="password"
                bind:value={onboardingPass}
                required
                placeholder="••••••••"
                class="w-full h-8.5 px-3 text-std text-white bg-white/5 border border-white/10 rounded-md outline-none focus:border-white/40 transition-colors"
              />
            </div>

            <div>
              <label for="onboard-pass-confirm" class="block text-small font-medium text-stone-400 mb-1">
                Confirm New Password *
              </label>
              <input
                id="onboard-pass-confirm"
                type="password"
                bind:value={onboardingPassConfirm}
                required
                placeholder="••••••••"
                class="w-full h-8.5 px-3 text-std text-white bg-white/5 border border-white/10 rounded-md outline-none focus:border-white/40 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              class="w-full h-8.5 rounded-md bg-white text-black hover:bg-stone-200 text-std font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer mt-3 disabled:opacity-50"
            >
              <span>{loading ? "Saving…" : "Finish & Sign In"}</span>
              <ArrowRight class="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      {:else}
        <!-- Login Box -->
        <div class="p-6 rounded-xl bg-stone-900/80 border border-white/10 backdrop-blur-md">
          <div class="mb-4">
            <h2 class="text-std font-bold text-white">Sign In</h2>
          </div>

          {#if error}
            <div class="p-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-std mb-3">
              {error}
            </div>
          {/if}

          <form onsubmit={handleLogin} class="space-y-3">
            <div>
              <label for="landing-username" class="block text-small font-medium text-stone-400 mb-1">
                Username
              </label>
              <div class="relative">
                <User class="w-3.5 h-3.5 text-stone-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="landing-username"
                  type="text"
                  bind:value={username}
                  required
                  autocomplete="username"
                  placeholder="Enter your username"
                  class="w-full h-8.5 pl-8 pr-3 text-std text-white bg-white/5 border border-white/10 rounded-md outline-none focus:border-white/40 transition-colors"
                />
              </div>
            </div>

            <div>
              <label for="landing-password" class="block text-small font-medium text-stone-400 mb-1">
                Password
              </label>
              <div class="relative">
                <Lock class="w-3.5 h-3.5 text-stone-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="landing-password"
                  type="password"
                  bind:value={password}
                  placeholder="••••••••"
                  class="w-full h-8.5 pl-8 pr-3 text-std text-white bg-white/5 border border-white/10 rounded-md outline-none focus:border-white/40 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              class="w-full h-8.5 rounded-md bg-white text-black hover:bg-stone-200 text-std font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer mt-3 disabled:opacity-50"
            >
              <span>{loading ? "Signing in…" : "Sign In"}</span>
              <ArrowRight class="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      {/if}
    </div>
  </main>
</div>

