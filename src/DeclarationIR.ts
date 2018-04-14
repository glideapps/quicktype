"use strict";

import { Set, List, OrderedSet, hash } from "immutable";

import { TypeGraph } from "./TypeGraph";
import { Type } from "./Type";
import { panic, defined } from "./Support";
import { Graph } from "./Graph";
import { ErrorMessage, messageError } from "./Messages";

export type DeclarationKind = "forward" | "define";

export class Declaration {
    constructor(readonly kind: DeclarationKind, readonly type: Type) {}

    equals(other: any): boolean {
        if (!(other instanceof Declaration)) return false;
        return this.kind === other.kind && this.type.equals(other.type);
    }

    hashCode(): number {
        return (hash(this.kind) + this.type.hashCode()) | 0;
    }
}

export class DeclarationIR {
    constructor(readonly declarations: List<Declaration>, readonly forwardedTypes: Set<Type>) {}
}

function findBreaker(t: Type, path: List<Type>, canBreak: ((t: Type) => boolean) | undefined): Type | undefined {
    const index = path.indexOf(t);
    if (index < 0) return undefined;
    if (canBreak === undefined) {
        return path.get(index);
    }
    const potentialBreakers = path.take(index + 1).reverse();
    const maybeBreaker = potentialBreakers.find(canBreak);
    if (maybeBreaker === undefined) {
        return panic("Found a cycle that cannot be broken");
    }
    return maybeBreaker;
}

export function cycleBreakerTypesForGraph(
    graph: TypeGraph,
    isImplicitCycleBreaker: (t: Type) => boolean,
    canBreakCycles: (t: Type) => boolean
): Set<Type> {
    let visitedTypes = Set();
    let cycleBreakerTypes: Set<Type> = Set();
    const queue: Type[] = graph.topLevels.valueSeq().toArray();

    function visit(t: Type, path: List<Type>): void {
        if (visitedTypes.has(t)) return;

        if (isImplicitCycleBreaker(t)) {
            queue.push(...t.getChildren().toArray());
        } else {
            const maybeBreaker = findBreaker(t, path, canBreakCycles);
            if (maybeBreaker !== undefined) {
                cycleBreakerTypes = cycleBreakerTypes.add(maybeBreaker);
                return;
            }

            const pathForChildren = path.unshift(t);
            t.getChildren().forEach(c => visit(c, pathForChildren));
        }

        visitedTypes = visitedTypes.add(t);
    }

    for (;;) {
        const maybeType = queue.pop();
        if (maybeType === undefined) break;
        visit(maybeType, List());
    }

    return cycleBreakerTypes;
}

export function declarationsForGraph(
    typeGraph: TypeGraph,
    canBeForwardDeclared: ((t: Type) => boolean) | undefined,
    childrenOfType: (t: Type) => OrderedSet<Type>,
    needsDeclaration: (t: Type) => boolean
): DeclarationIR {
    /*
    function nodeTitle(t: Type): string {
        const indexAndKind = `${t.typeRef.index} ${t.kind}`;
        if (t.hasNames) {
            return `${indexAndKind} ${t.getCombinedName()}`;
        } else {
            return indexAndKind;
        }
    }
    function componentName(c: OrderedSet<Type>): string {
        return c.map(nodeTitle).join(", ");
    }
    */

    const topDown = canBeForwardDeclared === undefined;
    const declarations: Declaration[] = [];
    let forwardedTypes: Set<Type> = Set();
    let visitedComponents: Set<OrderedSet<Type>> = Set();

    function processGraph(graph: Graph<Type>, _writeComponents: boolean): void {
        const componentsGraph = graph.stronglyConnectedComponents();
        function visitComponent(component: OrderedSet<Type>): void {
            if (visitedComponents.has(component)) return;
            visitedComponents = visitedComponents.add(component);

            // console.log(`visiting component ${componentName(component)}`);

            const declarationNeeded = component.filter(needsDeclaration);

            // 1. Only one node in the cycle needs a declaration, in which
            // case it's the breaker, and no forward declaration is necessary.
            if (declarationNeeded.size === 1) {
                declarations.push(new Declaration("define", defined(declarationNeeded.first())));
                return;
            }

            // 2. No node in the cycle needs a declaration, but it's also
            // the only node, so we don't actually need a declaration at all.
            if (declarationNeeded.isEmpty() && component.size === 1) {
                return;
            }

            // 3. No node in the cycle needs a declaration, but there's more.
            // than one node total.  We have to pick a node to make a
            // declaration, so we can pick any one. This is not a forward
            // declaration, either.
            if (declarationNeeded.isEmpty()) {
                declarations.push(new Declaration("define", defined(component.first())));
                return;
            }

            // 4. More than one node needs a declaration, and we don't need
            // forward declarations.  Just declare all of them and be done
            // with it.
            if (canBeForwardDeclared === undefined) {
                declarationNeeded.forEach(t => {
                    declarations.push(new Declaration("define", t));
                });
                return;
            }

            // 5. More than one node needs a declaration, and we have
            // to make forward declarations.  We do the simple thing and first
            // forward-declare all forward-declarable types in the SCC.  If
            // there are none, we're stuck.  If there are, we take them out of
            // the component and try the whole thing again recursively.  Then
            // we declare the types we previously forward-declared.
            const forwardDeclarable = component.filter(canBeForwardDeclared);
            if (forwardDeclarable.isEmpty()) {
                return messageError(ErrorMessage.IRNoForwardDeclarableTypeInCycle);
            }
            forwardDeclarable.forEach(t => {
                declarations.push(new Declaration("forward", t));
            });
            forwardedTypes = forwardedTypes.union(forwardDeclarable);
            const rest = component.subtract(forwardDeclarable);
            const restGraph = new Graph(rest.toArray(), true, t => childrenOfType(t).intersect(rest));
            processGraph(restGraph, false);
            forwardDeclarable.forEach(t => {
                declarations.push(new Declaration("define", t));
            });
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
        roots.forEach(component => {
            componentsGraph.dfsTraversal(component, topDown, visitComponent);
        });
    }

    const fullGraph = typeGraph.makeGraph(false, childrenOfType);
    // fs.writeFileSync("graph.dot", fullGraph.makeDot(t => !(t instanceof PrimitiveType), nodeTitle));
    processGraph(fullGraph, true);

    return new DeclarationIR(List(declarations), forwardedTypes);
}
