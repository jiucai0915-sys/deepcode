import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "bin/deepcode": "bin/deepcode.ts",
    "src/smoke": "src/smoke.ts",
    "src/test/unit": "src/test/unit.ts",
    "src/test/integration": "src/test/integration.ts"
  },
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
  dts: false
});
