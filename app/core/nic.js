// NIC normalization (requirement 9.2). Used by both employee import and
// employee verification so the two paths can never disagree.
//
// Old format: 9 digits + letter (V or X), e.g. 960433149V -> last4 = 3149
//   (the letter is a checksum/sex marker, not part of the digits we compare)
// New format: 12 digits, e.g. 199604303149 -> last4 = 3149

const OLD_FORMAT = /^\d{9}[VX]$/;
const NEW_FORMAT = /^\d{12}$/;
const LAST4_INPUT = /^\d{4}$/;

/**
 * Parses a full NIC (as entered at import time) into its last-4-digit check value.
 * Returns the 4-digit string, or null if the NIC does not match either known format.
 */
export function extractLast4FromFullNic(rawNic) {
  if (typeof rawNic !== 'string') return null;
  const normalized = rawNic.trim().toUpperCase();

  if (OLD_FORMAT.test(normalized)) {
    return normalized.slice(5, 9);
  }
  if (NEW_FORMAT.test(normalized)) {
    return normalized.slice(8, 12);
  }
  return null;
}

/**
 * Validates the 4-digit value a voter/registrant types in. Returns true only
 * for exactly 4 digits.
 */
export function isValidLast4Input(value) {
  return typeof value === 'string' && LAST4_INPUT.test(value.trim());
}

export function normalizeLast4Input(value) {
  return typeof value === 'string' ? value.trim() : value;
}
