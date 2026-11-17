/**
 * Grade bucket order verified against the official UTD Trends frontend
 * (14 buckets). The API returns the same fixed-length distribution.
 */
export const GRADE_BUCKETS = [
  'A+',
  'A',
  'A-',
  'B+',
  'B',
  'B-',
  'C+',
  'C',
  'C-',
  'D+',
  'D',
  'D-',
  'F',
  'W',
] as const;

export type GradeBucket = (typeof GRADE_BUCKETS)[number];

export const GRADE_BUCKET_COUNT = GRADE_BUCKETS.length;

export interface GradeCounts {
  buckets: Record<string, number>;
  observations: number;
}

/** Builds an ordered, labelled bucket map from a validated 14-length distribution. */
export function toGradeCounts(distribution: readonly number[]): GradeCounts {
  const buckets: Record<string, number> = {};
  let observations = 0;
  for (let index = 0; index < GRADE_BUCKETS.length; index += 1) {
    const count = distribution[index] ?? 0;
    buckets[GRADE_BUCKETS[index]!] = count;
    observations += count;
  }
  return { buckets, observations };
}
