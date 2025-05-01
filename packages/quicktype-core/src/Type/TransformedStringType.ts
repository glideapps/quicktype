import {
    // eslint-disable-next-line @typescript-eslint/no-redeclare
    hasOwnProperty,
    mapFromObject
} from "collection-utils";

import { type TypeAttributes } from "../attributes/TypeAttributes";
import { uriInferenceAttributesProducer } from "../attributes/URIAttributes";

import { type Type } from "./Type";

/**
 * `jsonSchema` is the `format` to be used to represent this string type in
 * JSON Schema.  It's ok to "invent" a new one if the JSON Schema standard doesn't
 * have that particular type yet.
 *
 * For transformed type kinds that map to an existing primitive type, `primitive`
 * must specify that type kind.
 */
export interface TransformedStringTypeTargets {
    attributesProducer?: (s: string) => TypeAttributes;
    jsonSchema: string;
    primitive: PrimitiveNonStringTypeKind | undefined;
}

/**
 * All the transformed string type kinds and the JSON Schema formats and
 * primitive type kinds they map to.  Not all transformed string types map to
 * primitive types.  Date-time types, for example, stand on their own, but
 * stringified integers map to integers.
 */
const transformedStringTypeTargetTypeKinds = {
    "date": { jsonSchema: "date", primitive: undefined },
    "time": { jsonSchema: "time", primitive: undefined },
    "date-time": { jsonSchema: "date-time", primitive: undefined },
    "uuid": { jsonSchema: "uuid", primitive: undefined },
    "uri": { jsonSchema: "uri", primitive: undefined, attributesProducer: uriInferenceAttributesProducer },
    "integer-string": { jsonSchema: "integer", primitive: "integer" } as TransformedStringTypeTargets,
    "bool-string": { jsonSchema: "boolean", primitive: "bool" } as TransformedStringTypeTargets
};

export const transformedStringTypeTargetTypeKindsMap = mapFromObject(
    transformedStringTypeTargetTypeKinds as {
        [kind: string]: TransformedStringTypeTargets;
    }
);

export type TransformedStringTypeKind = keyof typeof transformedStringTypeTargetTypeKinds;
export type PrimitiveStringTypeKind = "string" | TransformedStringTypeKind;
export type PrimitiveNonStringTypeKind = "none" | "any" | "null" | "bool" | "integer" | "double";
export type PrimitiveTypeKind = PrimitiveNonStringTypeKind | PrimitiveStringTypeKind;
export type NamedTypeKind = "class" | "enum" | "union";
export type TypeKind = PrimitiveTypeKind | NamedTypeKind | "array" | "object" | "map" | "intersection";
export type ObjectTypeKind = "object" | "map" | "class";

export const transformedStringTypeKinds = new Set(
    Object.getOwnPropertyNames(transformedStringTypeTargetTypeKinds)
) as ReadonlySet<TransformedStringTypeKind>;

export function isPrimitiveStringTypeKind(kind: string): kind is PrimitiveStringTypeKind {
    return kind === "string" || hasOwnProperty(transformedStringTypeTargetTypeKinds, kind);
}

export function targetTypeKindForTransformedStringTypeKind(
    kind: PrimitiveStringTypeKind
): PrimitiveNonStringTypeKind | undefined {
    const target = transformedStringTypeTargetTypeKindsMap.get(kind);
    if (target === undefined) return undefined;
    return target.primitive;
}

export function isNumberTypeKind(kind: TypeKind): kind is "integer" | "double" {
    return kind === "integer" || kind === "double";
}

export function isPrimitiveTypeKind(kind: TypeKind): kind is PrimitiveTypeKind {
    if (isPrimitiveStringTypeKind(kind)) return true;
    if (isNumberTypeKind(kind)) return true;
    return kind === "none" || kind === "any" || kind === "null" || kind === "bool";
}

export function triviallyStructurallyCompatible(x: Type, y: Type): boolean {
    if (x.index === y.index) return true;
    if (x.kind === "none" || y.kind === "none") return true;
    return false;
}
