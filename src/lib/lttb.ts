/**
 * Largest Triangle Three Buckets (LTTB) — KB §11.4
 *
 * Algoritmo di downsampling che preserva la forma visiva delle curve:
 * conserva sempre il primo e l'ultimo punto, e per ogni bucket sceglie il
 * punto che forma il triangolo di area massima con il punto precedente già
 * scelto e la media del bucket successivo.
 *
 * Rif: Sveinn Steinarsson, "Downsampling Time Series for Visual Representation",
 * MSc thesis Univ. Iceland 2013.
 *
 * Complessità: O(n). Se `data.length <= targetCount`, ritorna i dati invariati.
 */

export interface Point {
  x: number;
  y: number;
}

export function downsampleLTTB<T extends Point>(data: T[], targetCount: number): T[] {
  if (targetCount >= data.length || targetCount < 3) return data;

  const sampled: T[] = new Array(targetCount);
  const bucketSize = (data.length - 2) / (targetCount - 2);

  sampled[0] = data[0];                          // primo punto sempre incluso
  let a = 0;                                     // indice del punto già scelto

  for (let i = 0; i < targetCount - 2; i++) {
    // Media del bucket successivo (per il triangolo)
    const nextStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextEnd   = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length);
    let avgX = 0, avgY = 0;
    const avgCount = nextEnd - nextStart;
    for (let j = nextStart; j < nextEnd; j++) {
      avgX += data[j].x;
      avgY += data[j].y;
    }
    avgX /= avgCount;
    avgY /= avgCount;

    // Bucket corrente: scegli il punto con triangolo di area massima
    const curStart = Math.floor(i * bucketSize) + 1;
    const curEnd   = Math.floor((i + 1) * bucketSize) + 1;
    const pointA = data[a];
    let maxArea = -1;
    let chosenIdx = curStart;
    for (let j = curStart; j < curEnd; j++) {
      const area = Math.abs(
        (pointA.x - avgX) * (data[j].y - pointA.y) -
        (pointA.x - data[j].x) * (avgY - pointA.y),
      ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        chosenIdx = j;
      }
    }

    sampled[i + 1] = data[chosenIdx];
    a = chosenIdx;
  }

  sampled[targetCount - 1] = data[data.length - 1]; // ultimo punto sempre incluso
  return sampled;
}
