import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [react()],
  appType: "mpa",
  build: {
    rolldownOptions: {
      input: ["index.html", "screen.html", "play.html"],
    },
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
