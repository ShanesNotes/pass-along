export function cosineSimilarity(
  left: readonly number[],
  right: readonly number[]
): number {
  if (left.length !== right.length) {
    throw new Error(
      `Cannot compare vectors with different dimensions: ${left.length} and ${right.length}`
    );
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function normalizeVector(vector: readonly number[]): readonly number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (magnitude === 0) {
    return [...vector];
  }

  return vector.map((value) => value / magnitude);
}
