import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["protocol/test/**/*.test.ts"] },
});
