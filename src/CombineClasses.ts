"use strict";

import { Map, Set, OrderedSet } from "immutable";

import { ClassType, Type, nonNullTypeCases } from "./Type";
import { GraphRewriteBuilder, TypeRef, StringTypeMapping } from "./TypeBuilder";
import { assert, panic } from "./Support";
import { TypeGraph } from "./TypeGraph";
import { typeNamesUnion } from "./TypeNames";
import { unifyTypes } from "./UnifyClasses";

const REQUIRED_OVERLAP = 3 / 4;

type Clique = {
    members: ClassType[];
    prototypes: ClassType[];
};

// FIXME: Allow some type combinations to unify, like different enums,
// enums with strings, integers with doubles, maps with objects of
// the correct type.
function typeSetsCanBeCombined(s1: OrderedSet<Type>, s2: OrderedSet<Type>): boolean {
    if (s1.size !== s2.size) return false;

    const s2ByKind = Map(s2.map((t): [string, Type] => [t.kind, t]));
    return s1.every(t => {
        const kind = t.kind;
        const other = s2ByKind.get(kind);
        if (other === undefined) return false;
        return t.structurallyEquals(other);
    });
}

function canBeCombined(c1: ClassType, c2: ClassType): boolean {
    const p1 = c1.properties;
    const p2 = c2.properties;
    if (p1.size < p2.size * REQUIRED_OVERLAP || p2.size < p1.size * REQUIRED_OVERLAP) {
        return false;
    }
    let larger: Map<string, Type>;
    let smaller: Map<string, Type>;
    if (p1.size > p2.size) {
        larger = p1;
        smaller = p2;
    } else {
        larger = p2;
        smaller = p1;
    }
    const minOverlap = Math.ceil(larger.size * REQUIRED_OVERLAP);
    const maxFaults = smaller.size - minOverlap;
    assert(maxFaults >= 0, "Max faults negative");
    const commonProperties: string[] = [];
    let faults = 0;
    smaller.forEach((_, name) => {
        if (larger.has(name)) {
            commonProperties.push(name);
        } else {
            faults += 1;
            if (faults > maxFaults) return false;
        }
    });
    if (faults > maxFaults) return false;
    for (const name of commonProperties) {
        let ts = smaller.get(name);
        let tl = larger.get(name);
        if (ts === undefined || tl === undefined) {
            return panic("Both of these should have this property");
        }
        const tsCases = nonNullTypeCases(ts);
        const tlCases = nonNullTypeCases(tl);
        if (!tsCases.isEmpty() && !tlCases.isEmpty() && !typeSetsCanBeCombined(tsCases, tlCases)) {
            return false;
        }
    }
    return true;
}

function tryAddToClique(c: ClassType, clique: Clique): boolean {
    for (const prototype of clique.prototypes) {
        if (prototype.structurallyEquals(c)) {
            clique.members.push(c);
            return true;
        }
    }
    for (const prototype of clique.prototypes) {
        if (canBeCombined(prototype, c)) {
            clique.prototypes.push(c);
            clique.members.push(c);
            return true;
        }
    }
    return false;
}

export function combineClasses(graph: TypeGraph, stringTypeMapping: StringTypeMapping): TypeGraph {
    let unprocessedClasses = graph
        .allNamedTypesSeparated()
        .classes.filter(c => !c.isFixed)
        .toArray();
    const cliques: ClassType[][] = [];

    // FIXME: Don't build cliques one by one.  Instead have a list of
    // cliques-in-progress and iterate over all classes.  Add the class
    // to the first clique that it's part of.  If there's none, make it
    // into a new clique.
    while (unprocessedClasses.length > 0) {
        const classesLeft: ClassType[] = [];
        const clique: Clique = { members: [unprocessedClasses[0]], prototypes: [unprocessedClasses[0]] };

        for (let i = 1; i < unprocessedClasses.length; i++) {
            const c = unprocessedClasses[i];
            if (!tryAddToClique(c, clique)) {
                classesLeft.push(c);
            }
        }

        if (clique.members.length > 1) {
            cliques.push(clique.members);
        }

        unprocessedClasses = classesLeft;
    }

    function makeCliqueClass(clique: Set<ClassType>, builder: GraphRewriteBuilder<ClassType>): TypeRef {
        assert(clique.size > 0, "Clique can't be empty");
        const allNames = clique.map(c => c.getNames());
        return unifyTypes(clique, typeNamesUnion(allNames), builder, false, false);
    }

    return graph.rewrite(stringTypeMapping, cliques, makeCliqueClass);
}
