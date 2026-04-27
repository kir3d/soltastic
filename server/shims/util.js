export function formatWithOptions(_options, ...args) {
  return args.map((v) => {
    if (typeof v === "string") return v;

    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }).join(" ");
}

export const types = {
  isProxy: () => false,
  isRegExp: (v) => v instanceof RegExp,
  isDate: (v) => v instanceof Date,
  isNativeError: (v) => v instanceof Error,
  isPromise: (v) => !!v && typeof v.then === "function",
  isTypedArray: (v) => ArrayBuffer.isView(v) && !(v instanceof DataView),
  isArrayBuffer: (v) => v instanceof ArrayBuffer,
};
