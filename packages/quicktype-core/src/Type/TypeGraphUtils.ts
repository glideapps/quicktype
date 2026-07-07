import {
    iterableFirst,
    mapMap,
    mapSome,
    setFilter,
    setMap,
} from "collection-utils";

import { TypeNames, namesTypeAttributeKind } from "../attributes/TypeNames";
import type { GraphRewriteBuilder } from "../GraphRewriting";
import { assert, defined, panic } from "../support/Support";

import {
    ClassType,
    IntersectionType,
    ObjectType,
    type Type,
    UnionType,
} from "./Type";
import type { StringTypeMapping } from "./TypeBuilderUtils";
import type { TypeGraph } from "./TypeGraph";
import type { TypeRef } from "./TypeRef";
import { combineTypeAttributesOfTypes } from "./TypeUtils";

export function noneToAny(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    debugPrintReconstitution: boolean,
): TypeGraph {
    const noneTypes = setFilter(
        graph.allTypesUnordered(),
        (t) => t.kind === "none",
    );
    if (noneTypes.size === 0) {
        return graph;
    }

    assert(noneTypes.size === 1, "Cannot have more than one none type");
    return graph.rewrite(
        "none to any",
        stringTypeMapping,
        false,
        [Array.from(noneTypes)],
        debugPrintReconstitution,
        (types, builder, forwardingRef) => {
            const attributes = combineTypeAttributesOfTypes("union", types);
            const tref = builder.getPrimitiveType(
                "any",
                attributes,
                forwardingRef,
            );
            return tref;
        },
    );
}

export function optionalToNullable(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    debugPrintReconstitution: boolean,
): TypeGraph {
    function rewriteClass(
        c: ClassType,
        builder: GraphRewriteBuilder<ClassType>,
        forwardingRef: TypeRef,
    ): TypeRef {
        const properties = mapMap(c.getProperties(), (p, name) => {
            const t = p.type;
            let ref: TypeRef;
            if (!p.isOptional || t.isNullable) {
                ref = builder.reconstituteType(t);
            } else {
                const nullType = builder.getPrimitiveType("null");
                let members: ReadonlySet<TypeRef>;
                if (t instanceof UnionType) {
                    members = setMap(t.members, (m) =>
                        builder.reconstituteType(m),
                    ).add(nullType);
                } else {
                    members = new Set([builder.reconstituteType(t), nullType]);
                }

                const attributes =
                    namesTypeAttributeKind.setDefaultInAttributes(
                        t.getAttributes(),
                        () => TypeNames.make(new Set([name]), new Set(), true),
                    );
                ref = builder.getUnionType(attributes, members);
            }

            return builder.makeClassProperty(ref, p.isOptional);
        });
        if (c.isFixed) {
            return builder.getUniqueClassType(
                c.getAttributes(),
                true,
                properties,
                forwardingRef,
            );
        } else {
            return builder.getClassType(
                c.getAttributes(),
                properties,
                forwardingRef,
            );
        }
    }

    const classesWithOptional = setFilter(
        graph.allTypesUnordered(),
        (t) =>
            t instanceof ClassType &&
            mapSome(t.getProperties(), (p) => p.isOptional),
    );
    const replacementGroups = Array.from(classesWithOptional).map((c) => [
        c as ClassType,
    ]);
    if (classesWithOptional.size === 0) {
        return graph;
    }

    return graph.rewrite(
        "optional to nullable",
        stringTypeMapping,
        false,
        replacementGroups,
        debugPrintReconstitution,
        (setOfClass, builder, forwardingRef) => {
            assert(setOfClass.size === 1);
            const c = defined(iterableFirst(setOfClass));
            return rewriteClass(c, builder, forwardingRef);
        },
    );
}

// Collapse types that are structurally identical to each other into a single
// type. Unlike the identity-map deduplication in `TypeBuilder`, which can only
// deduplicate a type at the moment it is created (and so misses *recursive*
// types, whose structure isn't known until after they've been given a type
// ref), this compares whole types — cycles and all — via
// `structurallyCompatible`. It only ever merges types that are exactly
// bisimilar, so it never over-generalizes; it just removes the duplicate
// recursive types the flattening fixpoint leaves behind on schemas with cyclic
// composition (issues #2187 and #1376).
export function combineIdenticalTypes(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    debugPrintRemapping: boolean,
): TypeGraph {
    // Only structural (composite) types can be duplicated in a way the identity
    // map misses; primitives/enums/strings already deduplicate on creation.
    const dedupableKinds = new Set([
        "class",
        "object",
        "map",
        "array",
        "union",
        "intersection",
    ]);

    // Bucket by a cheap structural signature so we only run the (relatively
    // expensive) structural-equality check between plausible candidates.
    function signature(t: Type): string {
        if (t instanceof ClassType || t instanceof ObjectType) {
            const props = Array.from(t.getProperties().keys()).sort().join(",");
            const additional = t.getAdditionalProperties() !== undefined;
            return `${t.kind}|${props}|${additional}`;
        }

        if (t instanceof UnionType || t instanceof IntersectionType) {
            const memberKinds = Array.from(t.members)
                .map((m) => m.kind)
                .sort()
                .join(",");
            return `${t.kind}|${t.members.size}|${memberKinds}`;
        }

        return t.kind;
    }

    const buckets = new Map<string, Type[]>();
    for (const t of graph.allTypesUnordered()) {
        if (!dedupableKinds.has(t.kind)) continue;
        const sig = signature(t);
        let bucket = buckets.get(sig);
        if (bucket === undefined) {
            bucket = [];
            buckets.set(sig, bucket);
        }

        bucket.push(t);
    }

    const map = new Map<Type, Type>();
    for (const bucket of buckets.values()) {
        if (bucket.length < 2) continue;
        // Deterministic representative order: lowest index first.
        bucket.sort((a, b) => a.index - b.index);
        const representatives: Type[] = [];
        for (const t of bucket) {
            const rep = representatives.find((r) =>
                r.structurallyCompatible(t, false),
            );
            if (rep === undefined) {
                representatives.push(t);
            } else {
                map.set(t, rep);
            }
        }
    }

    return graph.remap(
        "combine identical types",
        stringTypeMapping,
        false,
        map,
        debugPrintRemapping,
    );
}

export function removeIndirectionIntersections(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    debugPrintRemapping: boolean,
): TypeGraph {
    const map: Array<[Type, Type]> = [];

    for (const t of graph.allTypesUnordered()) {
        if (!(t instanceof IntersectionType)) continue;
        const seen = new Set([t]);
        let current = t;
        while (current.members.size === 1) {
            const member = defined(iterableFirst(current.members));
            if (!(member instanceof IntersectionType)) {
                map.push([t, member]);
                break;
            }

            if (seen.has(member)) {
                // FIXME: Technically, this is an any type.
                return panic("There's a cycle of intersection types");
            }

            seen.add(member);
            current = member;
        }
    }

    return graph.remap(
        "remove indirection intersections",
        stringTypeMapping,
        false,
        new Map(map),
        debugPrintRemapping,
    );
}
