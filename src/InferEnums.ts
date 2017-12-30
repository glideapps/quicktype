"use strict";

import { Set, OrderedMap } from "immutable";

import { StringType } from "./Type";
import { TypeGraph } from "./TypeGraph";
import { GraphRewriteBuilder, TypeRef, StringTypeMapping } from "./TypeBuilder";
import { assert, defined } from "./Support";

const MIN_LENGTH_FOR_ENUM = 10;

function shouldBeEnum(t: StringType): OrderedMap<string, number> | undefined {
    const enumCases = t.enumCases;
    if (enumCases !== undefined) {
        assert(enumCases.size > 0, "How did we end up with zero enum cases?");
        const numValues = enumCases.map(n => n).reduce<number>((a, b) => a + b);
        if (numValues >= MIN_LENGTH_FOR_ENUM && enumCases.size < Math.sqrt(numValues)) {
            return t.enumCases;
        }
    }
    return undefined;
}

export function replaceString(setOfOneString: Set<StringType>, builder: GraphRewriteBuilder<StringType>): TypeRef {
    assert(setOfOneString.size === 1);
    const t = defined(setOfOneString.first());
    const maybeEnumCases = shouldBeEnum(t);
    if (maybeEnumCases !== undefined) {
        return builder.getEnumType(t.getNames(), maybeEnumCases.keySeq().toOrderedSet());
    }
    const names = t.hasNames ? t.getNames() : undefined;
    return builder.getStringType(names, undefined);
}

export function inferEnums(graph: TypeGraph, stringTypeMapping: StringTypeMapping): TypeGraph {
    const allStrings = graph
        .allTypesUnordered()
        .filter(t => t instanceof StringType)
        .map(t => [t])
        .toArray() as StringType[][];
    return graph.rewrite(stringTypeMapping, allStrings, replaceString);
}
