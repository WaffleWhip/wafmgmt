<script lang="ts">
  import { onMount } from "svelte";
  import { copyText } from "$lib/clipboard";
  import {
    Database, Table, Play, Download, Upload, RefreshCw,
    Terminal, FileJson, Copy, CheckCircle2, AlertCircle, X,
    ChevronLeft, ChevronRight, Search, Clock, HardDrive, Activity, Layers
  } from "lucide-svelte";

  interface DbOverview {
    database: string;
    version: string;
    size: string;
    sizeBytes: number;
    activeConnections: number;
    tables: Array<{
      table_name: string;
      total_size: string;
      column_count: number;
      estimated_rows: number;
    }>;
  }

  interface TableDetails {
    tableName: string;
    columns: Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>;
    totalRows: number;
    limit: number;
    offset: number;
    rows: any[];
  }

  type DbTab = "tables" | "query" | "backup";
  type ResultView = "table" | "json";

  let activeTab = $state<DbTab>("tables");
  let overview = $state<DbOverview | null>(null);
  let selectedTable = $state<string>("");
  let tableData = $state<TableDetails | null>(null);
  let isLoadingTable = $state<boolean>(false);
  let isExecutingQuery = $state<boolean>(false);
  let isExporting = $state<boolean>(false);

  let sqlQuery = $state<string>("SELECT * FROM services LIMIT 50;");
  let queryResult = $state<any>(null);
  let resultView = $state<ResultView>("table");
  let importSqlText = $state<string>("");
  let importResult = $state<any>(null);
  let isImporting = $state<boolean>(false);

  const TABLE_PAGE_SIZE = 100;
  let tablePage = $state(0);
  let tableListSearch = $state("");

  let queryHistory = $state<string[]>([]);
  let copiedSchema = $state(false);
  let inspectingRow = $state<any>(null);

  const filteredTables = $derived(
    (overview?.tables ?? []).filter((t) =>
      t.table_name.toLowerCase().includes(tableListSearch.trim().toLowerCase())
    )
  );

  const filteredHistory = $derived(
    queryHistory.filter((q) => q.trim() && q.trim() !== sqlQuery.trim())
  );

  const PG_VER = $derived(overview?.version.split(" on ")[0] ?? "");

  async function loadOverview() {
    try {
      const res = await fetch("/api/database/overview");
      if (res.ok) {
        const data = await res.json();
        overview = data;
        if (data && data.tables.length > 0 && !selectedTable) {
          selectedTable = data.tables[0].table_name;
        }
      }
    } catch (e) {
      console.error("Failed to load DB overview:", e);
    }
  }

  async function loadTableData(tableName: string, page = 0) {
    selectedTable = tableName;
    tablePage = page;
    isLoadingTable = true;
    try {
      const res = await fetch(`/api/database/tables/${tableName}?limit=${TABLE_PAGE_SIZE}&offset=${page * TABLE_PAGE_SIZE}`);
      if (res.ok) {
        tableData = await res.json();
      }
    } catch (e) {
      console.error("Failed to load table data:", e);
    } finally {
      isLoadingTable = false;
    }
  }

  async function executeSql(pushToHistory = true) {
    if (!sqlQuery.trim()) return;
    isExecutingQuery = true;
    queryResult = null;
    try {
      const res = await fetch("/api/database/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: sqlQuery })
      });
      queryResult = await res.json();
      const q = sqlQuery.toLowerCase();
      if (q.includes("insert") || q.includes("update") || q.includes("delete")) {
        loadOverview();
        if (selectedTable) loadTableData(selectedTable, tablePage);
      }
      if (pushToHistory && queryResult?.success) pushHistory(sqlQuery);
    } catch (e: any) {
      queryResult = { success: false, error: e.message };
    } finally {
      isExecutingQuery = false;
    }
  }

  async function exportSqlDump() {
    isExporting = true;
    try {
      const res = await fetch("/api/database/export");
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `wafmgmt_dump_${new Date().toISOString().slice(0, 10)}.sql`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
      }
    } catch (e) {
      console.error("Failed to export dump:", e);
    } finally {
      isExporting = false;
    }
  }

  async function runImport() {
    if (!importSqlText.trim()) return;
    isImporting = true;
    importResult = null;
    try {
      const res = await fetch("/api/database/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: importSqlText })
      });
      importResult = await res.json();
      if (importResult.success) {
        loadOverview();
        if (selectedTable) loadTableData(selectedTable, tablePage);
      }
    } catch (e: any) {
      importResult = { success: false, error: e.message };
    } finally {
      isImporting = false;
    }
  }

  function pushHistory(q: string) {
    const next = [q, ...queryHistory.filter((h) => h.trim() !== q.trim())].slice(0, 10);
    queryHistory = next;
    try { localStorage.setItem("db:queries", JSON.stringify(next)); } catch {}
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem("db:queries");
      if (raw) queryHistory = JSON.parse(raw);
    } catch {}
  }

  async function copySchema() {
    if (!tableData) return;
      await copyText(JSON.stringify(tableData.columns, null, 2));
    copiedSchema = true;
    setTimeout(() => (copiedSchema = false), 1500);
  }

  function setTemplateQuery(q: string) {
    sqlQuery = q;
    activeTab = "query";
    executeSql();
  }

  function recallFromHistory(q: string) {
    sqlQuery = q;
  }

  const quickTemplates = [
    { label: "services",     sql: "SELECT * FROM services ORDER BY name;" },
    { label: "nginx_routes", sql: "SELECT * FROM nginx_routes ORDER BY domain;" },
    { label: "routes",       sql: "SELECT * FROM routes ORDER BY name;" },
    { label: "config",       sql: "SELECT key, value FROM config;" },
    { label: "devices",      sql: "SELECT * FROM devices ORDER BY created_at DESC;" },
    { label: "peers_meta",   sql: "SELECT pubkey, name, ip, created_at FROM peers_meta ORDER BY created_at DESC;" }
  ];

  const tabs: { id: DbTab; label: string; icon: any }[] = [
    { id: "tables", label: "Tables",        icon: Table },
    { id: "query",  label: "SQL Console",   icon: Terminal },
    { id: "backup", label: "Backup & Dumps",icon: Download }
  ];

  function renderCell(value: any): { text: string; muted: boolean } {
    if (value === null || value === undefined) return { text: "null", muted: true };
    if (typeof value === "object") return { text: JSON.stringify(value), muted: true };
    return { text: String(value), muted: false };
  }

  onMount(() => {
    loadHistory();
    loadOverview().then(() => {
      if (selectedTable) loadTableData(selectedTable);
    });
  });
</script>

<div class="space-y-5">
  {#if overview}
    <div class="surface px-5 py-4 flex items-center justify-between gap-6">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-10 h-10 rounded bg-black text-white flex items-center justify-center shrink-0">
          <Database class="w-5 h-5" />
        </div>
        <div class="min-w-0">
          <div class="text-large font-extrabold text-black tracking-tight truncate">{overview.database}</div>
          <div class="text-small text-stone-500 font-mono truncate">{PG_VER}</div>
        </div>
      </div>
      <div class="hidden md:flex items-center gap-7 text-std">
        <div class="text-left">
          <div class="stat-card-label flex items-center gap-1.5"><HardDrive class="w-3 h-3" /> Size</div>
          <div class="font-bold text-black text-large">{overview.size}</div>
        </div>
        <div class="text-left">
          <div class="stat-card-label flex items-center gap-1.5"><Layers class="w-3 h-3" /> Tables</div>
          <div class="font-bold text-black text-large">{overview.tables.length}</div>
        </div>
        <div class="text-left">
          <div class="stat-card-label flex items-center gap-1.5"><Activity class="w-3 h-3" /> Connections</div>
          <div class="font-bold text-black text-large">{overview.activeConnections}</div>
        </div>
      </div>
      <button
        onclick={() => { loadOverview(); if (selectedTable) loadTableData(selectedTable, tablePage); }}
        class="btn-icon shrink-0"
        title="Refresh"
      >
        <RefreshCw class="w-3.5 h-3.5" />
      </button>
    </div>
  {/if}

  <div class="flex items-center border-b border-cream-300">
    <div class="flex items-center gap-1">
      {#each tabs as t}
        {@const TabIcon = t.icon}
        <button
          onclick={() => (activeTab = t.id)}
          class="tab {activeTab === t.id ? 'tab-active' : ''}"
        >
          <TabIcon class="w-3.5 h-3.5" />
          <span>{t.label}</span>
        </button>
      {/each}
    </div>
  </div>

  {#if activeTab === 'tables'}
    <div class="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
      <aside class="surface p-2 self-start">
        <div class="flex items-center justify-between px-2 pt-1.5 pb-1">
          <span class="text-small text-stone-500 font-bold">Tables</span>
          <Table class="w-3 h-3 text-stone-400" />
        </div>
        <div class="px-2 pb-2">
          <div class="relative">
            <Search class="w-3 h-3 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              bind:value={tableListSearch}
              placeholder="Filter…"
              class="input input-sm w-full pl-8"
            />
          </div>
        </div>
        {#if overview}
          <div class="space-y-0.5 px-1">
            {#each filteredTables as tbl}
              {@const isSelected = selectedTable === tbl.table_name}
              <button
                onclick={() => loadTableData(tbl.table_name)}
                class="sidebar-link w-full items-start text-left gap-2 {isSelected ? 'sidebar-link-active' : ''}"
              >
                <div class="min-w-0 flex-1 truncate">
                  <div class="truncate text-std font-bold">{tbl.table_name}</div>
                  <div class="text-small font-mono {isSelected ? 'text-stone-300' : 'text-stone-500'}">
                    {tbl.estimated_rows} row{tbl.estimated_rows === 1 ? '' : 's'}
                  </div>
                </div>
                <span class="pill text-small shrink-0 {isSelected ? 'bg-stone-800 text-stone-200' : ''}">{tbl.total_size}</span>
              </button>
            {/each}
            {#if filteredTables.length === 0}
              <div class="px-2 py-6 text-center text-small text-stone-400">No tables match "{tableListSearch}"</div>
            {/if}
          </div>
        {/if}
      </aside>

      <section class="min-w-0">
        {#if !selectedTable}
          <div class="surface px-6 py-20 text-center">
            <Table class="w-7 h-7 text-cream-400 mx-auto mb-2" />
            <p class="text-large font-bold text-black">Select a table</p>
            <p class="text-std text-stone-500 mt-0.5">Choose any table on the left to inspect its schema and data.</p>
          </div>
        {:else if isLoadingTable && !tableData}
          <div class="surface px-6 py-20 text-center text-std text-stone-400 space-y-2">
            <RefreshCw class="w-5 h-5 animate-spin mx-auto" />
            <span>Loading {selectedTable}…</span>
          </div>
        {:else if tableData}
          <div class="surface overflow-hidden">
            <div class="px-4 py-2.5 flex items-center justify-between">
              <div class="flex items-center gap-2 min-w-0">
                <Table class="w-4 h-4 text-stone-500 shrink-0" />
                <h3 class="text-large font-bold text-black truncate">{tableData.tableName}</h3>
                <span class="pill">{tableData.columns.length} cols · {tableData.totalRows} rows</span>
              </div>
              <button onclick={copySchema} class="btn btn-secondary btn-sm shrink-0" title="Copy schema as JSON">
                {#if copiedSchema}
                  <CheckCircle2 class="w-3 h-3 text-accent-600" />
                  <span>Copied</span>
                {:else}
                  <FileJson class="w-3 h-3" />
                  <span>Schema</span>
                {/if}
              </button>
            </div>

            <div class="border-t border-cream-300">
              <div class="px-4 py-2 flex items-center justify-between">
                <span class="text-small font-bold text-stone-500">Schema</span>
                <span class="text-small text-stone-400 font-mono">{tableData.columns.length} columns</span>
              </div>
              <div class="overflow-x-auto max-h-56 border-t border-cream-200">
                <table class="data-table">
                  <thead class="sticky top-0">
                    <tr>
                      <th>Column</th>
                      <th>Type</th>
                      <th>Nullable</th>
                      <th>Default</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each tableData.columns as col}
                      <tr>
                        <td class="font-mono text-black font-bold">{col.column_name}</td>
                        <td><span class="pill text-small font-mono">{col.data_type}</span></td>
                        <td class="text-stone-600">{col.is_nullable === 'YES' ? 'yes' : 'no'}</td>
                        <td class="font-mono text-stone-500 text-small truncate max-w-xs" title={col.column_default ?? ''}>{col.column_default ?? '—'}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>

            <div class="border-t border-cream-300">
              <div class="px-4 py-2 flex items-center justify-between">
                <span class="text-small font-bold text-stone-500">Data</span>
                {#if tableData.rows.length > 0}
                  <span class="text-small text-stone-400 font-mono">showing {tableData.rows.length} of {tableData.totalRows}</span>
                {/if}
              </div>
              <div class="overflow-x-auto border-t border-cream-200">
                {#if tableData.rows.length === 0}
                  <div class="px-6 py-12 text-center">
                    <Table class="w-6 h-6 text-cream-400 mx-auto mb-2" />
                    <p class="text-std font-bold text-black">Table is empty</p>
                    <p class="text-std text-stone-500 mt-0.5">No rows in {tableData.tableName} yet.</p>
                  </div>
                {:else}
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th class="w-12 text-center text-stone-400">#</th>
                        {#each tableData.columns as col}
                          <th>
                            <div>{col.column_name}</div>
                            <div class="text-small font-normal text-stone-500 font-mono mt-0.5">{col.data_type}</div>
                          </th>
                        {/each}
                      </tr>
                    </thead>
                    <tbody>
                      {#each tableData.rows as row, idx (idx)}
                        <tr onclick={() => (inspectingRow = row)} class="cursor-pointer">
                          <td class="text-center text-stone-400 text-small font-mono">{tablePage * TABLE_PAGE_SIZE + idx + 1}</td>
                          {#each tableData.columns as col}
                            {@const cell = renderCell(row[col.column_name])}
                            <td class="font-mono {cell.muted ? 'text-stone-400 italic' : 'text-black'}">
                              {cell.text}
                            </td>
                          {/each}
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                {/if}
              </div>
              {#if tableData.totalRows > TABLE_PAGE_SIZE}
                <div class="px-4 py-2.5 border-t border-cream-200 flex items-center justify-between">
                  <span class="text-small text-stone-500 font-mono">
                    {tablePage * TABLE_PAGE_SIZE + 1}–{Math.min((tablePage + 1) * TABLE_PAGE_SIZE, tableData.totalRows)} of {tableData.totalRows}
                  </span>
                  <div class="flex items-center gap-1">
                    <button
                      onclick={() => loadTableData(selectedTable, tablePage - 1)}
                      disabled={tablePage === 0}
                      class="btn btn-secondary btn-sm"
                    >
                      <ChevronLeft class="w-3 h-3" />
                      <span>Prev</span>
                    </button>
                    <button
                      onclick={() => loadTableData(selectedTable, tablePage + 1)}
                      disabled={(tablePage + 1) * TABLE_PAGE_SIZE >= tableData.totalRows}
                      class="btn btn-secondary btn-sm"
                    >
                      <span>Next</span>
                      <ChevronRight class="w-3 h-3" />
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </section>
    </div>

  {:else if activeTab === 'query'}
    <div class="space-y-4">
      <div class="surface overflow-hidden">
        <div class="px-4 py-3 border-b border-cream-300 flex items-center justify-between flex-wrap gap-2">
          <div class="flex items-center gap-2">
            <Terminal class="w-3.5 h-3.5 text-stone-500" />
            <h2 class="text-std font-bold text-black">SQL Query</h2>
          </div>
          <div class="flex items-center gap-1.5 text-small flex-wrap">
            <span class="text-stone-400">Templates:</span>
            {#each quickTemplates as tpl}
              <button
                onclick={() => { sqlQuery = tpl.sql; }}
                class="pill hover:bg-cream-300 cursor-pointer"
              >
                {tpl.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="p-4 space-y-3">
          <textarea
            bind:value={sqlQuery}
            rows={5}
            placeholder="SELECT * FROM services WHERE status = 'online';"
            class="console w-full"
          ></textarea>

          <div class="flex items-center justify-between flex-wrap gap-2">
            <span class="text-small text-stone-400">SELECT · INSERT · UPDATE · DELETE · EXPLAIN · <kbd class="pill text-small font-mono">⌘↵</kbd> run</span>
            <button
              onclick={() => executeSql(true)}
              disabled={isExecutingQuery || !sqlQuery.trim()}
              class="btn btn-primary btn-sm"
            >
              {#if isExecutingQuery}
                <RefreshCw class="w-3.5 h-3.5 animate-spin" />
                <span>Running…</span>
              {:else}
                <Play class="w-3.5 h-3.5 fill-white" />
                <span>Run Query</span>
              {/if}
            </button>
          </div>
        </div>

        {#if filteredHistory.length > 0}
          <div class="border-t border-cream-300">
            <div class="px-4 py-2 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Clock class="w-3.5 h-3.5 text-stone-500" />
                <span class="text-std font-bold text-black">Recent</span>
                <span class="pill text-small">{queryHistory.length}</span>
              </div>
              <button
                onclick={() => { queryHistory = []; try { localStorage.removeItem("db:queries"); } catch {} }}
                class="text-small text-stone-500 hover:text-black font-semibold"
              >
                Clear
              </button>
            </div>
            <div class="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-2">
              {#each filteredHistory as h, i (i)}
                <button
                  onclick={() => recallFromHistory(h)}
                  class="text-left font-mono text-small text-stone-700 bg-cream-50 hover:bg-cream-100 border border-cream-200 rounded px-2.5 py-1.5 truncate transition"
                  title="Click to recall"
                >
                  {h}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      {#if queryResult}
        <div class="surface overflow-hidden">
          <div class="px-4 py-2.5 border-b border-cream-300 flex items-center justify-between bg-cream-100 gap-2 flex-wrap">
            <div class="flex items-center space-x-2 text-std">
              {#if queryResult.success}
                <CheckCircle2 class="w-4 h-4 text-accent-600" />
                <span class="font-bold text-black">OK</span>
                <span class="text-stone-400">·</span>
                <span class="text-stone-600 font-mono">{queryResult.rowCount} rows</span>
              {:else}
                <AlertCircle class="w-4 h-4 text-accent-600" />
                <span class="font-bold text-black">Error</span>
              {/if}
              <span class="text-stone-400">·</span>
              <span class="text-small text-stone-500 font-mono">{queryResult.durationMs}ms</span>
            </div>
            {#if queryResult.success}
              <div class="flex items-center gap-1">
                <div class="flex rounded border border-cream-300 p-0.5 bg-white text-std">
                  <button onclick={() => (resultView = "table")} class="px-2 py-0.5 rounded font-semibold {resultView === 'table' ? 'bg-black text-white' : 'text-stone-600'}">Table</button>
                  <button onclick={() => (resultView = "json")} class="px-2 py-0.5 rounded font-semibold {resultView === 'json' ? 'bg-black text-white' : 'text-stone-600'}">JSON</button>
                </div>
                <button
                  onclick={() => copyText(JSON.stringify(queryResult.rows, null, 2))}
                  class="btn btn-secondary btn-sm"
                  title="Copy result as JSON"
                >
                  <Copy class="w-3 h-3" />
                  <span>Copy</span>
                </button>
              </div>
            {/if}
          </div>

          {#if queryResult.success}
            {#if queryResult.rows && queryResult.rows.length > 0}
              {#if resultView === 'table'}
                <div class="overflow-x-auto max-h-[28rem]">
                  <table class="data-table">
                    <thead class="sticky top-0">
                      <tr>
                        {#each queryResult.columns as col}
                          <th>{col}</th>
                        {/each}
                      </tr>
                    </thead>
                    <tbody>
                      {#each queryResult.rows as row, ri (ri)}
                        <tr>
                          {#each queryResult.columns as col}
                            {@const cell = renderCell(row[col])}
                            <td class="font-mono {cell.muted ? 'text-stone-400 italic' : 'text-black'}">
                              {cell.text}
                            </td>
                          {/each}
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {:else}
                <pre class="p-4 bg-cream-50 font-mono text-std text-black max-h-[28rem] overflow-auto whitespace-pre">{JSON.stringify(queryResult.rows, null, 2)}</pre>
              {/if}
            {:else}
              <div class="p-8 text-center text-std text-stone-400">Query returned 0 rows.</div>
            {/if}
          {:else}
            <div class="banner banner-info m-4 font-mono">{queryResult.error}</div>
          {/if}
        </div>
      {/if}
    </div>

  {:else if activeTab === 'backup'}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="surface p-5 flex flex-col">
        <div class="flex items-center space-x-2 text-black font-bold text-large mb-1">
          <Download class="w-4 h-4 text-accent-600" />
          <span>Export SQL Dump</span>
        </div>
        <p class="text-std text-stone-500 mb-5 leading-relaxed">
          Download a complete PostgreSQL <code class="pill">.sql</code> script with all schemas, configurations, services, routes, and metadata.
        </p>
        <button
          onclick={exportSqlDump}
          disabled={isExporting}
          class="btn btn-primary btn-sm mt-auto"
        >
          {#if isExporting}
            <RefreshCw class="w-3.5 h-3.5 animate-spin" />
            <span>Generating…</span>
          {:else}
            <Download class="w-3.5 h-3.5" />
            <span>Download .SQL</span>
          {/if}
        </button>
      </div>

      <div class="surface p-5 flex flex-col">
        <div class="flex items-center space-x-2 text-black font-bold text-large mb-1">
          <Upload class="w-4 h-4 text-accent-600" />
          <span>Execute SQL Script</span>
        </div>
        <p class="text-std text-stone-500 mb-4 leading-relaxed">
          Paste SQL statements to execute directly against the cluster.
        </p>
        <textarea
          bind:value={importSqlText}
          rows={3}
          placeholder="INSERT INTO services ..."
          class="input font-mono text-std mb-3 resize-none"
        ></textarea>
        {#if importResult}
          <div class="banner banner-info mb-3 font-mono text-std">
            {importResult.success ? 'SQL script executed successfully.' : importResult.error}
          </div>
        {/if}
        <button
          onclick={runImport}
          disabled={isImporting || !importSqlText.trim()}
          class="btn btn-secondary btn-sm mt-auto"
        >
          {#if isImporting}
            <RefreshCw class="w-3.5 h-3.5 animate-spin" />
            <span>Executing…</span>
          {:else}
            <Upload class="w-3.5 h-3.5" />
            <span>Execute SQL</span>
          {/if}
        </button>
      </div>
    </div>
  {/if}
</div>

{#if inspectingRow}
  <div class="modal-overlay" onclick={() => (inspectingRow = null)}>
    <div class="modal-card max-w-2xl w-full" onclick={(e) => e.stopPropagation()}>
      <div class="px-5 py-3 border-b border-cream-300 flex items-center justify-between">
        <h3 class="text-large font-bold text-black">Row Record</h3>
        <button onclick={() => (inspectingRow = null)} class="btn-icon">
          <X class="w-4 h-4" />
        </button>
      </div>
      <pre class="m-5 console p-4 rounded-md overflow-x-auto max-h-96 leading-relaxed whitespace-pre-wrap">{JSON.stringify(inspectingRow, null, 2)}</pre>
      <div class="px-5 py-3 border-t border-cream-300 flex justify-end">
        <button onclick={() => (inspectingRow = null)} class="btn btn-primary btn-sm">Close</button>
      </div>
    </div>
  </div>
{/if}
