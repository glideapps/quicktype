"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Type_1 = require("../Type");
const TypeUtils_1 = require("../TypeUtils");
const Support_1 = require("../support/Support");
const UnifyClasses_1 = require("../UnifyClasses");
const MarkovChain_1 = require("../MarkovChain");
const mapSizeThreshold = 20;
const stringMapSizeThreshold = 50;
let markovChain = undefined;
function nameProbability(name) {
    if (markovChain === undefined) {
        markovChain = MarkovChain_1.load();
    }
    return MarkovChain_1.evaluate(markovChain, name);
}
function shouldBeMap(properties) {
    // Only classes with a certain number of properties are inferred
    // as maps.
    const numProperties = properties.size;
    if (numProperties < 2)
        return undefined;
    // If all property names are digit-only, we always make a map, no
    // questions asked.
    if (collection_utils_1.iterableEvery(properties.keys(), n => /^[0-9]+$/.test(n))) {
        return collection_utils_1.setMap(properties.values(), cp => cp.type);
    }
    // If all properties are strings or null then an object must have at least
    // `stringMapSizeThreshold` to qualify as a map.
    if (numProperties < stringMapSizeThreshold &&
        collection_utils_1.iterableEvery(properties.values(), cp => Type_1.isPrimitiveStringTypeKind(cp.type.kind) || cp.type.kind === "null")) {
        return undefined;
    }
    if (numProperties < mapSizeThreshold) {
        const names = Array.from(properties.keys());
        const probabilities = names.map(nameProbability);
        const product = probabilities.reduce((a, b) => a * b, 1);
        const probability = Math.pow(product, 1 / numProperties);
        // The idea behind this is to have a probability around 0.0025 for
        // n=1, up to around 1.0 for n=20.  I.e. when we only have a few
        // properties, they need to look really weird to infer a map, but
        // when we have more we'll accept more ordinary names.  The details
        // of the formula are immaterial because I pulled it out of my ass.
        // FIXME: Use different exponents and start values depending on
        // the property type kind.  For string properties, for example, we
        // should be more conservative, with class properties more
        // aggressive.  An exponent of 6 is probably good for string
        // properties, and maybe a start value of 0.002, whereas for classes
        // we want maybe 0.004 and 5, or maybe something even more
        // trigger-happy.
        const exponent = 5;
        const scale = Math.pow(22, exponent);
        const limit = Math.pow(numProperties + 2, exponent) / scale + (0.0025 - Math.pow(3, exponent) / scale);
        if (probability > limit)
            return undefined;
    }
    // FIXME: simplify this - it's no longer necessary with the new
    // class properties.
    // We need to handle three cases for maps (and the fourth case
    // where we leave the class as is):
    //
    // 1. All property types are null.
    // 2. Some property types are null or nullable.
    // 3. No property types are null or nullable.
    let firstNonNullCases = undefined;
    const allCases = new Set();
    let canBeMap = true;
    // Check that all the property types are the same, modulo nullability.
    for (const [, p] of properties) {
        // The set of types first property can be, minus null.
        const nn = TypeUtils_1.removeNullFromType(p.type)[1];
        if (nn.size > 0) {
            if (firstNonNullCases !== undefined) {
                // The set of non-null cases for all other properties must
                // be the the same, otherwise we won't infer a map.
                if (!Type_1.setOperationCasesEqual(nn, firstNonNullCases, true, (a, b) => a.structurallyCompatible(b, true))) {
                    canBeMap = false;
                    break;
                }
            }
            else {
                firstNonNullCases = nn;
            }
        }
        allCases.add(p.type);
    }
    if (!canBeMap) {
        return undefined;
    }
    return allCases;
}
function inferMaps(graph, stringTypeMapping, conflateNumbers, debugPrintReconstitution) {
    function replaceClass(setOfOneClass, builder, forwardingRef) {
        const c = Support_1.defined(collection_utils_1.iterableFirst(setOfOneClass));
        const properties = c.getProperties();
        const shouldBe = shouldBeMap(properties);
        if (shouldBe === undefined) {
            return Support_1.panic(`We shouldn't be replacing class ${c.getCombinedName()} with a map`);
        }
        // Now reconstitute all the types in the new graph.  TypeGraphs are
        // immutable, so any change in the graph actually means building a new
        // graph, and the types in the new graph are different objects.
        // Reconstituting a type means generating the "same" type in the new
        // type graph.  Except we don't get Type objects but TypeRef objects,
        // which is a type-to-be.
        return builder.getMapType(c.getAttributes(), UnifyClasses_1.unifyTypes(shouldBe, c.getAttributes(), builder, UnifyClasses_1.unionBuilderForUnification(builder, false, false, conflateNumbers), conflateNumbers), forwardingRef);
    }
    const classesToReplace = Array.from(graph.allNamedTypesSeparated().objects).filter(o => {
        if (!(o instanceof Type_1.ClassType))
            return false;
        return !o.isFixed && shouldBeMap(o.getProperties()) !== undefined;
    });
    return graph.rewrite("infer maps", stringTypeMapping, false, classesToReplace.map(c => [c]), debugPrintReconstitution, replaceClass);
}
exports.inferMaps = inferMaps;
