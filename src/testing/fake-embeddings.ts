// A deterministic stand-in for an embedding model: a bag of words, each word hashed to one
// dimension. Texts that share words get similar vectors, so ranking tests mean something,
// and the same text always gets the same vector. Used by the scripted LmClient and by the
// fake LM Studio server, so both answer alike.

export const fakeEmbeddingDimensions = 256;

export function fakeEmbedding(text: string, dimensions = fakeEmbeddingDimensions): number[] {
  const vector: number[] = Array.from({ length: dimensions }, () => 0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const slot = hashWord(word) % dimensions;
    vector[slot] = (vector[slot] ?? 0) + 1;
  }
  // A real model never returns the zero vector, and cosine similarity is undefined for it.
  if (dimensions > 0 && !vector.some((value) => value !== 0)) vector[0] = 1;
  return vector;
}

/** FNV-1a, 32 bits. */
function hashWord(word: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < word.length; index++) {
    hash ^= word.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
