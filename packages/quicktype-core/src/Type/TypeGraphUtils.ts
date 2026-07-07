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

// The set of types that lie on a cycle, i.e. are reachable from themselves
// through their (non-attribute) children. Computed with an iterative Tarjan
// SCC pass — a type is recursive iff its strongly-connected component has more
// than one member or it has an edge to itself. Iterative (not recursive) so it
// can't itself stack-overflow on the deep graphs this module handles.
function recursiveTypes(graph: TypeGraph): Set<Type> {
    const result = new Set<Type>();
    const index = new Map<Type, number>();
    const lowlink = new Map<Type, number>();
    const onStack = new Set<Type>();
    const stack: Type[] = [];
    let counter = 0;

    for (const root of graph.allTypesUnordered()) {
        if (index.has(root)) continue;
        // Explicit work stack of (type, iterator over its children).
        const work: Array<[Type, Iterator<Type>]> = [
            [root, root.getNonAttributeChildren()[Symbol.iterator]()],
        ];
        index.set(root, counter);
        lowlink.set(root, counter);
        counter += 1;
        stack.push(root);
        onStack.add(root);

        while (work.length > 0) {
            const [t, it] = work[work.length - 1];
            const next = it.next();
            if (!next.done) {
                const child = next.value;
                if (t === child) result.add(t); // self-edge
                if (!index.has(child)) {
                    index.set(child, counter);
                    lowlink.set(child, counter);
                    counter += 1;
                    stack.push(child);
                    onStack.add(child);
                    work.push([
                        child,
                        child.getNonAttributeChildren()[Symbol.iterator](),
                    ]);
                } else if (onStack.has(child)) {
                    lowlink.set(
                        t,
                        Math.min(
                            defined(lowlink.get(t)),
                            defined(index.get(child)),
                        ),
                    );
                }

                continue;
            }

            // Done with t's children: pop it and propagate its lowlink up.
            work.pop();
            if (work.length > 0) {
                const parent = work[work.length - 1][0];
                lowlink.set(
                    parent,
                    Math.min(
                        defined(lowlink.get(parent)),
                        defined(lowlink.get(t)),
                    ),
                );
            }

            // t is an SCC root: pop its component. Any component with >1 member
            // is a cycle, so all its members are recursive.
            if (defined(lowlink.get(t)) === defined(index.get(t))) {
                const component: Type[] = [];
                let popped: Type;
                do {
                    popped = defined(stack.pop());
                    onStack.delete(popped);
                    component.push(popped);
                } while (popped !== t);
                if (component.length > 1) {
                    for (const c of component) result.add(c);
                }
            }
        }
    }

    return result;
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

    // Only merge types that participate in a cycle. `structurallyCompatible`
    // ignores type attributes, so two structurally-identical types can still
    // render differently — e.g. a plain `string` and an enum-bearing `string`
    // both have kind `string`, so a `null | string` union is "compatible" with
    // a `null | <enum>` union and merging the two would wrongly constrain the
    // free-form field to the enum's cases (us-senators.json). The identity map
    // in `TypeBuilder` already deduplicates attribute-equal *non-recursive*
    // duplicates safely; the only duplicates it misses — and the only ones this
    // pass exists to remove — are recursive ones, whose structure isn't known at
    // creation time. Restricting to cycle members avoids the attribute-blind
    // over-merge while still collapsing the recursive duplicates (#2187, #1376).
    const recursive = recursiveTypes(graph);
    const buckets = new Map<string, Type[]>();
    for (const t of graph.allTypesUnordered()) {
        if (!dedupableKinds.has(t.kind)) continue;
        if (!recursive.has(t)) continue;
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

    // Merging two structurally-identical types orphans the (structurally
    // identical but distinct) sub-types of the mapped-away type, so their
    // attributes — including the provenance the invariant check tracks — are
    // intentionally dropped. This is inherent to deduplicating recursive types,
    // whose duplicate copies are entirely separate subtrees. Signal the loss so
    // the provenance check doesn't flag it, as other knowingly-lossy rewrites do.
    return graph.remap(
        "combine identical types",
        stringTypeMapping,
        false,
        map,
        debugPrintRemapping,
        false,
        true,
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
