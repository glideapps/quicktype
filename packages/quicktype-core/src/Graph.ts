import { setMap } from "collection-utils";

import { defined, repeated, assert, repeatedCall } from "./support/Support";

function countComponentGraphNodes (components: number[][]): number {
    if (components.length === 0) return 0;

    let largest = -1;
    let count = 0;

    for (const c of components) {
        assert(c.length > 0, "Empty component not allowed");
        for (const v of c) {
            assert(v >= 0, "Negative vertex index is invalid");
            largest = Math.max(largest, v);
            count += 1;
        }
    }

    assert(largest + 1 === count, "Vertex indexes and count don't match up");
    return count;
}

// https://en.wikipedia.org/wiki/Tarjan%27s_strongly_connected_components_algorithm
function stronglyConnectedComponents (successors: number[][]): number[][] {
    let index = 0;
    const stack: number[] = [];
    const numNodes = successors.length;
    const indexes: number[] = repeated(numNodes, -1);
    const lowLinks: number[] = repeated(numNodes, -1);
    const onStack: boolean[] = repeated(numNodes, false);
    const sccs: number[][] = [];

    function strongconnect (v: number): void {
        // Set the depth index for v to the smallest unused index
        indexes[v] = index;
        lowLinks[v] = index;
        index += 1;

        stack.push(v);
        onStack[v] = true;

        // Consider successors of v
        for (const w of successors[v]) {
            if (indexes[w] < 0) {
                // Successor w has not yet been visited; recurse on it
                strongconnect(w);
                lowLinks[v] = Math.min(lowLinks[v], lowLinks[w]);
            } else if (onStack[w]) {
                // Successor w is in stack and hence in the current SCC
                // If w is not on stack, then (v, w) is a cross-edge in the DFS tree and must be ignored
                // Note: The next line may look odd - but is correct.
                // It says w.index not w.lowlink; that is deliberate and from the original paper
                lowLinks[v] = Math.min(lowLinks[v], indexes[w]);
            }
        }

        // If v is a root node, pop the stack and generate an SCC
        if (lowLinks[v] === indexes[v]) {
            const scc: number[] = [];
            let w: number;
            do {
                w = defined(stack.pop());
                onStack[w] = false;
                scc.push(w);
            } while (w !== v);

            sccs.push(scc);
        }
    }

    for (let v = 0; v < numNodes; v++) {
        if (indexes[v] < 0) {
            strongconnect(v);
        }
    }

    assert(countComponentGraphNodes(sccs) === numNodes, "We didn't put all the nodes into SCCs");

    return sccs;
}

function buildComponentOfNodeMap (successors: number[][], components: number[][]): number[] {
    const numComponents = components.length;
    const numNodes = successors.length;

    assert(numNodes === countComponentGraphNodes(components), "Components don't match up with graph");

    const componentOfNode: number[] = repeated(numNodes, -1);
    for (let c = 0; c < numComponents; c++) {
        for (const n of components[c]) {
            assert(componentOfNode[n] < 0, "We have a node that's in two components");
            componentOfNode[n] = c;
        }
    }

    return componentOfNode;
}

function buildMetaSuccessors (successors: number[][], components: number[][]): number[][] {
    const numComponents = components.length;
    const componentOfNode = buildComponentOfNodeMap(successors, components);
    const componentAdded: boolean[] = repeated(numComponents, false);

    const metaSuccessors: number[][] = [];

    for (let c = 0; c < numComponents; c++) {
        const succ: number[] = [];
        for (const n of components[c]) {
            for (const s of successors[n]) {
                const ms = componentOfNode[s];
                if (ms === c || componentAdded[ms]) continue;
                succ.push(ms);
                componentAdded[ms] = true;
            }
        }

        // reset bookkeeping
        for (const ms of succ) {
            assert(componentAdded[ms]);
            componentAdded[ms] = false;
        }

        metaSuccessors.push(succ);
    }

    return metaSuccessors;
}

function invertEdges (successors: number[][]): number[][] {
    const numNodes = successors.length;
    const predecessors: number[][] = repeatedCall(numNodes, () => []);

    for (let s = 0; s < numNodes; s++) {
        for (const v of successors[s]) {
            predecessors[v].push(s);
        }
    }

    return predecessors;
}

function calculateInDegrees (successors: number[][]): number[] {
    const numNodes = successors.length;
    const inDegrees: number[] = repeated(numNodes, 0);

    for (const s of successors) {
        for (const v of s) {
            inDegrees[v] += 1;
        }
    }

    return inDegrees;
}

function findRoots (successors: number[][]): number[] {
    const numNodes = successors.length;
    const inDegrees = calculateInDegrees(successors);
    const roots: number[] = [];

    for (let v = 0; v < numNodes; v++) {
        if (inDegrees[v] === 0) {
            roots.push(v);
        }
    }

    return roots;
}

export class Graph<T> {
    private readonly _nodes: readonly T[];

    private readonly _indexByNode: ReadonlyMap<T, number>;

    private readonly _successors: number[][];

    constructor (nodes: Iterable<T>, invertDirection: boolean, edges: number[][] | ((node: T) => ReadonlySet<T>)) {
        this._nodes = Array.from(nodes);
        this._indexByNode = new Map(this._nodes.map((n, i): [T, number] => [n, i]));
        let edgesArray: number[][];
        if (Array.isArray(edges)) {
            edgesArray = edges;
        } else {
            edgesArray = this._nodes.map(n => Array.from(edges(n)).map(s => defined(this._indexByNode.get(s))));
        }

        if (invertDirection) {
            edgesArray = invertEdges(edgesArray);
        }

        this._successors = edgesArray;
    }

    get size (): number {
        return this._nodes.length;
    }

    get nodes (): readonly T[] {
        return this._nodes;
    }

    findRoots (): ReadonlySet<T> {
        const roots = findRoots(this._successors);
        return new Set(roots.map(n => this._nodes[n]));
    }

    // The subgraph starting at `root` must be acyclic.
    dfsTraversal (root: T, preOrder: boolean, process: (node: T) => void): void {
        const visited = repeated(this.size, false);

        const visit = (v: number): void => {
            if (visited[v]) return;
            visited[v] = true;

            if (preOrder) {
                process(this._nodes[v]);
            }

            for (const w of this._successors[v]) {
                visit(w);
            }

            if (!preOrder) {
                process(this._nodes[v]);
            }
        };

        visit(defined(this._indexByNode.get(root)));
    }

    stronglyConnectedComponents (): Graph<ReadonlySet<T>> {
        const components = stronglyConnectedComponents(this._successors);
        const componentSuccessors = buildMetaSuccessors(this._successors, components);
        return new Graph(
            components.map(ns => setMap(ns, n => this._nodes[n])),
            false,
            componentSuccessors,
        );
    }

    makeDot (includeNode: (n: T) => boolean, nodeLabel: (n: T) => string): string {
        const lines: string[] = [];
        lines.push("digraph G {");
        lines.push("    ordering = out;");
        lines.push("");

        for (let i = 0; i < this.size; i++) {
            const n = this._nodes[i];
            if (!includeNode(n)) continue;
            lines.push(`    node${i} [label="${nodeLabel(n)}"];`);
        }

        for (let i = 0; i < this.size; i++) {
            if (!includeNode(this._nodes[i])) continue;
            for (const j of this._successors[i]) {
                if (!includeNode(this._nodes[j])) continue;
                lines.push(`    node${i} -> node${j};`);
            }
        }

        lines.push("}");
        lines.push("");

        return lines.join("\n");
    }
}
