import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Mirror tsconfig's `@/*` path mapping so component modules under test
      // resolve their `@/components/...` imports.
      { find: "@", replacement: repoRoot },
    ],
  },
  test: {
    environment: "node",
  },
});
