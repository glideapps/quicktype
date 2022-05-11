"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Type_1 = require("../Type");
const TypeUtils_1 = require("../TypeUtils");
const Support_1 = require("../support/Support");
const UnifyClasses_1 = require("../UnifyClasses");
const REQUIRED_OVERLAP = 3 / 4;
// FIXME: Allow some type combinations to unify, like different enums,
// enums with strings, integers with doubles, maps with objects of
// the correct type.
function typeSetsCanBeCombined(s1, s2) {
    return Type_1.setOperationCasesEqual(s1, s2, true, (a, b) => a.structurallyCompatible(b, true));
}
function canBeCombined(c1, c2, onlyWithSameProperties) {
    const p1 = c1.getProperties();
    const p2 = c2.getProperties();
    if (onlyWithSameProperties) {
        if (p1.size !== p2.size) {
            return false;
        }
    }
    else {
        if (p1.size < p2.size * REQUIRED_OVERLAP || p2.size < p1.size * REQUIRED_OVERLAP) {
            return false;
        }
    }
    let larger;
    let smaller;
    if (p1.size > p2.size) {
        larger = p1;
        smaller = p2;
    }
    else {
        larger = p2;
        smaller = p1;
    }
    let maxFaults;
    if (onlyWithSameProperties) {
        maxFaults = 0;
    }
    else {
        const minOverlap = Math.ceil(larger.size * REQUIRED_OVERLAP);
        maxFaults = smaller.size - minOverlap;
    }
    Support_1.assert(maxFaults >= 0, "Max faults negative");
    const commonProperties = [];
    let faults = 0;
    for (const [name] of smaller) {
        if (larger.has(name)) {
            commonProperties.push(name);
        }
        else {
            faults += 1;
            if (faults > maxFaults)
                break;
        }
    }
    if (faults > maxFaults)
        return false;
    for (const name of commonProperties) {
        let ts = smaller.get(name);
        let tl = larger.get(name);
        if (ts === undefined || tl === undefined) {
            return Support_1.panic(`Both classes should have property ${name}`);
        }
        const tsCases = TypeUtils_1.nonNullTypeCases(ts.type);
        const tlCases = TypeUtils_1.nonNullTypeCases(tl.type);
        if (tsCases.size > 0 && tlCases.size > 0 && !typeSetsCanBeCombined(tsCases, tlCases)) {
            return false;
        }
    }
    return true;
}
function tryAddToClique(c, clique, onlyWithSameProperties) {
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
function findSimilarityCliques(graph, onlyWithSameProperties, includeFixedClasses) {
    const classCandidates = Array.from(graph.allNamedTypesSeparated().objects).filter(o => o instanceof Type_1.ClassType && (includeFixedClasses || !o.isFixed));
    const cliques = [];
    for (const c of classCandidates) {
        let cliqueIndex = undefined;
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
    return cliques.map(clique => clique.members).filter(cl => cl.length > 1);
}
function combineClasses(ctx, graph, alphabetizeProperties, conflateNumbers, onlyWithSameProperties, debugPrintReconstitution) {
    const cliques = ctx.time("  find similarity cliques", () => findSimilarityCliques(graph, onlyWithSameProperties, false));
    function makeCliqueClass(clique, builder, forwardingRef) {
        Support_1.assert(clique.size > 0, "Clique can't be empty");
        const attributes = TypeUtils_1.combineTypeAttributesOfTypes("union", clique);
        return UnifyClasses_1.unifyTypes(clique, attributes, builder, UnifyClasses_1.unionBuilderForUnification(builder, false, false, conflateNumbers), conflateNumbers, forwardingRef);
    }
    return graph.rewrite("combine classes", ctx.stringTypeMapping, alphabetizeProperties, cliques, debugPrintReconstitution, makeCliqueClass);
}
exports.combineClasses = combineClasses;
