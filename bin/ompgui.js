#!/usr/bin/env node
"use strict";
const { getUnsupportedNodeVersionMessage, isNodeVersionSupported } = require("./node-version");
if (!isNodeVersionSupported(process.versions.node)) { console.error(getUnsupportedNodeVersionMessage(process.versions.node)); process.exit(1); }
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { parseLaunchOptions } = require("./ompgui-options");
const pkgDir = path.join(__dirname, "..");
const options = parseLaunchOptions();
if (options.help || options.version) process.exit(0);
if (options.command) {
  if (options.command !== "update" || options.extraPositionals.length) {
    console.error(`Unknown ompgui command: ${[options.command, ...options.extraPositionals].join(" ")}`);
    process.exit(1);
  }
  const { updateOmpGui } = require("./ompgui-update");
  updateOmpGui({ packageDir: pkgDir }).catch((error) => {
    console.error(`Could not update ompgui: ${error.message}`);
    process.exitCode = 1;
  });
  return;
}
const { isPortAvailable } = require("./port-availability");
const { wireChildProcessLifecycle } = require("./process-lifecycle");
const nextDir = path.join(pkgDir, ".next");
let nextBin;
try { nextBin = require.resolve("next/dist/bin/next", { paths:[pkgDir] }); } catch { try { nextBin = path.join(path.dirname(require.resolve("next/package.json", {paths:[pkgDir]})), "dist", "bin", "next"); } catch { nextBin = path.join(pkgDir,"node_modules/next/dist/bin/next"); } }
const { port, hostname, password, openBrowser } = options;
if (password) { process.env.OMPGUI_PASSWORD = password; process.env.OMP_WEB_PASSWORD = password; }
const loopback = new Set(["127.0.0.1","localhost","::1","[::1]"]);
if (!loopback.has(hostname) && !(typeof password === "string" && password.length)) { console.error(`Refusing to listen on ${hostname} without OMPGUI_PASSWORD (or --password). Set a strong password or bind to 127.0.0.1.`); process.exit(1); }
if (!fs.existsSync(nextDir)) { console.error("Build artifacts not found. Please report this issue."); process.exit(1); }
const url = `http://${hostname}:${port}`;
function openBrowserWindow(target) { const cmd = process.platform === "win32" ? "cmd.exe" : process.platform === "darwin" ? "open" : process.platform === "linux" && (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) ? "wslview" : "xdg-open"; const args = process.platform === "win32" ? ["/c","start","",target] : [target]; try { const p=spawn(cmd,args,{stdio:"ignore",detached:true}); p.on("error",e=>console.warn(`Could not open browser automatically: ${e.message}`)); p.unref(); } catch(e) { console.warn(`Could not open browser automatically: ${e.message}`); } }
async function main() {
  if (!await isPortAvailable(port, hostname)) { console.log(`ompgui is already running on ${hostname}:${port}.`); if (openBrowser) openBrowserWindow(url); return; }
  const env={...process.env, OMPGUI_PACKAGE_DIR:pkgDir, OMPGUI_LAUNCHER_PID:String(process.pid), OMPGUI_PORT:port, OMPGUI_HOSTNAME:hostname, OMP_WEB_PACKAGE_DIR:pkgDir, OMP_WEB_LAUNCHER_PID:String(process.pid), OMP_WEB_PORT:port, OMP_WEB_HOSTNAME:hostname};
  const child=spawn(process.execPath,[nextBin,"start","-p",port,"-H",hostname],{cwd:pkgDir,stdio:["inherit","pipe","inherit"],env}); wireChildProcessLifecycle(child);
  let opened=false; const ready=()=>{if(!openBrowser||opened)return; opened=true; openBrowserWindow(url);}; child.stdout.on("data",c=>{process.stdout.write(c);if(/ready|started|local:\s*http|listening/i.test(c.toString()))ready();});
  if(openBrowser){const timer=setInterval(async()=>{if(opened)return clearInterval(timer);if(!await isPortAvailable(port,hostname)){clearInterval(timer);ready();}},250);setTimeout(()=>clearInterval(timer),15000);}
}
main().catch(e=>{console.error(`Could not check whether ${url} is available: ${e.message}`);process.exit(1);});
