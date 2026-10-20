'use strict';

// ESC/POS bytes for a receipt the till already rendered as text.
// This is the network thermal path (port 9100). A Windows driver printer
// still uses the silent print dialog path. No vendor SDK.

const ESC = 0x1b;
const GS = 0x1d;

function encode(text, { cut = true, drawer = false } = {}) {
  const parts = [
    Buffer.from([ESC, 0x40]),
    Buffer.from([ESC, 0x61, 0x00]),
    Buffer.from(String(text || '').replace(/\r\n/g, '\n'), 'utf8'),
    Buffer.from('\n\n'),
  ];
  if (drawer) parts.push(Buffer.from([ESC, 0x70, 0x00, 0x32, 0x32]));
  if (cut) parts.push(Buffer.from([GS, 0x56, 0x00]));
  return Buffer.concat(parts);
}

module.exports = { encode };
