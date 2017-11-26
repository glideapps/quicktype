"use strict";

import { Map, Set, OrderedMap, OrderedSet } from "immutable";

import { ClassType, Type, nonNullTypeCases } from "./Type";
import { TypeGraphBuilder, GraphRewriteBuilder, TypeBuilder, TypeRef } from "./TypeBuilder";
import { assert, panic } from "./Support";
import { TypeGraph } from "./TypeGraph";

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
        if (!ts.equals(tl)) {
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

export function combineClasses(graph: TypeGraph): TypeGraph {
    let unprocessedClasses = graph.allNamedTypesSeparated().classes.toArray();
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

    function makeCliqueClass(clique: Set<ClassType>, builder: GraphRewriteBuilder): TypeRef {
        assert(clique.size > 0, "Clique can't be empty");
        let inferredNames = OrderedSet<string>();
        let givenNames = OrderedSet<string>();
        clique.forEach(c => {
            if (c.areNamesInferred) {
                inferredNames = inferredNames.union(c.names);
            } else {
                givenNames = givenNames.union(c.names);
            }
        });
        const areNamesInferred = givenNames.isEmpty();
        const properties = getCliqueProperties(clique, builder);
        return builder.getClassType(areNamesInferred ? inferredNames : givenNames, areNamesInferred, properties);
    }

    function getCliqueProperties(clique: Set<ClassType>, builder: GraphRewriteBuilder): OrderedMap<string, TypeRef> {
        let properties = OrderedMap<string, [Type, number, boolean]>();
        clique.forEach(c => {
            c.properties.forEach((t, name) => {
                const p = properties.get(name);
                if (p) {
                    p[1] += 1;
                    // If one of the clique class's properties is nullable,
                    // the combined property must be nullable, too, so we
                    // just set it to this one.  Of course it can't be one of
                    // the properties that is just null.
                    if (t.kind !== "null") {
                        p[0] = t;
                    }
                    if (t.isNullable) {
                        p[2] = true;
                    }
                } else {
                    properties = properties.set(name, [t, 1, t.isNullable]);
                }
            });
        });
        return properties.map(([t, count, haveNullable], name) => {
            let resultType = builder.reconstituteType(t);
            if (haveNullable || count < clique.size) {
                if (t.isNamedType()) {
                    resultType = builder.makeNullable(resultType, t.names, t.areNamesInferred);
                } else {
                    resultType = builder.makeNullable(resultType, name, true);
                }
            }
            return resultType;
        });
    }

    return graph.rewrite(cliques, makeCliqueClass);
}
