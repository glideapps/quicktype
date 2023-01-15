import { assert, panic } from "./support/Support";

export function breakCycles<T>(outEdges: number[][], chooseBreaker: (cycle: number[]) => [number, T]): [number, T][] {
    const numNodes = outEdges.length;
    const inEdges: number[][] = [];
    const inDegree: number[] = [];
    const outDegree: number[] = [];
    const done: boolean[] = [];
    const results: [number, T][] = [];
    for (let i = 0; i < numNodes; i++) {
        inEdges.push([]);
        inDegree.push(0);
        outDegree.push(outEdges[i].length);
        done.push(false);
    }
    for (let i = 0; i < numNodes; i++) {
        for (const n of outEdges[i]) {
            inEdges[n].push(i);
            inDegree[n] += 1;
        }
    }

    const workList: number[] = [];
    for (let i = 0; i < numNodes; i++) {
        if (inDegree[i] === 0 || outDegree[i] === 0) {
            workList.push(i);
        }
    }

    function removeNode(node: number): void {
        for (const n of outEdges[node]) {
            assert(inDegree[n] > 0);
            inDegree[n] -= 1;
            if (inDegree[n] === 0) {
                workList.push(n);
            }
        }

        for (const n of inEdges[node]) {
            assert(outDegree[n] > 0);
            outDegree[n] -= 1;
            if (outDegree[n] === 0) {
                workList.push(n);
            }
        }

        done[node] = true;
    }

    for (;;) {
        const i = workList.pop();
        if (i !== undefined) {
            if (done[i] || (inDegree[i] === 0 && outDegree[i] === 0)) {
                done[i] = true;
                continue;
            }
            assert(inDegree[i] === 0 || outDegree[i] === 0, "Can't have nodes in the worklist with in and out edges");

            removeNode(i);
            continue;
        }

        let n = done.indexOf(false);
        if (n < 0) {
            // We're done!
            break;
        }

        // There's a cycle
        const path: number[] = [n];
        for (;;) {
            // FIXME: We look an arbitrary node that's still in the graph and follow it
            // until we see a cycle.  This cycle might not be the first cycle the needs to
            // be broken.  For example, imagine two cycles that are connected via an edge,
            // i.e. one cycle depends on the other cycle.  The dependee cycle should be
            // broken up first.
            //
            // We could count the number of reachable nodes for all nodes in the graph,
            // and then pick one of the nodes with the lowest number, which would pick
            // the dependee cycle.
            const maybeEdge = outEdges[n].find(x => !done[x]);
            if (maybeEdge === undefined) {
                return panic("Presumed cycle is not a cycle");
            }
            const maybeFirst = path.indexOf(maybeEdge);
            if (maybeFirst === undefined) {
                // No cycle yet, continue
                n = maybeEdge;
                path.push(n);
                continue;
            }

            // We found a cycle - break it
            const cycle = path.slice(maybeFirst);
            const [breakNode, info] = chooseBreaker(cycle);
            assert(cycle.indexOf(breakNode) >= 0, "Breaker chose an invalid node");
            removeNode(breakNode);
            results.push([breakNode, info]);
            break;
        }
        continue;
    }

    return results;
}
