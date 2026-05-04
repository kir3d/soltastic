export default function crc16ccitt(input, previous) {
  let crc = typeof previous === 'number' ? previous : 0xffff;

  let bytes;

  if (typeof input === 'string') {
    bytes = Array.from(input).map((ch) => ch.charCodeAt(0) & 0xff);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else if (Array.isArray(input)) {
    bytes = input;
  } else if (input && typeof input.length === 'number') {
    bytes = Array.from(input);
  } else {
    bytes = [];
  }

  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= (bytes[i] & 0xff) << 8;

    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }

      crc &= 0xffff;
    }
  }

  return crc & 0xffff;
}
