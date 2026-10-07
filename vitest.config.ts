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
    // Sibling worktrees live in `.worktrees/` and each carries the whole
    // repo's tests; without this exclude a run from a checkout that hosts
    // worktrees double-runs every suite against foreign working trees
    // (their fixtures resolve against this checkout's generated files, so
    // most of the doubles fail). Everything else keeps vitest's defaults.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      '**/.{idea,git,cache,output,temp}/**',
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
      "**/.worktrees/**",
    ],
  },
});
