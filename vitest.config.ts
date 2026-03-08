import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "workspaces/**",
      "node_modules/**",
      "dist/**",
    ],
  },
});
