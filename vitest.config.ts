import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts", "test/contract/**/*.test.ts"],
    exclude: ["test/live/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"]
    }
  }
});
