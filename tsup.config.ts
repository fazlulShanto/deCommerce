import { defineConfig, type Options } from "tsup";

export default defineConfig((options: Options) => ({
  entryPoints: ["src/index.ts"],
  outDir: "dist",
  silent: true,
  clean: true,
  format: ["cjs"],
  noExternal: ["@taskcord/database", "@taskcord/redis"],
  ...options,
}));
