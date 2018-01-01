"use strict";

import { Map, Set, OrderedSet } from "immutable";

import { Type, ClassType, unionCasesEqual, removeNullFromType } from "./Type";
import { defined, assert, panic } from "./Support";
import { TypeGraph } from "./TypeGraph";
import { GraphRewriteBuilder, TypeRef, StringTypeMapping } from "./TypeBuilder";
import { unifyTypes } from "./UnifyClasses";

const mapSizeThreshold = 20;

function shouldBeMap(properties: Map<string, Type>): Set<Type> | undefined {
    // Only classes with a certain number of properties are inferred
    // as maps.
    if (properties.size < mapSizeThreshold) {
        return undefined;
    }

    // We need to handle three cases for maps (and the fourth case
    // where we leave the class as is):
    //
    // 1. All property types are null.
    // 2. Some property types are null or nullable.
    // 3. No property types are null or nullable.
    let firstNonNullCases: OrderedSet<Type> | undefined = undefined;
    let allCases: Set<Type> = Set();
    let isNullable = false;
    let canBeMap = true;
    // Check that all the property types are the same, modulo nullability.
    properties.forEach(t => {
        // The set of types first property can be, minus null.
        const [maybeNull, nn] = removeNullFromType(t);
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
        allCases = allCases.union(nn.toSet());
        if (maybeNull !== null) {
            allCases = allCases.add(maybeNull);
            isNullable = true;
        }
    });
    if (!canBeMap) {
        return undefined;
    }
    if (firstNonNullCases === undefined) {
        assert(isNullable, "Non-nullable map candidate with no types");
    }
    return allCases;
}

function replaceClass(setOfOneClass: Set<ClassType>, builder: GraphRewriteBuilder<ClassType>): TypeRef {
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
    return builder.getMapType(unifyTypes(shouldBe, c.getNames(), builder, false));
}

export function inferMaps(graph: TypeGraph, stringTypeMapping: StringTypeMapping): TypeGraph {
    const allClasses = graph.allNamedTypesSeparated().classes;
    const classesToReplace = allClasses.filter(c => !c.isFixed && shouldBeMap(c.properties) !== undefined).toArray();
    return graph.rewrite(stringTypeMapping, classesToReplace.map(c => [c]), replaceClass);
}
