import { PrimitiveType } from "../Type";
import { stringTypesForType } from "../TypeUtils";
import { TypeGraph, TypeRef } from "../TypeGraph";
import { StringTypeMapping } from "../TypeBuilder";
import { GraphRewriteBuilder } from "../GraphRewriting";
import { assert, defined } from "../support/Support";
import { emptyTypeAttributes } from "../TypeAttributes";
import { StringTypes } from "../StringTypes";
import { iterableFirst, mapFilter, iterableSome, iterableReduce } from "../support/Containers";

const MIN_LENGTH_FOR_ENUM = 10;

function shouldBeEnum(enumCases: ReadonlyMap<string, number>): boolean {
    assert(enumCases.size > 0, "How did we end up with zero enum cases?");
    const someCaseIsNotNumber = iterableSome(
        enumCases.keys(),
        key => /^(\-|\+)?[0-9]+(\.[0-9]+)?$/.test(key) === false
    );
    const numValues = iterableReduce(enumCases.values(), 0, (a, b) => a + b);
    return numValues >= MIN_LENGTH_FOR_ENUM && enumCases.size < Math.sqrt(numValues) && someCaseIsNotNumber;
}

export type EnumInference = "none" | "all" | "infer";

export function expandStrings(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    inference: EnumInference,
    debugPrintReconstitution: boolean
): TypeGraph {
    function replaceString(
        group: ReadonlySet<PrimitiveType>,
        builder: GraphRewriteBuilder<PrimitiveType>,
        forwardingRef: TypeRef
    ): TypeRef {
        assert(group.size === 1);
        const t = defined(iterableFirst(group));
        const stringTypes = stringTypesForType(t);
        const attributes = mapFilter(t.getAttributes(), a => a !== stringTypes);
        const mappedStringTypes = stringTypes.applyStringTypeMapping(stringTypeMapping);

        if (!mappedStringTypes.isRestricted) {
            return builder.getStringType(attributes, StringTypes.unrestricted, forwardingRef);
        }

        const types: TypeRef[] = [];
        const cases = defined(mappedStringTypes.cases);
        if (cases.size > 0) {
            if (inference === "all" || (inference === "infer" && shouldBeEnum(cases))) {
                types.push(builder.getEnumType(emptyTypeAttributes, new Set(cases.keys())));
            } else {
                return builder.getStringType(attributes, StringTypes.unrestricted, forwardingRef);
            }
        }
        if (mappedStringTypes.allowDate) {
            types.push(builder.getPrimitiveType("date"));
        }
        if (mappedStringTypes.allowTime) {
            types.push(builder.getPrimitiveType("time"));
        }
        if (mappedStringTypes.allowDateTime) {
            types.push(builder.getPrimitiveType("date-time"));
        }
        assert(types.length > 0, "We got an empty string type");
        return builder.getUnionType(attributes, new Set(types), forwardingRef);
    }

    const allStrings = Array.from(graph.allTypesUnordered())
        .filter(t => t.kind === "string" && stringTypesForType(t as PrimitiveType).isRestricted)
        .map(t => [t]) as PrimitiveType[][];
    return graph.rewrite(
        "expand strings",
        stringTypeMapping,
        false,
        allStrings,
        debugPrintReconstitution,
        replaceString
    );
}
