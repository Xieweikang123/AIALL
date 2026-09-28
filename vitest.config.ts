import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts", "shared/**/*.test.ts"],
    restoreMocks: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
