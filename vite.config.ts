import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [react(), cloudflare()],
  environments: {
    client: {
      build: {
        rolldownOptions: {
          input: ["index.html", "screen.html", "play.html"],
        },
      },
    },
  },
  test: {
    projects: [
      { test: { name: "shared", include: ["src/shared/**/*.test.ts"] } },
      {
        // サーバーのテストのときだけ、開発サーバーを立てる
        test: {
          name: "server",
          include: ["src/server/**/*.test.ts"],
          globalSetup: ["src/server/test-setup.ts"],
        },
      },
    ],
  },
  fmt: {
    ignorePatterns: ["**/*.md", ".github/**"],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
