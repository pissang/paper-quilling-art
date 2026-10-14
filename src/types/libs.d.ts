declare module 'density-clustering' {
  export class KMEANS {
    run(dataset: number[][], k: number): number[][];
    randomCentroid(): number[];
    dataset: number[][];
    centroids: number[][];
  }
  const clustering: { KMEANS: typeof KMEANS };
  export default clustering;
}
