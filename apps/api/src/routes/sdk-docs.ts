import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { Marked, Renderer } from "marked";

const sdkReadmePath = fileURLToPath(new URL("../../../../packages/sdk/README.md", import.meta.url));
const agentSetupPath = fileURLToPath(new URL("../../../../docs/AGENT-SETUP.md", import.meta.url));

const docsContentSecurityPolicy =
  "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const renderer = new Renderer();
renderer.html = ({ text }) => escapeHtml(text);
const markdown = new Marked({ gfm: true, async: false, renderer });

let sdkReadmePromise: Promise<string> | undefined;
let agentSetupPromise: Promise<string> | undefined;

function readSdkReadme(): Promise<string> {
  sdkReadmePromise ??= readFile(sdkReadmePath, "utf8");
  return sdkReadmePromise;
}

function readAgentSetup(): Promise<string> {
  agentSetupPromise ??= readFile(agentSetupPath, "utf8");
  return agentSetupPromise;
}

function renderSdkPage(source: string): string {
  const content = String(markdown.parse(source));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SignalMonitor SDK</title>
    <meta name="description" content="Official SDK documentation for instrumenting Node.js, browser, and Next.js applications with SignalMonitor." />
    <style>
      :root { color-scheme: dark; --bg: #0f141b; --panel: #18212b; --text: #f3f7fb; --muted: #a8b4c1; --line: #2f3c49; --accent: #68e28b; --blue: #80b2ff; --code: #0b1220; }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.6; }
      a { color: var(--blue); text-decoration: none; }
      a:hover { text-decoration: underline; }
      header { border-bottom: 1px solid var(--line); background: #111922; }
      nav, main { width: min(940px, calc(100% - 40px)); margin: 0 auto; }
      nav { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 18px 0; }
      .brand { color: var(--text); font-size: 18px; font-weight: 800; }
      .links { display: flex; flex-wrap: wrap; gap: 16px; font-size: 14px; }
      main { padding: 50px 0 80px; }
      article { padding: clamp(22px, 5vw, 52px); border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
      h1, h2, h3 { line-height: 1.2; letter-spacing: -0.02em; scroll-margin-top: 20px; }
      h1 { margin-top: 0; font-size: clamp(36px, 7vw, 62px); }
      h2 { margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--line); font-size: 28px; }
      h3 { margin-top: 30px; font-size: 20px; }
      p, li { color: var(--muted); }
      strong { color: var(--text); }
      code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
      :not(pre) > code { padding: 2px 6px; border: 1px solid #304056; border-radius: 5px; background: var(--code); color: #dce8f7; }
      pre { overflow: auto; padding: 18px; border: 1px solid #26364d; border-radius: 9px; background: var(--code); color: #e7edf7; }
      pre code { font-size: 13px; }
      table { display: block; width: 100%; overflow-x: auto; border-collapse: collapse; color: var(--muted); }
      th, td { padding: 10px 12px; border: 1px solid var(--line); text-align: left; vertical-align: top; }
      th { color: var(--text); background: #131c27; }
      blockquote { margin: 20px 0; padding: 2px 18px; border-left: 3px solid var(--accent); background: rgba(104, 226, 139, 0.06); }
      @media (max-width: 680px) { nav { align-items: flex-start; flex-direction: column; } nav, main { width: min(100% - 24px, 940px); } }
    </style>
  </head>
  <body>
    <header>
      <nav aria-label="Documentation">
        <a class="brand" href="/sdk/">SignalMonitor SDK</a>
        <div class="links">
          <a href="/agents.md">For AI agents</a>
          <a href="/docs/">API reference</a>
          <a href="/openapi.json">OpenAPI</a>
          <a href="https://www.npmjs.com/package/@sigmon/sdk">npm</a>
        </div>
      </nav>
    </header>
    <main><article>${content}</article></main>
  </body>
</html>`;
}

export async function registerSdkDocsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/sdk", async (_request, reply) => reply.redirect("/sdk/", 301));

  app.get("/sdk/", async (_request, reply) => {
    const source = await readSdkReadme();
    return reply
      .header("Content-Security-Policy", docsContentSecurityPolicy)
      .type("text/html; charset=utf-8")
      .send(renderSdkPage(source));
  });

  app.get("/agents.md", async (_request, reply) => {
    const source = await readAgentSetup();
    return reply.type("text/markdown; charset=utf-8").send(source);
  });
}
