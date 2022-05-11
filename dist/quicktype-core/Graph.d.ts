export declare class Graph<T> {
    private readonly _nodes;
    private readonly _indexByNode;
    private readonly _successors;
    constructor(nodes: Iterable<T>, invertDirection: boolean, edges: number[][] | ((node: T) => ReadonlySet<T>));
    readonly size: number;
    readonly nodes: ReadonlyArray<T>;
    findRoots(): ReadonlySet<T>;
    dfsTraversal(root: T, preOrder: boolean, process: (node: T) => void): void;
    stronglyConnectedComponents(): Graph<ReadonlySet<T>>;
    makeDot(includeNode: (n: T) => boolean, nodeLabel: (n: T) => string): string;
}
