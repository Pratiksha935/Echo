import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const output = new URL("../netlify-dist/", import.meta.url);
const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("netlify-demo", Date.now().toString());
const { default: worker } = await import(workerUrl.href);

const routes = ["/", "/workspace", "/integrations", "/code-review", "/demo-article"];
const authenticatedRoutes = new Set(["/workspace", "/integrations"]);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL("../dist/client/", import.meta.url), output, { recursive: true });

for (const route of routes) {
  const headers = new Headers({ accept: "text/html" });
  if (authenticatedRoutes.has(route)) headers.set("oai-authenticated-user-email", "demo@found.so");
  const response = await worker.fetch(
    new Request(`https://found-demo.netlify.app${route}`, { headers }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  if (!response.ok) throw new Error(`Unable to render ${route}: ${response.status}`);
  let html = await response.text();
  html = html.replaceAll("/signin-with-chatgpt?return_to=%2Fworkspace", "/workspace");
  const directory = route === "/" ? output : new URL(`.${route}/`, output);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL("index.html", directory), html);
}

await writeFile(new URL("_redirects", output), "/workspace/* /workspace/index.html 200\n/integrations/* /integrations/index.html 200\n/code-review/* /code-review/index.html 200\n/demo-article/* /demo-article/index.html 200\n");
console.log("Netlify demo ready in netlify-dist");
