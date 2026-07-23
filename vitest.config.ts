import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["test/unit/**/*.test.ts"],
        testTimeout: 30_000,
        typecheck: {
            enabled: true,
            include: ["test/unit/**/*.test-d.ts"],
            tsconfig: "./test/unit/tsconfig.json",
        },
    },
});
