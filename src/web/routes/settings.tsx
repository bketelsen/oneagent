import { Hono } from "hono";
import { Layout } from "../components/layout.js";
import type { Config } from "../../config/schema.js";

export function maskToken(token: string | undefined): string {
  if (!token) return "Not configured";
  if (token.length <= 4) return "****";
  // Preserve prefix (e.g. "ghp_") if present, mask middle, show last 4
  const last4 = token.slice(-4);
  const prefixMatch = token.match(/^(ghp_|gho_|ghs_|ghr_|github_pat_)/);
  const prefix = prefixMatch ? prefixMatch[1] : "";
  return `${prefix}****${last4}`;
}

export function settingsRoute(getConfig: () => Config): Hono {
  const route = new Hono();

  route.get("/", (c) => {
    const config = getConfig();
    const safeConfig = structuredClone(config);
    safeConfig.github.token = maskToken(config.github.token);
    return c.html(
      <Layout title="Settings">
        <h1 class="text-2xl font-bold mb-4">Settings</h1>
        <pre class="bg-gray-800 rounded p-4 text-sm overflow-x-auto">
          {JSON.stringify(safeConfig, null, 2)}
        </pre>
      </Layout>
    );
  });

  return route;
}
