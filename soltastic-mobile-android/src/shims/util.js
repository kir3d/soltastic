function safeStringify(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
    return String(value);
  }

  if (value instanceof Error) {
    return value.stack || value.message || String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function inspect(value) {
  return safeStringify(value);
}

export function format(...args) {
  if (args.length === 0) return '';

  let first = String(args[0]);
  let index = 1;

  first = first.replace(/%[sdjifoO%]/g, (token) => {
    if (token === '%%') return '%';
    if (index >= args.length) return token;

    const value = args[index++];

    switch (token) {
      case '%s':
        return String(value);
      case '%d':
      case '%i':
        return String(parseInt(value, 10));
      case '%f':
        return String(parseFloat(value));
      case '%j':
      case '%o':
      case '%O':
        return safeStringify(value);
      default:
        return token;
    }
  });

  const rest = args.slice(index).map(safeStringify);
  return [first, ...rest].join(' ');
}

export function formatWithOptions(_options, ...args) {
  return format(...args);
}

export function promisify(fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('The "original" argument must be of type Function');
  }

  if (fn[promisify.custom]) {
    return fn[promisify.custom];
  }

  const promisified = function (...args) {
    return new Promise((resolve, reject) => {
      fn.call(this, ...args, (err, value) => {
        if (err) {
          reject(err);
        } else {
          resolve(value);
        }
      });
    });
  };

  Object.defineProperty(promisified, 'name', {
    value: fn.name || 'promisified',
    configurable: true,
  });

  return promisified;
}

promisify.custom = Symbol.for('nodejs.util.promisify.custom');

export function callbackify(fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('The "original" argument must be of type Function');
  }

  return function (...args) {
    const cb = args.pop();

    fn.apply(this, args)
      .then((value) => cb(null, value))
      .catch((err) => cb(err));
  };
}

export function inherits(ctor, superCtor) {
  if (!ctor || !superCtor) return;
  ctor.super_ = superCtor;
  ctor.prototype = Object.create(superCtor.prototype, {
    constructor: {
      value: ctor,
      enumerable: false,
      writable: true,
      configurable: true,
    },
  });
}

export const types = {
  isNativeError(value) {
    return value instanceof Error;
  },
  isDate(value) {
    return value instanceof Date;
  },
  isRegExp(value) {
    return value instanceof RegExp;
  },
  isArrayBuffer(value) {
    return value instanceof ArrayBuffer;
  },
  isTypedArray(value) {
    return ArrayBuffer.isView(value);
  },
  isPromise(value) {
    return !!value && typeof value.then === 'function';
  },
  isMap(value) {
    return value instanceof Map;
  },
  isSet(value) {
    return value instanceof Set;
  },
};

export default {
  inspect,
  format,
  formatWithOptions,
  promisify,
  callbackify,
  inherits,
  types,
};
