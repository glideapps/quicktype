"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Support_1 = require("./support/Support");
function countComponentGraphNodes(components) {
    if (components.length === 0)
        return 0;
    let largest = -1;
    let count = 0;
    for (const c of components) {
        Support_1.assert(c.length > 0, "Empty component not allowed");
        for (const v of c) {
            Support_1.assert(v >= 0, "Negative vertex index is invalid");
            largest = Math.max(largest, v);
            count += 1;
        }
    }
    Support_1.assert(largest + 1 === count, "Vertex indexes and count don't match up");
    return count;
}
// https://en.wikipedia.org/wiki/Tarjan%27s_strongly_connected_components_algorithm
function stronglyConnectedComponents(successors) {
    let index = 0;
    const stack = [];
    const numNodes = successors.length;
    const indexes = Support_1.repeated(numNodes, -1);
    const lowLinks = Support_1.repeated(numNodes, -1);
    const onStack = Support_1.repeated(numNodes, false);
    const sccs = [];
    function strongconnect(v) {
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
            }
            else if (onStack[w]) {
                // Successor w is in stack and hence in the current SCC
                // If w is not on stack, then (v, w) is a cross-edge in the DFS tree and must be ignored
                // Note: The next line may look odd - but is correct.
                // It says w.index not w.lowlink; that is deliberate and from the original paper
                lowLinks[v] = Math.min(lowLinks[v], indexes[w]);
            }
        }
        // If v is a root node, pop the stack and generate an SCC
        if (lowLinks[v] === indexes[v]) {
            const scc = [];
            let w;
            do {
                w = Support_1.defined(stack.pop());
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
    Support_1.assert(countComponentGraphNodes(sccs) === numNodes, "We didn't put all the nodes into SCCs");
    return sccs;
}
function buildComponentOfNodeMap(successors, components) {
    const numComponents = components.length;
    const numNodes = successors.length;
    Support_1.assert(numNodes === countComponentGraphNodes(components), "Components don't match up with graph");
    const componentOfNode = Support_1.repeated(numNodes, -1);
    for (let c = 0; c < numComponents; c++) {
        for (const n of components[c]) {
            Support_1.assert(componentOfNode[n] < 0, "We have a node that's in two components");
            componentOfNode[n] = c;
        }
    }
    return componentOfNode;
}
function buildMetaSuccessors(successors, components) {
    const numComponents = components.length;
    const componentOfNode = buildComponentOfNodeMap(successors, components);
    const componentAdded = Support_1.repeated(numComponents, false);
    const metaSuccessors = [];
    for (let c = 0; c < numComponents; c++) {
        const succ = [];
        for (const n of components[c]) {
            for (const s of successors[n]) {
                const ms = componentOfNode[s];
                if (ms === c || componentAdded[ms])
                    continue;
                succ.push(ms);
                componentAdded[ms] = true;
            }
        }
        // reset bookkeeping
        for (const ms of succ) {
            Support_1.assert(componentAdded[ms]);
            componentAdded[ms] = false;
        }
        metaSuccessors.push(succ);
    }
    return metaSuccessors;
}
function invertEdges(successors) {
    const numNodes = successors.length;
    const predecessors = Support_1.repeatedCall(numNodes, () => []);
    for (let s = 0; s < numNodes; s++) {
        for (const v of successors[s]) {
            predecessors[v].push(s);
        }
    }
    return predecessors;
}
function calculateInDegrees(successors) {
    const numNodes = successors.length;
    const inDegrees = Support_1.repeated(numNodes, 0);
    for (const s of successors) {
        for (const v of s) {
            inDegrees[v] += 1;
        }
    }
    return inDegrees;
}
function findRoots(successors) {
    const numNodes = successors.length;
    const inDegrees = calculateInDegrees(successors);
    const roots = [];
    for (let v = 0; v < numNodes; v++) {
        if (inDegrees[v] === 0) {
            roots.push(v);
        }
    }
    return roots;
}
class Graph {
    constructor(nodes, invertDirection, edges) {
        this._nodes = Array.from(nodes);
        this._indexByNode = new Map(this._nodes.map((n, i) => [n, i]));
        let edgesArray;
        if (Array.isArray(edges)) {
            edgesArray = edges;
        }
        else {
            edgesArray = this._nodes.map(n => Array.from(edges(n)).map(s => Support_1.defined(this._indexByNode.get(s))));
        }
        if (invertDirection) {
            edgesArray = invertEdges(edgesArray);
        }
        this._successors = edgesArray;
    }
    get size() {
        return this._nodes.length;
    }
    get nodes() {
        return this._nodes;
    }
    findRoots() {
        const roots = findRoots(this._successors);
        return new Set(roots.map(n => this._nodes[n]));
    }
    // The subgraph starting at `root` must be acyclic.
    dfsTraversal(root, preOrder, process) {
        const visited = Support_1.repeated(this.size, false);
        const visit = (v) => {
            if (visited[v])
                return;
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
        visit(Support_1.defined(this._indexByNode.get(root)));
    }
    stronglyConnectedComponents() {
        const components = stronglyConnectedComponents(this._successors);
        const componentSuccessors = buildMetaSuccessors(this._successors, components);
        return new Graph(components.map(ns => collection_utils_1.setMap(ns, n => this._nodes[n])), false, componentSuccessors);
    }
    makeDot(includeNode, nodeLabel) {
        const lines = [];
        lines.push("digraph G {");
        lines.push("    ordering = out;");
        lines.push("");
        for (let i = 0; i < this.size; i++) {
            const n = this._nodes[i];
            if (!includeNode(n))
                continue;
            lines.push(`    node${i} [label="${nodeLabel(n)}"];`);
        }
        for (let i = 0; i < this.size; i++) {
            if (!includeNode(this._nodes[i]))
                continue;
            for (const j of this._successors[i]) {
                if (!includeNode(this._nodes[j]))
                    continue;
                lines.push(`    node${i} -> node${j};`);
            }
        }
        lines.push("}");
        lines.push("");
        return lines.join("\n");
    }
}
exports.Graph = Graph;
