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
      // サーバーにつながないテスト。src/ のどこに置いても実行する
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/server/**", "src/**/*.server.test.ts"],
        },
      },
      {
        // サーバーにつなぐテスト（src/server/ のテストと *.server.test.ts）のときだけ、開発サーバーを立てる
        test: {
          name: "server",
          include: ["src/server/**/*.test.ts", "src/**/*.server.test.ts"],
          globalSetup: ["src/server/test-setup.ts"],
        },
      },
    ],
  },
  fmt: {
    // theory.json は学習の道具（ml/）が書き出す。数の列なので、1行のままにする
    ignorePatterns: ["**/*.md", ".github/**", "src/screen/game/ai/theory.json"],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
