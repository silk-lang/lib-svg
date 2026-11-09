// Small deterministic PNG encoder for original benchmark fixtures (8-bit gray/RGB).
import { deflateSync } from 'node:zlib';
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(kind, data) {
  const type = Buffer.from(kind), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([size, type, data, crc]);
}
export function png(width, height, channels, samples) {
  if (![1, 3].includes(channels) || samples.length !== width * height * channels) throw new Error('PNG requires packed 8-bit gray or RGB samples');
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = channels === 1 ? 0 : 2;
  const stride = width * channels, rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) samples.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
