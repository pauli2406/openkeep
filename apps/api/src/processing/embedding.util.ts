export const STORED_EMBEDDING_DIMENSIONS = 3072;

export const padEmbedding = (embedding: number[]): number[] => {
  if (embedding.length === STORED_EMBEDDING_DIMENSIONS) {
    return embedding;
  }

  if (embedding.length > STORED_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding dimensions ${embedding.length} exceed storage dimensions ${STORED_EMBEDDING_DIMENSIONS}`,
    );
  }

  return [...embedding, ...Array(STORED_EMBEDDING_DIMENSIONS - embedding.length).fill(0)];
};

export const serializeHalfVector = (embedding: number[]): string =>
  `[${embedding.map((value) => Number(value.toFixed(8))).join(",")}]`;

export const assertEmbeddings = (
  provider: string,
  model: string,
  embeddings: number[][],
): { dimensions: number; embeddings: number[][] } => {
  if (embeddings.length === 0) {
    throw new Error(`${provider} returned no embeddings for model ${model}`);
  }

  const dimensions = embeddings[0]?.length ?? 0;
  if (dimensions === 0) {
    throw new Error(`${provider} returned empty embedding vectors for model ${model}`);
  }

  for (const embedding of embeddings) {
    if (embedding.length !== dimensions) {
      throw new Error(`${provider} returned inconsistent embedding dimensions`);
    }
  }

  return { dimensions, embeddings };
};
