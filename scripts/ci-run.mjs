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
    // GitHub truncates annotation messages by UTF-8 bytes, not JavaScript characters.
    const parts = [];
    let part = "",
      bytes = 0;
    for (const char of tail.slice(-6000)) {
      const size = Buffer.byteLength(char);
      if (bytes + size > 1800) {
        parts.push(part);
        part = "";
        bytes = 0;
      }
      part += char;
      bytes += size;
    }
    if (part) parts.push(part);
    for (const [index, value] of parts.entries()) {
      const escaped = value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
      console.error(`::error title=Command failure ${index + 1}/${parts.length}::` + escaped);
    }
  }
  process.exitCode = signal ? 1 : (code ?? 1);
});
