"use strict";

import { Set, Map, OrderedSet, OrderedMap } from "immutable";

import { TypeGraph } from "./TypeGraph";
import { StringTypeMapping, GraphRewriteBuilder, TypeRef } from "./TypeBuilder";
import { IntersectionType, Type, ClassType, ClassProperty } from "./Type";
import { assert, defined, panic } from "./Support";
import { TypeAttributes } from "./TypeAttributes";

function intersectionMembersRecursively(intersection: IntersectionType): OrderedSet<Type> {
    const types: Type[] = [];
    function process(t: Type): void {
        if (t instanceof IntersectionType) {
            t.members.forEach(process);
        } else {
            types.push(t);
        }
    }
    process(intersection);
    return OrderedSet(types);
}

export function resolveIntersections(graph: TypeGraph, stringTypeMapping: StringTypeMapping): TypeGraph {
    function replace(
        types: Set<IntersectionType>,
        builder: GraphRewriteBuilder<IntersectionType>,
        forwardingRef: TypeRef
    ): TypeRef {
        assert(types.size === 1);
        const members = intersectionMembersRecursively(defined(types.first()));
        console.log(`${members.size} members`);
        if (members.isEmpty()) {
            return builder.getPrimitiveType("any", forwardingRef);
        }
        if (members.size === 1) {
            return builder.reconstituteType(defined(members.first()));
        }

        // FIXME: collect attributes
        const attributes: TypeAttributes = Map();
        const result = builder.getUniqueClassType(attributes, true);

        let properties: OrderedMap<string, ClassProperty> = OrderedMap();
        members.forEach(t => {
            if (!(t instanceof ClassType)) {
                return panic("Every intersection member must be a class type");
            }
            t.properties.forEach((cp, name) => {
                if (properties.has(name)) {
                    return panic(`Intersection has defined the property ${name} more than once`);
                }
                const tref = builder.reconstituteType(cp.type);
                properties = properties.set(name, new ClassProperty(tref, cp.isOptional));
            });
        });

        builder.setClassProperties(result, properties);
        return result;
    }
    const intersections = graph.allTypesUnordered().filter(t => t instanceof IntersectionType) as Set<IntersectionType>;
    const groups = intersections.map(i => [i]).toArray();
    return graph.rewrite(stringTypeMapping, false, groups, replace);
}
