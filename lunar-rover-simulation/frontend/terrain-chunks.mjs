// The outer edges always retain every DEM sample so adjacent levels meet exactly.
export function terrainIndices(width, height, step) {
  const indices = [];
  const endCol = width - 1;
  const endRow = height - 1;
  if (endCol === 1 || endRow === 1) step = 1;
  const next = step === 1 ? start => start + 1
    : (start, end) => end - start <= step + 1 ? end : start + step;
  for (let row = 0; row < endRow;) {
    const bottom = next(row, endRow);
    for (let col = 0; col < endCol;) {
      const right = next(col, endCol);
      const a = row * width + col;
      const b = row * width + right;
      const c = bottom * width + col;
      const d = bottom * width + right;
      if (step === 1 || (row && col && bottom !== endRow && right !== endCol)) {
        indices.push(a, b, c, b, d, c);
      } else {
        const center = Math.floor((row + bottom) / 2) * width + Math.floor((col + right) / 2);
        const ring = [a];
        if (row === 0) for (let x = a + 1; x < b; x++) ring.push(x);
        ring.push(b);
        if (right === endCol) for (let x = b + width; x < d; x += width) ring.push(x);
        ring.push(d);
        if (bottom === endRow) for (let x = d - 1; x > c; x--) ring.push(x);
        ring.push(c);
        if (col === 0) for (let x = c - width; x > a; x -= width) ring.push(x);
        for (let i = 0; i < ring.length; i++) {
          indices.push(center, ring[i], ring[(i + 1) % ring.length]);
        }
      }
      col = right;
    }
    row = bottom;
  }
  return new Uint16Array(indices);
}
