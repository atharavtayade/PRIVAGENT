const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createPNG(size) {
  const width = size;
  const height = size;

  // Raw RGBA pixels with 1 byte filter prefix per scanline
  const scanlineLength = 1 + width * 4;
  const rawData = Buffer.alloc(height * scanlineLength);

  const center = size / 2;
  const radius = size * 0.44;

  for (let y = 0; y < height; y++) {
    const lineOffset = y * scanlineLength;
    rawData[lineOffset] = 0; // Filter: None

    for (let x = 0; x < width; x++) {
      const pxOffset = lineOffset + 1 + x * 4;
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Rounded Shield / Cyber Circle shape
      if (dist <= radius) {
        if (dist > radius - 2) {
          // Cyan rim
          rawData[pxOffset + 0] = 6;
          rawData[pxOffset + 1] = 182;
          rawData[pxOffset + 2] = 212;
          rawData[pxOffset + 3] = 255;
        } else {
          // Dark indigo body
          rawData[pxOffset + 0] = 15;
          rawData[pxOffset + 1] = 23;
          rawData[pxOffset + 2] = 42;
          rawData[pxOffset + 3] = 255;

          // Eye / Aperture in center
          const eyeDist = Math.sqrt(dx * dx + (dy * 1.5) * (dy * 1.5));
          if (eyeDist <= size * 0.18) {
            // Inner pupil (Cyan)
            rawData[pxOffset + 0] = 56;
            rawData[pxOffset + 1] = 189;
            rawData[pxOffset + 2] = 248;
            rawData[pxOffset + 3] = 255;
          } else if (Math.abs(dy) <= size * 0.12 && Math.abs(dx) <= size * 0.28) {
            // White eye sclera
            rawData[pxOffset + 0] = 248;
            rawData[pxOffset + 1] = 250;
            rawData[pxOffset + 2] = 252;
            rawData[pxOffset + 3] = 255;
          }
        }
      } else {
        // Transparent outside
        rawData[pxOffset + 0] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      }
    }
  }

  // Compress IDAT
  const compressed = zlib.deflateSync(rawData);

  // PNG Signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR Chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // 8-bit depth
  ihdrData[9] = 6;  // RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // no interlace

  const ihdrChunk = makeChunk('IHDR', ihdrData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crc = crc32(chunk.subarray(4, 8 + len));
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

const outDir = path.join(__dirname, 'extension', 'assets', 'icons');
fs.mkdirSync(outDir, { recursive: true });

[16, 48, 128].forEach(size => {
  const png = createPNG(size);
  const filePath = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated ${filePath} (${png.length} bytes)`);
});
