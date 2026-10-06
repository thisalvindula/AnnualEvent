import QRCode from 'qrcode';

// 3x5 pixel font for the letters of AMSAFE.
const GLYPHS = {
  A: ['010', '101', '111', '101', '101'],
  M: ['101', '111', '111', '101', '101'],
  S: ['111', '100', '111', '001', '111'],
  F: ['111', '100', '111', '100', '100'],
  E: ['111', '100', '111', '100', '111'],
};
// "AM" in brand red, "SAFE" in brand blue.
const WORD = [...'AMSAFE'].map((ch, i) => ({ ch, tone: i < 2 ? 'red' : 'blue' }));
const WORD_COLS = WORD.length * 3 + (WORD.length - 1); // 23
const WORD_ROWS = 5;
// Version 6 (41x41 modules) keeps the cleared art under ~11% of the code, well
// inside level-H error correction (verified by decoding in tests).
const MIN_VERSION = 6;
const MAX_CLEARED_FRACTION = 0.13;

// QR module grid with "AMSAFE" pixel art cut into the centre. Each cell is
// 'dark' | 'red' | 'blue' | null (light). The art is aligned to the module grid,
// so it reads as part of the code. Level-H correction absorbs the cleared area;
// if the art would be too large for this URL's QR size, it is skipped. Short URLs are bumped to a larger QR size for this.
export function buildQrGrid(url) {
  const auto = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const qr = auto.version >= MIN_VERSION ? auto : QRCode.create(url, { errorCorrectionLevel: 'H', version: MIN_VERSION });
  const n = qr.modules.size;
  const cells = Array.from({ length: n * n }, (_, i) => (qr.modules.data[i] ? 'dark' : null));

  const clearCols = WORD_COLS + 2;
  const clearRows = WORD_ROWS + 2;
  if ((clearCols * clearRows) / (n * n) > MAX_CLEARED_FRACTION) {
    return { n, cells, art: false };
  }
  // Odd/even centring so the art sits on whole modules.
  const c0 = Math.floor((n - clearCols) / 2);
  const r0 = Math.floor((n - clearRows) / 2);
  for (let r = 0; r < clearRows; r++) for (let c = 0; c < clearCols; c++) cells[(r0 + r) * n + c0 + c] = null;
  WORD.forEach(({ ch, tone }, i) => {
    GLYPHS[ch].forEach((row, gr) => {
      [...row].forEach((bit, gc) => {
        if (bit === '1') cells[(r0 + 1 + gr) * n + c0 + 1 + i * 4 + gc] = tone;
      });
    });
  });
  return { n, cells, art: true };
}
