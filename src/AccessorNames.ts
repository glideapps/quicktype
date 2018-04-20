"use strict";

import { Map, Set } from "immutable";

import { TypeAttributeKind, TypeAttributes } from "./TypeAttributes";
import { defined } from "./Support";
import { EnumType, UnionType, Type, ObjectType } from "./Type";
import { messageAssert, ErrorMessage } from "./Messages";

export type AccessorEntry = string | Map<string, string>;

export type AccessorNames = Map<string, AccessorEntry>;

export const accessorNamesTypeAttributeKind = new TypeAttributeKind<AccessorNames>(
    "accessorNames",
    false,
    undefined,
    _ => undefined,
    undefined
);

// Returns [name, isFixed].
function getFromEntry(entry: AccessorEntry, language: string): [string, boolean] | undefined {
    if (typeof entry === "string") return [entry, false];

    const maybeForLanguage = entry.get(language);
    if (maybeForLanguage !== undefined) return [maybeForLanguage, true];

    const maybeWildcard = entry.get("*");
    if (maybeWildcard !== undefined) return [maybeWildcard, false];

    return undefined;
}

function lookupKey(accessors: AccessorNames, key: string, language: string): [string, boolean] | undefined {
    const entry = accessors.get(key);
    if (entry === undefined) return undefined;
    return getFromEntry(entry, language);
}

export function objectPropertyNames(o: ObjectType, language: string): Map<string, [string, boolean] | undefined> {
    const accessors = accessorNamesTypeAttributeKind.tryGetInAttributes(o.getAttributes());
    const map = o.getProperties();
    if (accessors === undefined) return map.map(_ => undefined);
    return map.map((_cp, n) => lookupKey(accessors, n, language));
}

export function enumCaseNames(e: EnumType, language: string): Map<string, [string, boolean] | undefined> {
    const accessors = accessorNamesTypeAttributeKind.tryGetInAttributes(e.getAttributes());
    const map = e.cases.toMap();
    if (accessors === undefined) return map.map(_ => undefined);
    return map.map(c => lookupKey(accessors, c, language));
}

export function getAccessorName(
    names: Map<string, [string, boolean] | undefined>,
    original: string
): [string | undefined, boolean] {
    const maybeName = names.get(original);
    if (maybeName === undefined) return [undefined, false];
    return maybeName;
}

// Union members can be recombined and reordered, and unions are combined as well, so
// we can't just store an array of accessor entries in a union, one array entry for each
// union member.  Instead, we give each union in the origin type graph a union identifier,
// and each union member type gets a map from union identifiers to accessor entries.
// That way, no matter how the types are recombined, if we find a union member, we can look
// up its union's identifier(s), and then look up the member's accessor entries for that
// identifier.  Of course we might find more than one, potentially conflicting.
export const unionIdentifierTypeAttributeKind = new TypeAttributeKind<Set<number>>(
    "unionIdentifier",
    false,
    (a, b) => a.union(b),
    _ => undefined,
    undefined
);

let nextUnionIdentifier: number = 0;

export function makeUnionIdentifierAttribute(): TypeAttributes {
    const attributes = unionIdentifierTypeAttributeKind.makeAttributes(Set([nextUnionIdentifier]));
    nextUnionIdentifier += 1;
    return attributes;
}

export const unionMemberNamesTypeAttributeKind = new TypeAttributeKind<Map<number, AccessorEntry>>(
    "unionMemberNames",
    false,
    (a, b) => a.merge(b),
    _ => undefined,
    undefined
);

export function makeUnionMemberNamesAttribute(unionAttributes: TypeAttributes, entry: AccessorEntry): TypeAttributes {
    const identifiers = defined(unionIdentifierTypeAttributeKind.tryGetInAttributes(unionAttributes));
    const map = identifiers.toMap().map(_ => entry);
    return unionMemberNamesTypeAttributeKind.makeAttributes(map);
}

export function unionMemberName(u: UnionType, member: Type, language: string): [string | undefined, boolean] {
    const identifiers = unionIdentifierTypeAttributeKind.tryGetInAttributes(u.getAttributes());
    if (identifiers === undefined) return [undefined, false];

    const memberNames = unionMemberNamesTypeAttributeKind.tryGetInAttributes(member.getAttributes());
    if (memberNames === undefined) return [undefined, false];

    let names: Set<string> = Set();
    let fixedNames: Set<string> = Set();
    identifiers.forEach(i => {
        const maybeEntry = memberNames.get(i);
        if (maybeEntry === undefined) return;
        const maybeName = getFromEntry(maybeEntry, language);
        if (maybeName === undefined) return;
        const [name, isNameFixed] = maybeName;
        if (isNameFixed) {
            fixedNames = fixedNames.add(name);
        } else {
            names = names.add(name);
        }
    });

    let size: number;
    let isFixed: boolean;
    let first = fixedNames.first();
    if (first !== undefined) {
        size = fixedNames.size;
        isFixed = true;
    } else {
        first = names.first();
        if (first === undefined) return [undefined, false];

        size = names.size;
        isFixed = false;
    }

    messageAssert(size === 1, ErrorMessage.SchemaMoreThanOneUnionMemberName, { names });
    return [first, isFixed];
}
