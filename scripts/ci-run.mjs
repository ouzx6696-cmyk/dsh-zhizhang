import { spawn } from "node:child_process";
const [command, ...args] = process.argv.slice(2);
let tail = "";
const child = spawn(command, args, {
  stdio: ["inherit", "pipe", "pipe"],
  shell: process.platform === "win32",
});
for (const [stream, output] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
])
  stream.on("data", (chunk) => {
    output.write(chunk);
    tail = (tail + chunk.toString()).slice(-12000);
  });
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  if (signal) console.error(`Command terminated by ${signal}`);
  if (code !== 0) {
    const escaped = tail
      .slice(-6000)
      .replace(/%/g, "%25")
      .replace(/\r/g, "%0D")
      .replace(/\n/g, "%0A");
    console.error("::error::" + escaped);
  }
  process.exitCode = code === 0 && !signal ? 0 : 1;
});
