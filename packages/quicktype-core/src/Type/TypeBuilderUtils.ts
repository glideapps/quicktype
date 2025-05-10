import {
    type PrimitiveStringTypeKind,
    type TransformedStringTypeKind,
    transformedStringTypeKinds
} from "./TransformedStringType";

export type StringTypeMapping = ReadonlyMap<TransformedStringTypeKind, PrimitiveStringTypeKind>;

export function stringTypeMappingGet(stm: StringTypeMapping, kind: TransformedStringTypeKind): PrimitiveStringTypeKind {
    const mapped = stm.get(kind);
    if (mapped === undefined) return "string";
    return mapped;
}

let noStringTypeMapping: StringTypeMapping | undefined;

export function getNoStringTypeMapping(): StringTypeMapping {
    if (noStringTypeMapping === undefined) {
        noStringTypeMapping = new Map(
            Array.from(transformedStringTypeKinds).map(
                k => [k, k] as [TransformedStringTypeKind, PrimitiveStringTypeKind]
            )
        );
    }

    return noStringTypeMapping;
}
