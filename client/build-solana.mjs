import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["./solana-entry.js"],
  bundle: true,
  platform: "browser",
  format: "esm",
  outfile: "./solana-wb.js",
  loader: {
    ".wasm": "file",
  },
  publicPath: "./",
  define: {
    "process.env.NODE_ENV": '"production"',
    global: "globalThis",
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

console.log("✅ Built ./solana-wb.js with Solana web3 + SPL token");
