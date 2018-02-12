"use strict";

import { Map, Set, OrderedSet } from "immutable";

import { Type, ClassType, unionCasesEqual, removeNullFromType, ClassProperty, allTypeCases } from "./Type";
import { defined, panic } from "./Support";
import { TypeGraph } from "./TypeGraph";
import { GraphRewriteBuilder, TypeRef, StringTypeMapping } from "./TypeBuilder";
import { unifyTypes } from "./UnifyClasses";
import { MarkovChain, load, evaluate } from "./MarkovChain";

const mapSizeThreshold = 20;

let markovChain: MarkovChain | undefined = undefined;

function nameProbability(name: string): number {
    if (markovChain === undefined) {
        markovChain = load();
    }
    return evaluate(markovChain, name);
}

function shouldBeMap(properties: Map<string, ClassProperty>): Set<Type> | undefined {
    // Only classes with a certain number of properties are inferred
    // as maps.
    const numProperties = properties.size;
    if (numProperties < 2) return undefined;

    if (numProperties < mapSizeThreshold) {
        const names = properties.keySeq();
        const probabilities = names.map(nameProbability);
        const product = probabilities.reduce((a, b) => a * b, 1);
        const probability = Math.pow(product, 1 / numProperties);
        // The idea behind this is to have a probability around 0.0004 for
        // n=1, up to around 1.0 for n=20.  I.e. when we only have a few
        // properties, they need to look really weird to infer a map, but
        // when we have more we'll accept more ordinary names.  The details
        // of the formula are immaterial because I pulled it out of my ass.
        const exponent = 5;
        const scale = Math.pow(22, exponent);
        const limit = Math.pow(numProperties + 2, exponent) / scale + (0.004 - Math.pow(3, exponent) / scale);
        if (probability > limit) return undefined;

        /*
        console.log(
            `limit for ${JSON.stringify(names.toArray())} - ${JSON.stringify(
                probabilities.toArray()
            )} is ${limit}, we are at ${probability}`
        );
        */
    }

    // FIXME: simplify this - it's no longer necessary with the new
    // class properties.

    // We need to handle three cases for maps (and the fourth case
    // where we leave the class as is):
    //
    // 1. All property types are null.
    // 2. Some property types are null or nullable.
    // 3. No property types are null or nullable.
    let firstNonNullCases: OrderedSet<Type> | undefined = undefined;
    let allCases: Set<Type> = Set();
    let canBeMap = true;
    // Check that all the property types are the same, modulo nullability.
    properties.forEach(p => {
        // The set of types first property can be, minus null.
        const nn = removeNullFromType(p.type)[1];
        if (!nn.isEmpty()) {
            if (firstNonNullCases !== undefined) {
                // The set of non-null cases for all other properties must
                // be the the same, otherwise we won't infer a map.
                if (!unionCasesEqual(nn, firstNonNullCases, (a, b) => a.structurallyCompatible(b))) {
                    canBeMap = false;
                    return false;
                }
            } else {
                firstNonNullCases = nn;
            }
        }
        allCases = allCases.union(allTypeCases(p.type));
    });
    if (!canBeMap) {
        return undefined;
    }
    return allCases;
}

export function inferMaps(graph: TypeGraph, stringTypeMapping: StringTypeMapping, conflateNumbers: boolean): TypeGraph {
    function replaceClass(
        setOfOneClass: Set<ClassType>,
        builder: GraphRewriteBuilder<ClassType>,
        forwardingRef: TypeRef
    ): TypeRef {
        const c = defined(setOfOneClass.first());
        const properties = c.properties;

        const shouldBe = shouldBeMap(properties);
        if (shouldBe === undefined) {
            return panic(`We shouldn't be replacing class ${c.getCombinedName()} with a map`);
        }

        // Now reconstitute all the types in the new graph.  TypeGraphs are
        // immutable, so any change in the graph actually means building a new
        // graph, and the types in the new graph are different objects.
        // Reconstituting a type means generating the "same" type in the new
        // type graph.  Except we don't get Type objects but TypeRef objects,
        // which is a type-to-be.
        return builder.getMapType(
            unifyTypes(shouldBe, c.getAttributes(), builder, false, false, conflateNumbers),
            forwardingRef
        );
    }

    const allClasses = graph.allNamedTypesSeparated().classes;
    const classesToReplace = allClasses.filter(c => !c.isFixed && shouldBeMap(c.properties) !== undefined).toArray();
    return graph.rewrite(stringTypeMapping, false, classesToReplace.map(c => [c]), replaceClass);
}
