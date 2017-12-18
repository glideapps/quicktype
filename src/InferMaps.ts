"use strict";

import { Map, Set, OrderedSet } from "immutable";

import { Type, ClassType, nonNullTypeCases } from "./Type";
import { defined, assert, panic } from "./Support";
import { TypeGraph } from "./TypeGraph";
import { GraphRewriteBuilder, TypeRef, StringTypeMapping } from "./TypeBuilder";

const mapSizeThreshold = 20;

export function shouldBeMap(properties: Map<string, Type>): [OrderedSet<Type>, boolean] | undefined {
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
    let nonNullCases: OrderedSet<Type> | undefined = undefined;
    let isNullable = false;
    let canBeMap = true;
    // Check that all the property types are the same, modulo nullability.
    properties.forEach(t => {
        // The set of types first property can be, minus null.
        const nn = nonNullTypeCases(t);
        if (!nn.isEmpty()) {
            if (nonNullCases !== undefined) {
                // The set of non-null cases for all other properties must
                // be the the same, otherwise we won't infer a map.
                if (!nn.toSet().equals(nonNullCases.toSet())) {
                    canBeMap = false;
                    return false;
                }
            } else {
                nonNullCases = nn;
            }
        }
        isNullable = isNullable || t.isNullable;
    });
    if (!canBeMap) {
        return undefined;
    }
    if (nonNullCases === undefined) {
        assert(isNullable, "Non-nullable map candidate with no types");
        return [OrderedSet(), true];
    }
    return [nonNullCases, isNullable];
}

export function replaceClass(setOfOneClass: Set<ClassType>, builder: GraphRewriteBuilder<ClassType>): TypeRef {
    const c = defined(setOfOneClass.first());
    const properties = c.properties;

    const shouldBe = shouldBeMap(properties);
    if (shouldBe === undefined) {
        return panic(`We shouldn't be replacing class ${c.combinedName} with a map`);
    }
    const [nonNulls, isNullable] = shouldBe;

    // Now reconstitute all the types in the new graph.  TypeGraphs are
    // immutable, so any change in the graph actually means building a new
    // graph, and the types in the new graph are different objects.
    // Reconstituting a type means generating the "same" type in the new
    // type graph.  Except we don't get Type objects but TypeRef objects,
    // which is a type-to-be.
    let trefs = nonNulls.map(builder.reconstituteType);
    if (isNullable) {
        trefs = trefs.add(builder.getPrimitiveType("null"));
    }
    assert(!trefs.isEmpty(), "We must have at least one type for the map properties");
    let valuesType: TypeRef;
    if (trefs.size === 1) {
        valuesType = defined(trefs.first());
    } else {
        valuesType = builder.getUnionType(c.names, c.areNamesInferred, trefs);
    }
    return builder.getMapType(valuesType);
}

export function inferMaps(graph: TypeGraph, stringTypeMapping: StringTypeMapping): TypeGraph {
    const allClasses = graph.allNamedTypesSeparated().classes;
    const classesToReplace = allClasses.filter(c => !c.isFixed && shouldBeMap(c.properties) !== undefined).toArray();
    return graph.rewrite(stringTypeMapping, classesToReplace.map(c => [c]), replaceClass);
}
