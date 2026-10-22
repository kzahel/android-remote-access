import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "protocol/test/**/*.test.ts",
      "relay/test/**/*.test.ts",
      "web/test/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
  },
});
