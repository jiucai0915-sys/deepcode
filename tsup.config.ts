import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "bin/deepcode": "bin/deepcode.ts",
    "src/smoke": "src/smoke.ts"
  },
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
  dts: false
});
