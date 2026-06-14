const minorWords = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to', 'up', 'via', 'with']);

export function titleCase(value: string) {
  const words = value.trim().replace(/\s+/g, ' ').split(' ');
  return words.map((word, index) => {
    const lower = word.toLowerCase();
    if (index > 0 && index < words.length - 1 && minorWords.has(lower)) return lower;
    return lower.replace(/(^|[-/])([a-z])/g, (_match, separator, letter) => `${separator}${letter.toUpperCase()}`);
  }).join(' ');
}

export function sentenceCase(value: string) {
  const trimmed = value.trim();
  return trimmed ? `${trimmed[0].toUpperCase()}${trimmed.slice(1)}` : trimmed;
}
