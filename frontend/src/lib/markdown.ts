import { marked, type Tokens } from "marked";
import hljs from "highlight.js/lib/core";
import "highlight.js/styles/github-dark.css";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import sql from "highlight.js/lib/languages/sql";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import nginx from "highlight.js/lib/languages/nginx";

export const LANGS = ["bash","sh","shell","json","yaml","yml","javascript","js","typescript","ts","python","py","html","xml","css","sql","dockerfile","nginx"];
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("nginx", nginx);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function highlight(code: string, lang: string): string {
  const normalized = lang.trim().split(/\s+/)[0];
  if (normalized && hljs.getLanguage(normalized)) {
    try { return hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value; }
    catch { /* fall through */ }
  }
  try { return hljs.highlightAuto(code).value; }
  catch { return escapeHtml(code); }
}

let configured = false;
function configure() {
  if (configured) return;
  configured = true;
  marked.setOptions({ gfm: true, breaks: true });
  marked.use({
    renderer: {
      code(token: Tokens.Code) {
        const code = token.text;
        const lang = (token.lang || "").trim();
        const langClass = lang ? ` language-${lang.trim().split(/\s+/)[0]}` : "";
        const html = highlight(code, lang);
        return `<div class="code-block relative group my-3 rounded-lg overflow-hidden border border-stone-700/40">`
          + `<div class="flex items-center justify-between px-3 py-1.5 bg-stone-800 text-stone-300 text-[10px] font-mono">`
          + `<span class="uppercase tracking-wider">${escapeHtml(lang || "text")}</span>`
          + `<button type="button" class="copy-btn px-2 py-0.5 rounded text-[10px] font-semibold bg-stone-700 hover:bg-accent-600 text-white transition-colors" aria-label="Copy code">Copy</button>`
          + `</div>`
          + `<pre class="hljs m-0 p-3 bg-stone-900 text-stone-100 text-[11px] leading-relaxed overflow-x-auto font-mono"><code class="hljs${langClass}">${html}</code></pre>`
          + `</div>`;
      }
    }
  });
}

export function renderMarkdown(raw: string): string {
  if (!raw) return "";
  configure();
  try { return marked.parse(raw) as string; }
  catch { return escapeHtml(raw); }
}

export function attachCopyHandlers(root: HTMLElement) {
  const buttons = root.querySelectorAll<HTMLButtonElement>(".copy-btn");
  buttons.forEach((btn) => {
    if ((btn as any)._wired) return;
    (btn as any)._wired = true;
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = btn.closest(".code-block")?.querySelector("pre code");
      const text = code?.textContent ?? "";
      try {
        await navigator.clipboard.writeText(text);
        const original = btn.textContent;
        btn.textContent = "Copied";
        btn.classList.add("bg-emerald-600");
        btn.classList.remove("bg-stone-700");
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove("bg-emerald-600");
          btn.classList.add("bg-stone-700");
        }, 1500);
      } catch {
        btn.textContent = "Failed";
      }
    });
  });
}
