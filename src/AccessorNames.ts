"use strict";

import { Map, Set } from "immutable";

import { TypeAttributeKind, TypeAttributes } from "./TypeAttributes";
import { checkStringMap, isStringMap, defined } from "./Support";
import { EnumType, UnionType, Type, ObjectType } from "./Type";
import { messageAssert, ErrorMessage } from "./Messages";

export type AccessorEntry = string | { [language: string]: string };

export type AccessorNames = { [key: string]: AccessorEntry };

export const accessorNamesTypeAttributeKind = new TypeAttributeKind<AccessorNames>(
    "accessorNames",
    undefined,
    _ => undefined,
    undefined
);

export function isAccessorEntry(x: any): x is AccessorEntry {
    if (typeof x === "string") {
        return true;
    }
    return isStringMap(x, (v: any): v is string => typeof v === "string");
}

export function checkAccessorNames(x: any): AccessorNames {
    return checkStringMap(x, isAccessorEntry);
}

// Returns [name, isFixed].
function getFromEntry(entry: AccessorEntry, language: string): [string, boolean] | undefined {
    if (typeof entry === "string") return [entry, false];

    const maybeForLanguage = entry[language];
    if (maybeForLanguage !== undefined) return [maybeForLanguage, true];

    const maybeWildcard = entry["*"];
    if (maybeWildcard !== undefined) return [maybeWildcard, false];

    return undefined;
}

function lookupKey(accessors: AccessorNames, key: string, language: string): [string, boolean] | undefined {
    if (!Object.prototype.hasOwnProperty.call(accessors, key)) return undefined;

    return getFromEntry(accessors[key], language);
}

export function objectPropertyNames(o: ObjectType, language: string): Map<string, [string, boolean] | undefined> {
    const accessors = accessorNamesTypeAttributeKind.tryGetInAttributes(o.getAttributes());
    const map = o.properties;
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

export const unionIdentifierTypeAttributeKind = new TypeAttributeKind<Set<number>>(
    "unionIdentifier",
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
