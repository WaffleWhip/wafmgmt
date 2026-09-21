<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import "uplot/dist/uPlot.min.css";

  interface Series {
    label: string;
    color: string;
    points: { t: number; v: number }[];
  }

  let {
    title,
    unit,
    series,
    height = 150
  }: { title: string; unit: string; series: Series[]; height?: number } = $props();

  let host: HTMLDivElement | undefined = $state();
  let plot: any = null;
  let uPlotCtor: any = null;
  let ro: ResizeObserver | null = null;

  function buildData() {
    const times = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.t)))).sort((a, b) => a - b);
    const xs = times.map((t) => t / 1000);
    const ys = series.map((s) => {
      const map = new Map(s.points.map((p) => [p.t, p.v]));
      return times.map((t) => (map.has(t) ? map.get(t)! : null));
    });
    return [xs, ...ys] as any;
  }

  function latest(): string {
    for (const s of series) {
      if (s.points.length) return `${s.points[s.points.length - 1].v.toFixed(2)} ${unit}`;
    }
    return "—";
  }

  async function draw() {
    if (!host) return;
    if (!uPlotCtor) {
      const mod: any = await import("uplot");
      uPlotCtor = mod.default ?? mod;
    }
    const width = Math.max(120, host.clientWidth || 320);
    const data = buildData();
    const opts = {
      width,
      height,
      legend: { show: false },
      cursor: { show: true, y: false },
      scales: { x: { time: true } },
      axes: [
        {
          stroke: "#8a8a8a",
          font: "10px Plus Jakarta Sans",
          grid: { stroke: "#88888822" },
          ticks: { stroke: "#88888833" }
        },
        {
          stroke: "#8a8a8a",
          font: "10px Plus Jakarta Sans",
          size: 46,
          grid: { stroke: "#88888822" },
          ticks: { stroke: "#88888833" }
        }
      ],
      series: [
        {},
        ...series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: 1.5,
          points: { show: false },
          spanGaps: true
        }))
      ]
    };
    if (!plot) plot = new uPlotCtor(opts, data, host);
    else {
      plot.setData(data);
      plot.setSize({ width, height });
    }
  }

  onMount(() => {
    draw();
    if (host) {
      ro = new ResizeObserver(() => { draw(); });
      ro.observe(host);
    }
  });

  $effect(() => {
    series;
    if (plot) draw();
  });

  onDestroy(() => {
    ro?.disconnect();
    try { plot?.destroy(); } catch {}
  });
</script>

<div class="border border-cream-300 rounded-md bg-white p-2.5">
  <div class="flex items-center justify-between mb-1.5">
    <span class="text-std font-bold text-black">{title}</span>
    <span class="text-small font-mono text-stone-500">{latest()}</span>
  </div>
  <div class="flex items-center gap-3 mb-1">
    {#each series as s}
      <span class="inline-flex items-center gap-1 text-small text-stone-500">
        <span class="w-2 h-2 rounded-full" style="background:{s.color}"></span>{s.label}
      </span>
    {/each}
  </div>
  <div bind:this={host}></div>
</div>
