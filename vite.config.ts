import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
    base: process.env.GITHUB_ACTIONS ? "/CusionBadApple/" : "/",
    plugins: [vue()],
    resolve: {
        alias: {
            "node:fs/promises": fileURLToPath(new URL("./web/virtual-fs.ts", import.meta.url)),
            "node:path": "path-browserify",
        },
    },
    optimizeDeps: {
        exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/core"],
    },
    build: {
        target: "es2022",
        chunkSizeWarningLimit: 35000,
    },
});
