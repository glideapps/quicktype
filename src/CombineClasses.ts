"use strict";

import { Map, Set, OrderedSet } from "immutable";

import { ClassType, Type, nonNullTypeCases } from "./Type";
import { GraphRewriteBuilder, TypeRef, StringTypeMapping } from "./TypeBuilder";
import { assert, panic } from "./Support";
import { TypeGraph } from "./TypeGraph";
import { typeNamesUnion, TypeNames } from "./TypeNames";
import { getCliqueProperties } from "./UnifyClasses";

const REQUIRED_OVERLAP = 3 / 4;

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
        // FIXME: Allow some type combinations to unify, like different enums,
        // enums with strings, integers with doubles, maps with objects of
        // the correct type.
        if (!tsCases.isEmpty() && !tlCases.isEmpty() && !tsCases.equals(tlCases)) {
            return false;
        }
    }
    return true;
}

function isPartOfClique(c: ClassType, clique: ClassType[]): boolean {
    for (const cc of clique) {
        if (!canBeCombined(c, cc)) {
            return false;
        }
    }
    return true;
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
        const clique = [unprocessedClasses[0]];

        for (let i = 1; i < unprocessedClasses.length; i++) {
            const c = unprocessedClasses[i];
            if (isPartOfClique(c, clique)) {
                clique.push(c);
            } else {
                classesLeft.push(c);
            }
        }

        if (clique.length > 1) {
            cliques.push(clique);
        }

        unprocessedClasses = classesLeft;
    }

    function makeCliqueClass(clique: Set<ClassType>, builder: GraphRewriteBuilder<ClassType>): TypeRef {
        function makePropertyType(names: TypeNames, types: OrderedSet<Type>, isNullable: boolean): TypeRef {
            let resultType: TypeRef;
            const first = types.first();
            if (first === undefined) {
                resultType = builder.getPrimitiveType("null");
            } else {
                resultType = builder.reconstituteType(first);
            }
            if (isNullable) {
                resultType = builder.makeNullable(resultType, names);
            }
            return resultType;
        }

        assert(clique.size > 0, "Clique can't be empty");
        const allNames = clique.map(c => c.getNames());
        const properties = getCliqueProperties(clique, makePropertyType);
        return builder.getClassType(typeNamesUnion(allNames), properties);
    }

    return graph.rewrite(stringTypeMapping, cliques, makeCliqueClass);
}
