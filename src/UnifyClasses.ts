"use strict";

import { Set, OrderedMap, OrderedSet } from "immutable";

import { ClassType, Type, nonNullTypeCases } from "./Type";
import { TypeRef } from "./TypeBuilder";
import { TypeNames, makeTypeNames } from "./TypeNames";

export function getCliqueProperties(
    clique: Set<ClassType>,
    makePropertyType: (names: TypeNames, types: OrderedSet<Type>, isNullable: boolean) => TypeRef
): OrderedMap<string, TypeRef> {
    let properties = OrderedMap<string, [OrderedSet<Type>, number, boolean]>();
    clique.forEach(c => {
        c.properties.forEach((t, name) => {
            let p = properties.get(name);
            if (p === undefined) {
                p = [OrderedSet(), 0, false];
                properties = properties.set(name, p);
            }
            p[1] += 1;
            p[0] = p[0].union(nonNullTypeCases(t));
            if (t.isNullable) {
                p[2] = true;
            }
        });
    });
    return properties.map(([types, count, haveNullable], name) => {
        const isNullable = haveNullable || count < clique.size;
        const allNames = types.filter(t => t.hasNames).map(t => t.getNames());
        const typeNames = allNames.isEmpty()
            ? makeTypeNames(name, true)
            : allNames.reduce<TypeNames>((l, r) => l.union(r));
        return makePropertyType(typeNames, types, isNullable);
    });
}
