import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["test/integration/**", "node_modules/**", "dist/**"],
    setupFiles: ["src/test/setup.ts"],
  },
});
