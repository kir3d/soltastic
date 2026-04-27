export const process = {
  env: {
    NODE_ENV: "production",
  },
  browser: true,
  version: "",
  versions: {},
  platform: "browser",
  cwd: () => "/",
  nextTick: (fn, ...args) => Promise.resolve().then(() => fn(...args)),
};
