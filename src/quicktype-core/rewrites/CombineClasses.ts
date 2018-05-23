import { ClassType, Type, ClassProperty, setOperationCasesEqual } from "../Type";
import { nonNullTypeCases, combineTypeAttributesOfTypes } from "../TypeUtils";

import { GraphRewriteBuilder } from "../GraphRewriting";
import { assert, panic } from "../support/Support";
import { TypeGraph, TypeRef } from "../TypeGraph";
import { unifyTypes, unionBuilderForUnification } from "../UnifyClasses";
import { RunContext } from "../Run";

const REQUIRED_OVERLAP = 3 / 4;

type Clique = {
    members: ClassType[];
    prototypes: ClassType[];
};

// FIXME: Allow some type combinations to unify, like different enums,
// enums with strings, integers with doubles, maps with objects of
// the correct type.
function typeSetsCanBeCombined(s1: Iterable<Type>, s2: Iterable<Type>): boolean {
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

    let larger: ReadonlyMap<string, ClassProperty>;
    let smaller: ReadonlyMap<string, ClassProperty>;
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
    for (const [name, _] of smaller) {
        if (larger.has(name)) {
            commonProperties.push(name);
        } else {
            faults += 1;
            if (faults > maxFaults) break;
        }
    }
    if (faults > maxFaults) return false;
    for (const name of commonProperties) {
        let ts = smaller.get(name);
        let tl = larger.get(name);
        if (ts === undefined || tl === undefined) {
            return panic(`Both classes should have property ${name}`);
        }
        const tsCases = nonNullTypeCases(ts.type);
        const tlCases = nonNullTypeCases(tl.type);
        if (tsCases.size > 0 && tlCases.size > 0 && !typeSetsCanBeCombined(tsCases, tlCases)) {
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

function findSimilarityCliques(
    graph: TypeGraph,
    onlyWithSameProperties: boolean,
    includeFixedClasses: boolean
): ClassType[][] {
    const classCandidates = Array.from(graph.allNamedTypesSeparated().objects).filter(
        o => o instanceof ClassType && (includeFixedClasses || !o.isFixed)
    ) as ClassType[];
    const cliques: Clique[] = [];

    for (const c of classCandidates) {
        let cliqueIndex: number | undefined = undefined;
        for (let i = 0; i < cliques.length; i++) {
            if (tryAddToClique(c, cliques[i], onlyWithSameProperties)) {
                cliqueIndex = i;
                break;
            }
        }
        if (cliqueIndex === undefined) {
            // New clique
            cliqueIndex = cliques.length;
            cliques.push({ members: [c], prototypes: [c] });
        }

        // Move the clique we just added to to the front, in the hope that
        // some cliques are more often added to than others, and they'll
        // move to the front.
        const tmp = cliques[0];
        cliques[0] = cliques[cliqueIndex];
        cliques[cliqueIndex] = tmp;
    }

    return cliques.map(clique => clique.members);
}

export function combineClasses(
    ctx: RunContext,
    graph: TypeGraph,
    alphabetizeProperties: boolean,
    conflateNumbers: boolean,
    onlyWithSameProperties: boolean,
    debugPrintReconstitution: boolean
): TypeGraph {
    const cliques = ctx.time("  find similarity cliques", () =>
        findSimilarityCliques(graph, onlyWithSameProperties, false)
    );

    function makeCliqueClass(
        clique: ReadonlySet<ClassType>,
        builder: GraphRewriteBuilder<ClassType>,
        forwardingRef: TypeRef
    ): TypeRef {
        assert(clique.size > 0, "Clique can't be empty");
        const attributes = combineTypeAttributesOfTypes("union", clique);
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
        ctx.stringTypeMapping,
        alphabetizeProperties,
        cliques,
        debugPrintReconstitution,
        makeCliqueClass
    );
}
