"use strict";

const { parseArgs } = require("util");
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
function isEnabled(value) { return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase()); }
function printHelp() {
  console.log(`Usage: ompgui [options]
       ompgui update
       ompgui pair [--url wss://host/relay]
       ompgui devices
       ompgui devices revoke <id>

Options:
  -p, --port <port>        Server port (default 30177, env OMPGUI_PORT)
  -H, --hostname <host>    Bind hostname (default 127.0.0.1, env OMPGUI_HOSTNAME)
      --password <pass>    Password for the web sign-in screen (env OMPGUI_PASSWORD)
      --url <wss>          Relay WebSocket URL for pairing (env OMPGUI_RELAY_URL)
      --no-open            Do not open the browser automatically
  -h, --help               Show this help
      --version            Show version

Commands:
  update                   Update ompgui to the latest version
  pair                     Create a one-time phone pairing link
  devices                  List or revoke paired phone devices`);
}
function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  const { values: cliArgs, positionals } = parseArgs({ args, options: { port:{type:"string",short:"p"}, hostname:{type:"string",short:"H"}, password:{type:"string"}, help:{type:"boolean",short:"h"}, version:{type:"boolean"}, "no-open":{type:"boolean"}, url:{type:"string"} }, strict:false, allowPositionals:true });
  const result = { command: positionals[0], extraPositionals: positionals.slice(1), port: cliArgs.port ?? env.OMPGUI_PORT ?? env.PORT ?? env.OMP_WEB_PORT ?? "30177", hostname: cliArgs.hostname ?? env.OMPGUI_HOSTNAME ?? env.OMP_WEB_HOSTNAME ?? "127.0.0.1", password: cliArgs.password ?? env.OMPGUI_PASSWORD ?? env.OMP_WEB_PASSWORD, relayUrl: cliArgs.url ?? env.OMPGUI_RELAY_URL ?? env.OMP_WEB_RELAY_URL, openBrowser: !cliArgs["no-open"] && !isEnabled(env.OMPGUI_NO_OPEN) && !isEnabled(env.OMP_WEB_NO_OPEN) };
  if (cliArgs.help) { printHelp(); result.help = true; }
  if (cliArgs.version) { try { result.version = true; console.log(require("../package.json").version ?? "0.0.0"); } catch { result.version = true; } }
  return result;
}
module.exports = { parseLaunchOptions, isEnabled };
