#!/usr/bin/env node
// Simple static server to serve index.html and local assets from the same directory.
// Usage:
//   node soltastic_client.js
//   NO_OPEN=1 node soltastic_client.js
//   PORT=8000 node soltastic_client.js
//
// Open http://localhost:3000 in your browser.
// localhost is a secure context for Web Bluetooth.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT_DIR = __dirname;
const INDEX_FILE = path.join(ROOT_DIR, "index.html");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function send(res, statusCode, contentType, body) {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });

  res.end(body);
}

function sendFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(filePath)
    .on("error", (err) => {
      send(
        res,
        500,
        "text/plain; charset=utf-8",
        `Read error: ${err.message}`
      );
    })
    .pipe(res);
}

function resolveStaticPath(requestUrl) {
  let pathname;

  try {
    pathname = decodeURIComponent(
      new URL(requestUrl, `http://${HOST}:${PORT}`).pathname
    );
  } catch {
    pathname = "/";
  }

  if (pathname === "/") {
    return INDEX_FILE;
  }

  const requestedPath = path.resolve(ROOT_DIR, `.${pathname}`);

  // Prevent path traversal outside ROOT_DIR.
  if (
    requestedPath !== ROOT_DIR &&
    !requestedPath.startsWith(ROOT_DIR + path.sep)
  ) {
    return null;
  }

  return requestedPath;
}

function notFoundPage() {
  let files = "";

  try {
    files = fs.readdirSync(ROOT_DIR).join("\n");
  } catch (e) {
    files = `Cannot read directory: ${e.message}`;
  }

  return `<h2>File not found</h2>
<p>Root directory:</p>
<pre>${escapeHtml(ROOT_DIR)}</pre>
<p>Files in this folder:</p>
<pre>${escapeHtml(files)}</pre>`;
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "text/plain; charset=utf-8", "Method not allowed");
    return;
  }

  const filePath = resolveStaticPath(req.url);

  if (!filePath) {
    send(res, 403, "text/plain; charset=utf-8", "Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    if (path.basename(filePath) === "favicon.ico") {
      send(res, 204, "text/plain; charset=utf-8", "");
      return;
    }

    send(res, 404, "text/html; charset=utf-8", notFoundPage());
    return;
  }

  sendFile(req, res, filePath);
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}/`;

  console.log(`Server running at ${url}`);

  if (fs.existsSync(INDEX_FILE)) {
    console.log(`Serving: ${INDEX_FILE}`);
  } else {
    console.warn(`Warning: index.html not found at ${INDEX_FILE}`);
  }

  if (process.env.NO_OPEN !== "1") {
    const openCmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";

    exec(`${openCmd} ${url}`, () => {
      // best effort; ignore browser open errors
    });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    console.error(`Try: PORT=${PORT + 1} node soltastic_client.js`);
    process.exit(1);
  }

  console.error(err);
  process.exit(1);
});
