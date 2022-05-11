"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Support_1 = require("./support/Support");
const Graph_1 = require("./Graph");
const Messages_1 = require("./Messages");
class DeclarationIR {
    constructor(declarations, forwardedTypes) {
        this.forwardedTypes = forwardedTypes;
        this.declarations = Array.from(declarations);
    }
}
exports.DeclarationIR = DeclarationIR;
function findBreaker(t, path, canBreak) {
    const index = path.indexOf(t);
    if (index < 0)
        return undefined;
    if (canBreak === undefined) {
        return path[index];
    }
    const potentialBreakers = path.slice(0, index + 1).reverse();
    const maybeBreaker = potentialBreakers.find(canBreak);
    if (maybeBreaker === undefined) {
        return Support_1.panic("Found a cycle that cannot be broken");
    }
    return maybeBreaker;
}
function cycleBreakerTypesForGraph(graph, isImplicitCycleBreaker, canBreakCycles) {
    const visitedTypes = new Set();
    const cycleBreakerTypes = new Set();
    const queue = Array.from(graph.topLevels.values());
    function visit(t, path) {
        if (visitedTypes.has(t))
            return;
        if (isImplicitCycleBreaker(t)) {
            for (const c of t.getChildren()) {
                queue.push(c);
            }
        }
        else {
            const maybeBreaker = findBreaker(t, path, canBreakCycles);
            if (maybeBreaker !== undefined) {
                cycleBreakerTypes.add(maybeBreaker);
                return;
            }
            for (const c of t.getChildren()) {
                path.unshift(t);
                visit(c, path);
                path.shift();
            }
        }
        visitedTypes.add(t);
    }
    for (;;) {
        const maybeType = queue.pop();
        if (maybeType === undefined)
            break;
        const path = [];
        visit(maybeType, path);
        Support_1.assert(path.length === 0);
    }
    return cycleBreakerTypes;
}
exports.cycleBreakerTypesForGraph = cycleBreakerTypesForGraph;
function declarationsForGraph(typeGraph, canBeForwardDeclared, childrenOfType, needsDeclaration) {
    /*
    function nodeTitle(t: Type): string {
        const indexAndKind = `${t.typeRef.index} ${t.kind}`;
        if (t.hasNames) {
            return `${indexAndKind} ${t.getCombinedName()}`;
        } else {
            return indexAndKind;
        }
    }
    function componentName(c: Iterable<Type>): string {
        return Array.from(c).map(nodeTitle).join(", ");
    }
    */
    const topDown = canBeForwardDeclared === undefined;
    const declarations = [];
    const forwardedTypes = new Set();
    const visitedComponents = new Set();
    function processGraph(graph, _writeComponents) {
        const componentsGraph = graph.stronglyConnectedComponents();
        function visitComponent(component) {
            if (visitedComponents.has(component))
                return;
            visitedComponents.add(component);
            // console.log(`visiting component ${componentName(component)}`);
            const declarationNeeded = collection_utils_1.setFilter(component, needsDeclaration);
            // 1. Only one node in the cycle needs a declaration, in which
            // case it's the breaker, and no forward declaration is necessary.
            if (declarationNeeded.size === 1) {
                declarations.push({ kind: "define", type: Support_1.defined(collection_utils_1.iterableFirst(declarationNeeded)) });
                return;
            }
            // 2. No node in the cycle needs a declaration, but it's also
            // the only node, so we don't actually need a declaration at all.
            if (declarationNeeded.size === 0 && component.size === 1) {
                return;
            }
            // 3. No node in the cycle needs a declaration, but there's more.
            // than one node total.  We have to pick a node to make a
            // declaration, so we can pick any one. This is not a forward
            // declaration, either.
            if (declarationNeeded.size === 0) {
                declarations.push({ kind: "define", type: Support_1.defined(collection_utils_1.iterableFirst(component)) });
                return;
            }
            // 4. More than one node needs a declaration, and we don't need
            // forward declarations.  Just declare all of them and be done
            // with it.
            if (canBeForwardDeclared === undefined) {
                for (const t of declarationNeeded) {
                    declarations.push({ kind: "define", type: t });
                }
                return;
            }
            // 5. More than one node needs a declaration, and we have
            // to make forward declarations.  We do the simple thing and first
            // forward-declare all forward-declarable types in the SCC.  If
            // there are none, we're stuck.  If there are, we take them out of
            // the component and try the whole thing again recursively.  Then
            // we declare the types we previously forward-declared.
            const forwardDeclarable = collection_utils_1.setFilter(component, canBeForwardDeclared);
            if (forwardDeclarable.size === 0) {
                return Messages_1.messageError("IRNoForwardDeclarableTypeInCycle", {});
            }
            for (const t of forwardDeclarable) {
                declarations.push({ kind: "forward", type: t });
            }
            collection_utils_1.setUnionInto(forwardedTypes, forwardDeclarable);
            const rest = collection_utils_1.setSubtract(component, forwardDeclarable);
            const restGraph = new Graph_1.Graph(rest, true, t => collection_utils_1.setIntersect(childrenOfType(t), rest));
            processGraph(restGraph, false);
            for (const t of forwardDeclarable) {
                declarations.push({ kind: "define", type: t });
            }
            return;
        }
        /*
        if (_writeComponents) {
            componentsGraph.nodes.forEach(types => {
                console.log(
                    `scc: ${types
                        .filter(t => t instanceof ClassType)
                        .map(t => t.getCombinedName())
                        .join(", ")}`
                );
            });
        }
        */
        const rootsUnordered = componentsGraph.findRoots();
        const roots = rootsUnordered;
        for (const component of roots) {
            componentsGraph.dfsTraversal(component, topDown, visitComponent);
        }
    }
    const fullGraph = typeGraph.makeGraph(false, childrenOfType);
    // fs.writeFileSync("graph.dot", fullGraph.makeDot(t => !(t instanceof PrimitiveType), nodeTitle));
    processGraph(fullGraph, true);
    return new DeclarationIR(declarations, forwardedTypes);
}
exports.declarationsForGraph = declarationsForGraph;
