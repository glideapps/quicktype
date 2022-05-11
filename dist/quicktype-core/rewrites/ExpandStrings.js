"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const TypeUtils_1 = require("../TypeUtils");
const Support_1 = require("../support/Support");
const TypeAttributes_1 = require("../attributes/TypeAttributes");
const StringTypes_1 = require("../attributes/StringTypes");
const MIN_LENGTH_FOR_ENUM = 10;
const MIN_LENGTH_FOR_OVERLAP = 5;
const REQUIRED_OVERLAP = 3 / 4;
function isOwnEnum({ numValues, cases }) {
    return numValues >= MIN_LENGTH_FOR_ENUM && cases.size < Math.sqrt(numValues);
}
function enumCasesOverlap(newCases, existingCases, newAreSubordinate) {
    const smaller = newAreSubordinate ? newCases.size : Math.min(newCases.size, existingCases.size);
    const overlap = collection_utils_1.setIntersect(newCases, existingCases).size;
    return overlap >= smaller * REQUIRED_OVERLAP;
}
function isAlwaysEmptyString(cases) {
    return cases.length === 1 && cases[0] === "";
}
function expandStrings(ctx, graph, inference) {
    const stringTypeMapping = ctx.stringTypeMapping;
    const allStrings = Array.from(graph.allTypesUnordered()).filter(t => t.kind === "string" && TypeUtils_1.stringTypesForType(t).isRestricted);
    function makeEnumInfo(t) {
        const stringTypes = TypeUtils_1.stringTypesForType(t);
        const mappedStringTypes = stringTypes.applyStringTypeMapping(stringTypeMapping);
        if (!mappedStringTypes.isRestricted)
            return undefined;
        const cases = Support_1.defined(mappedStringTypes.cases);
        if (cases.size === 0)
            return undefined;
        const numValues = collection_utils_1.iterableReduce(cases.values(), 0, (a, b) => a + b);
        if (inference !== "all") {
            const keys = Array.from(cases.keys());
            if (isAlwaysEmptyString(keys))
                return undefined;
            const someCaseIsNotNumber = collection_utils_1.iterableSome(keys, key => /^(\-|\+)?[0-9]+(\.[0-9]+)?$/.test(key) === false);
            if (!someCaseIsNotNumber)
                return undefined;
        }
        return { cases: new Set(cases.keys()), numValues };
    }
    const enumInfos = new Map();
    const enumSets = [];
    if (inference !== "none") {
        for (const t of allStrings) {
            const enumInfo = makeEnumInfo(t);
            if (enumInfo === undefined)
                continue;
            enumInfos.set(t, enumInfo);
        }
        function findOverlap(newCases, newAreSubordinate) {
            return enumSets.findIndex(s => enumCasesOverlap(newCases, s, newAreSubordinate));
        }
        // First, make case sets for all the enums that stand on their own.  If
        // we find some overlap (searching eagerly), make unions.
        for (const t of Array.from(enumInfos.keys())) {
            const enumInfo = Support_1.defined(enumInfos.get(t));
            const cases = enumInfo.cases;
            if (inference === "all") {
                enumSets.push(cases);
            }
            else {
                if (!isOwnEnum(enumInfo))
                    continue;
                const index = findOverlap(cases, false);
                if (index >= 0) {
                    // console.log(
                    //     `unifying ${JSON.stringify(Array.from(cases))} with ${JSON.stringify(
                    //         Array.from(enumSets[index])
                    //     )}`
                    // );
                    enumSets[index] = collection_utils_1.setUnion(enumSets[index], cases);
                }
                else {
                    // console.log(`adding new ${JSON.stringify(Array.from(cases))}`);
                    enumSets.push(cases);
                }
            }
            // Remove the ones we're done with.
            enumInfos.delete(t);
        }
        if (inference === "all") {
            Support_1.assert(enumInfos.size === 0);
        }
        // Now see if we can unify the rest with some a set we found in the
        // previous step.
        for (const [, enumInfo] of enumInfos.entries()) {
            if (enumInfo.numValues < MIN_LENGTH_FOR_OVERLAP)
                continue;
            const index = findOverlap(enumInfo.cases, true);
            if (index >= 0) {
                // console.log(
                //     `late unifying ${JSON.stringify(Array.from(enumInfo.cases))} with ${JSON.stringify(
                //         Array.from(enumSets[index])
                //     )}`
                // );
                enumSets[index] = collection_utils_1.setUnion(enumSets[index], enumInfo.cases);
            }
        }
    }
    function replaceString(group, builder, forwardingRef) {
        Support_1.assert(group.size === 1);
        const t = Support_1.defined(collection_utils_1.iterableFirst(group));
        const stringTypes = TypeUtils_1.stringTypesForType(t);
        const attributes = collection_utils_1.mapFilter(t.getAttributes(), a => a !== stringTypes);
        const mappedStringTypes = stringTypes.applyStringTypeMapping(stringTypeMapping);
        if (!mappedStringTypes.isRestricted) {
            return builder.getStringType(attributes, StringTypes_1.StringTypes.unrestricted, forwardingRef);
        }
        const setMatches = inference === "all" ? collection_utils_1.areEqual : collection_utils_1.setIsSuperset;
        const types = [];
        const cases = Support_1.defined(mappedStringTypes.cases);
        if (cases.size > 0) {
            const keys = new Set(cases.keys());
            const fullCases = enumSets.find(s => setMatches(s, keys));
            if (inference !== "none" && !isAlwaysEmptyString(Array.from(keys)) && fullCases !== undefined) {
                types.push(builder.getEnumType(TypeAttributes_1.emptyTypeAttributes, fullCases));
            }
            else {
                return builder.getStringType(attributes, StringTypes_1.StringTypes.unrestricted, forwardingRef);
            }
        }
        const transformations = mappedStringTypes.transformations;
        // FIXME: This is probably wrong, or at least overly conservative.  This is for the case
        // where some attributes are identity ones, i.e. where we can't merge the primitive types,
        // like it happens in the line after the `if`.  The case where this occured was with URI
        // attributes: we had two separate string types with different URI attributes, but because
        // both are rewritten via `getPrimitiveType` below without any attributes, they end up
        // being the same string type.
        if (types.length === 0 && transformations.size === 1) {
            const kind = Support_1.defined(collection_utils_1.iterableFirst(transformations));
            return builder.getPrimitiveType(kind, attributes, forwardingRef);
        }
        types.push(...Array.from(transformations).map(k => builder.getPrimitiveType(k)));
        Support_1.assert(types.length > 0, "We got an empty string type");
        return builder.getUnionType(attributes, new Set(types), forwardingRef);
    }
    return graph.rewrite("expand strings", stringTypeMapping, false, allStrings.map(t => [t]), ctx.debugPrintReconstitution, replaceString);
}
exports.expandStrings = expandStrings;
