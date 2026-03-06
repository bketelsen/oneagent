import { Hono } from "hono";
import { Layout } from "../components/layout.js";
import type { Config } from "../../config/schema.js";

export function settingsRoute(getConfig: () => Config): Hono {
  const route = new Hono();

  route.get("/", (c) => {
    const config = getConfig();
    return c.html(
      <Layout title="Settings">
        <h1 class="text-2xl font-bold mb-4">Settings</h1>
        <pre class="bg-gray-800 rounded p-4 text-sm overflow-x-auto">
          {JSON.stringify(config, null, 2)}
        </pre>
      </Layout>
    );
  });

  return route;
}
