import { spawn } from "node:child_process";

export function openBrowser(url: string): Promise<void> {
  const command = process.platform === "darwin"
    ? { executable: "open", args: [url] }
    : process.platform === "win32"
      ? { executable: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }
      : { executable: "xdg-open", args: [url] };

  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      detached: true,
      stdio: "ignore",
      shell: false
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
