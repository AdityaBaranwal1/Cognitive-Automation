import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    test: {
        environment: "jsdom",
        globals: false,
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        exclude: [
            "node_modules",
            "dist",
            "src-tauri",
            "src/lib/__tests__/provider-system.test.ts",
        ],
    },
});
