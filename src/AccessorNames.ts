"use strict";

import { Map, Set } from "immutable";

import { TypeAttributeKind, TypeAttributes } from "./TypeAttributes";
import { checkStringMap, isStringMap, defined, assert } from "./Support";
import { EnumType, ClassType, UnionType, Type } from "./Type";

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

function getFromEntry(entry: AccessorEntry, language: string): string | undefined {
    if (typeof entry === "string") return entry;

    const maybeForLanguage = entry[language];
    if (maybeForLanguage !== undefined) return maybeForLanguage;

    const maybeCatchAll = entry["*"];
    if (maybeCatchAll !== undefined) return maybeCatchAll;

    return undefined;
}

function lookupKey(accessors: AccessorNames, key: string, language: string): string | undefined {
    if (!Object.prototype.hasOwnProperty.call(accessors, key)) return undefined;

    return getFromEntry(accessors[key], language);
}

export function classPropertyNames(c: ClassType, language: string): Map<string, string | undefined> {
    const accessors = accessorNamesTypeAttributeKind.tryGetInAttributes(c.getAttributes());
    const map = c.properties;
    if (accessors === undefined) return map.map(_ => undefined);
    return map.map((_cp, n) => lookupKey(accessors, n, language));
}

export function enumCaseNames(e: EnumType, language: string): Map<string, string | undefined> {
    const accessors = accessorNamesTypeAttributeKind.tryGetInAttributes(e.getAttributes());
    const map = e.cases.toMap();
    if (accessors === undefined) return map.map(_ => undefined);
    return map.map(c => lookupKey(accessors, c, language));
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

export function unionMemberName(u: UnionType, member: Type, language: string): string | undefined {
    const identifiers = unionIdentifierTypeAttributeKind.tryGetInAttributes(u.getAttributes());
    if (identifiers === undefined) return undefined;

    const memberNames = unionMemberNamesTypeAttributeKind.tryGetInAttributes(member.getAttributes());
    if (memberNames === undefined) return undefined;

    let names: Set<string> = Set();
    identifiers.forEach(i => {
        const maybeEntry = memberNames.get(i);
        if (maybeEntry === undefined) return;
        const maybeName = getFromEntry(maybeEntry, language);
        if (maybeName === undefined) return;
        names = names.add(maybeName);
    });

    const first = names.first();
    if (first === undefined) return undefined;

    assert(names.size === 1, `More than one name given for union member: ${names.join(", ")}`);
    return first;
}
