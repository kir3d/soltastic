import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["./meshtastic-entry.js"],
  bundle: true,
  platform: "browser",
  format: "esm",
  outfile: "./meshtastic-wb.js",
  loader: {
    ".wasm": "file",
  },
  publicPath: "./",
  define: {
    "process.env.NODE_ENV": '"production"',
    "global": "globalThis",
  },
  alias: {
    os: "./shims/os.js",
    path: "./shims/path.js",
    util: "./shims/util.js",
  },
  inject: [
    "./shims/process.js",
    "./shims/buffer.js",
  ],
});

console.log("✅ Built ./meshtastic-wb.js with MeshDevice + TransportWebBluetooth");
