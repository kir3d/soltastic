export function normalize(input) {
  if (!input) return '.';
  return String(input).replace(/\/+/g, '/');
}

export default {
  normalize,
};
