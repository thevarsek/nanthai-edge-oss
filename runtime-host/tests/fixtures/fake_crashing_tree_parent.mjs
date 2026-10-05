import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const pidFile = process.argv[2];
if (pidFile === undefined) {
  throw new Error("Expected a path for the grandchild PID");
}

const grandchild = spawn(
  process.execPath,
  ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
  { stdio: "ignore" },
);
if (grandchild.pid === undefined) {
  throw new Error("Grandchild did not receive a PID");
}

writeFileSync(pidFile, `${grandchild.pid}\n`, "utf8");
setTimeout(() => process.exit(17), 25);
