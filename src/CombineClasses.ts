"use strict";

import { Map, Set, OrderedSet } from "immutable";

import { ClassType, Type, ClassProperty, setOperationCasesEqual } from "./Type";
import { nonNullTypeCases, combineTypeAttributesOfTypes } from "./TypeUtils";

import { TypeRef, StringTypeMapping } from "./TypeBuilder";
import { GraphRewriteBuilder } from "./GraphRewriting";
import { assert, panic } from "./Support";
import { TypeGraph } from "./TypeGraph";
import { unifyTypes, unionBuilderForUnification } from "./UnifyClasses";

const REQUIRED_OVERLAP = 3 / 4;

type Clique = {
    members: ClassType[];
    prototypes: ClassType[];
};

// FIXME: Allow some type combinations to unify, like different enums,
// enums with strings, integers with doubles, maps with objects of
// the correct type.
function typeSetsCanBeCombined(s1: OrderedSet<Type>, s2: OrderedSet<Type>): boolean {
    return setOperationCasesEqual(s1, s2, true, (a, b) => a.structurallyCompatible(b, true));
}

function canBeCombined(c1: ClassType, c2: ClassType, onlyWithSameProperties: boolean): boolean {
    const p1 = c1.getProperties();
    const p2 = c2.getProperties();
    if (onlyWithSameProperties) {
        if (p1.size !== p2.size) {
            return false;
        }
    } else {
        if (p1.size < p2.size * REQUIRED_OVERLAP || p2.size < p1.size * REQUIRED_OVERLAP) {
            return false;
        }
    }

    let larger: Map<string, ClassProperty>;
    let smaller: Map<string, ClassProperty>;
    if (p1.size > p2.size) {
        larger = p1;
        smaller = p2;
    } else {
        larger = p2;
        smaller = p1;
    }

    let maxFaults: number;
    if (onlyWithSameProperties) {
        maxFaults = 0;
    } else {
        const minOverlap = Math.ceil(larger.size * REQUIRED_OVERLAP);
        maxFaults = smaller.size - minOverlap;
    }

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
            return panic(`Both classes should have property ${name}`);
        }
        const tsCases = nonNullTypeCases(ts.type);
        const tlCases = nonNullTypeCases(tl.type);
        if (!tsCases.isEmpty() && !tlCases.isEmpty() && !typeSetsCanBeCombined(tsCases, tlCases)) {
            return false;
        }
    }
    return true;
}

function tryAddToClique(c: ClassType, clique: Clique, onlyWithSameProperties: boolean): boolean {
    for (const prototype of clique.prototypes) {
        if (prototype.structurallyCompatible(c)) {
            clique.members.push(c);
            return true;
        }
    }
    for (const prototype of clique.prototypes) {
        if (canBeCombined(prototype, c, onlyWithSameProperties)) {
            clique.prototypes.push(c);
            clique.members.push(c);
            return true;
        }
    }
    return false;
}

export function findSimilarityCliques(
    graph: TypeGraph,
    onlyWithSameProperties: boolean,
    includeFixedClasses: boolean
): ClassType[][] {
    let unprocessedClasses = graph
        .allNamedTypesSeparated()
        .objects.filter(o => o instanceof ClassType && (includeFixedClasses || !o.isFixed))
        .toArray() as ClassType[];
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
            if (!tryAddToClique(c, clique, onlyWithSameProperties)) {
                classesLeft.push(c);
            }
        }

        if (clique.members.length > 1) {
            cliques.push(clique.members);
        }

        unprocessedClasses = classesLeft;
    }

    return cliques;
}

export function combineClasses(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    alphabetizeProperties: boolean,
    conflateNumbers: boolean,
    onlyWithSameProperties: boolean,
    debugPrintReconstitution: boolean
): TypeGraph {
    const cliques = findSimilarityCliques(graph, onlyWithSameProperties, false);

    function makeCliqueClass(
        clique: Set<ClassType>,
        builder: GraphRewriteBuilder<ClassType>,
        forwardingRef: TypeRef
    ): TypeRef {
        assert(clique.size > 0, "Clique can't be empty");
        const attributes = combineTypeAttributesOfTypes(clique);
        return unifyTypes(
            clique,
            attributes,
            builder,
            unionBuilderForUnification(builder, false, false, conflateNumbers),
            conflateNumbers,
            forwardingRef
        );
    }

    return graph.rewrite(
        "combine classes",
        stringTypeMapping,
        alphabetizeProperties,
        cliques,
        debugPrintReconstitution,
        makeCliqueClass
    );
}
