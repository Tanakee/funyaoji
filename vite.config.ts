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
    // サーバーのテストのために、開発サーバーを立てる
    globalSetup: ["src/server/test-setup.ts"],
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
