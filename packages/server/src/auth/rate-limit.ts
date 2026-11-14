interface Bucket {
  timestamps: number[];
}

const windows = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = windows.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((time) => now - time < windowMs);
  if (bucket.timestamps.length >= limit) {
    windows.set(key, bucket);
    return false;
  }
  bucket.timestamps.push(now);
  windows.set(key, bucket);
  return true;
}

export function resetRateLimit(): void {
  windows.clear();
}
