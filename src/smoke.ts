import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function main() {
  await runNodeScript("dist/src/test/unit.js");
  await runNodeScript("dist/src/test/integration.js");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function runNodeScript(scriptPath: string) {
  const { stdout, stderr } = await execFileAsync("node", [scriptPath], {
    cwd: process.cwd(),
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 10
  });

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}
