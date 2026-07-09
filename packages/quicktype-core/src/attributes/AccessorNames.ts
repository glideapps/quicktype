import {
    iterableFirst,
    mapFromIterable,
    mapFromObject,
    mapMap,
    mapMergeInto,
    setUnionManyInto,
} from "collection-utils";

import type {
    JSONSchemaAttributes,
    JSONSchemaType,
    Ref,
} from "../input/JSONSchemaInput";
import type { JSONSchema } from "../input/JSONSchemaStore";
import { messageAssert } from "../Messages";
import {
    checkArray,
    checkStringMap,
    defined,
    isStringMap,
} from "../support/Support";
import type {
    EnumType,
    ObjectType,
    Type,
    UnionType,
} from "../Type/Type";

import { TypeAttributeKind, type TypeAttributes } from "./TypeAttributes";

export type AccessorEntry = string | Map<string, string>;

export type AccessorNames = Map<string, AccessorEntry>;

class AccessorNamesTypeAttributeKind extends TypeAttributeKind<AccessorNames> {
    public constructor() {
        super("accessorNames");
    }

    public makeInferred(_: AccessorNames): undefined {
        return undefined;
    }
}

export const accessorNamesTypeAttributeKind: TypeAttributeKind<AccessorNames> =
    new AccessorNamesTypeAttributeKind();

// Returns [name, isFixed].
function getFromEntry(
    entry: AccessorEntry,
    language: string,
): [string, boolean] | undefined {
    if (typeof entry === "string") return [entry, false];

    const maybeForLanguage = entry.get(language);
    if (maybeForLanguage !== undefined) return [maybeForLanguage, true];

    const maybeWildcard = entry.get("*");
    if (maybeWildcard !== undefined) return [maybeWildcard, false];

    return undefined;
}

export function lookupKey(
    accessors: AccessorNames,
    key: string,
    language: string,
): [string, boolean] | undefined {
    const entry = accessors.get(key);
    if (entry === undefined) return undefined;
    return getFromEntry(entry, language);
}

export function objectPropertyNames(
    o: ObjectType,
    language: string,
): Map<string, [string, boolean] | undefined> {
    const accessors = accessorNamesTypeAttributeKind.tryGetInAttributes(
        o.getAttributes(),
    );
    const map = o.getProperties();
    if (accessors === undefined) return mapMap(map, (_) => undefined);
    return mapMap(map, (_cp, n) => lookupKey(accessors, n, language));
}

export function enumCaseNames(
    e: EnumType,
    language: string,
): Map<string, [string, boolean] | undefined> {
    const accessors = accessorNamesTypeAttributeKind.tryGetInAttributes(
        e.getAttributes(),
    );
    if (accessors === undefined)
        return mapMap(e.cases.entries(), (_) => undefined);
    return mapMap(e.cases.entries(), (c) => lookupKey(accessors, c, language));
}

export function getAccessorName(
    names: Map<string, [string, boolean] | undefined>,
    original: string,
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
class UnionIdentifierTypeAttributeKind extends TypeAttributeKind<
    ReadonlySet<number>
> {
    public constructor() {
        super("unionIdentifier");
    }

    public combine(arr: Array<ReadonlySet<number>>): ReadonlySet<number> {
        return setUnionManyInto(new Set(), arr);
    }

    public makeInferred(_: ReadonlySet<number>): ReadonlySet<number> {
        return new Set();
    }
}

export const unionIdentifierTypeAttributeKind: TypeAttributeKind<
    ReadonlySet<number>
> = new UnionIdentifierTypeAttributeKind();

let nextUnionIdentifier = 0;

export function makeUnionIdentifierAttribute(): TypeAttributes {
    const attributes = unionIdentifierTypeAttributeKind.makeAttributes(
        new Set([nextUnionIdentifier]),
    );
    nextUnionIdentifier += 1;
    return attributes;
}

class UnionMemberNamesTypeAttributeKind extends TypeAttributeKind<
    Map<number, AccessorEntry>
> {
    public constructor() {
        super("unionMemberNames");
    }

    public combine(
        arr: Array<Map<number, AccessorEntry>>,
    ): Map<number, AccessorEntry> {
        const result = new Map<number, AccessorEntry>();
        for (const m of arr) {
            mapMergeInto(result, m);
        }

        return result;
    }
}

export const unionMemberNamesTypeAttributeKind: TypeAttributeKind<
    Map<number, AccessorEntry>
> = new UnionMemberNamesTypeAttributeKind();

export function makeUnionMemberNamesAttribute(
    unionAttributes: TypeAttributes,
    entry: AccessorEntry,
): TypeAttributes {
    const identifiers = defined(
        unionIdentifierTypeAttributeKind.tryGetInAttributes(unionAttributes),
    );
    const map = mapFromIterable(identifiers, (_) => entry);
    return unionMemberNamesTypeAttributeKind.makeAttributes(map);
}

export function unionMemberName(
    u: UnionType,
    member: Type,
    language: string,
): [string | undefined, boolean] {
    const identifiers = unionIdentifierTypeAttributeKind.tryGetInAttributes(
        u.getAttributes(),
    );
    if (identifiers === undefined) return [undefined, false];

    const memberNames = unionMemberNamesTypeAttributeKind.tryGetInAttributes(
        member.getAttributes(),
    );
    if (memberNames === undefined) return [undefined, false];

    const names = new Set<string>();
    const fixedNames = new Set<string>();
    for (const i of identifiers) {
        const maybeEntry = memberNames.get(i);
        if (maybeEntry === undefined) continue;
        const maybeName = getFromEntry(maybeEntry, language);
        if (maybeName === undefined) continue;
        const [name, isNameFixed] = maybeName;
        if (isNameFixed) {
            fixedNames.add(name);
        } else {
            names.add(name);
        }
    }

    let size: number;
    let isFixed: boolean;
    let first = iterableFirst(fixedNames);
    if (first !== undefined) {
        size = fixedNames.size;
        isFixed = true;
    } else {
        first = iterableFirst(names);
        if (first === undefined) return [undefined, false];

        size = names.size;
        isFixed = false;
    }

    messageAssert(size === 1, "SchemaMoreThanOneUnionMemberName", {
        names: Array.from(names),
    });
    return [first, isFixed];
}

function isAccessorEntry(
    x: unknown,
): x is string | { [language: string]: string } {
    if (typeof x === "string") {
        return true;
    }

    return isStringMap(x, (v: unknown): v is string => typeof v === "string");
}

function makeAccessorEntry(
    ae: string | { [language: string]: string },
): AccessorEntry {
    if (typeof ae === "string") return ae;
    return mapFromObject(ae);
}

export function makeAccessorNames(x: unknown): AccessorNames {
    // FIXME: Do proper error reporting
    const stringMap = checkStringMap(x, isAccessorEntry);
    return mapMap(mapFromObject(stringMap), makeAccessorEntry);
}

export function accessorNamesAttributeProducer(
    schema: JSONSchema,
    canonicalRef: Ref,
    _types: Set<JSONSchemaType>,
    cases: JSONSchema[] | undefined,
): JSONSchemaAttributes | undefined {
    if (typeof schema !== "object") return undefined;
    const maybeAccessors = schema["qt-accessors"];
    if (maybeAccessors === undefined) return undefined;

    if (cases === undefined) {
        return {
            forType: accessorNamesTypeAttributeKind.makeAttributes(
                makeAccessorNames(maybeAccessors),
            ),
        };
    } else {
        const identifierAttribute = makeUnionIdentifierAttribute();

        const accessors = checkArray(maybeAccessors, isAccessorEntry);
        messageAssert(
            cases.length === accessors.length,
            "SchemaWrongAccessorEntryArrayLength",
            {
                operation: "oneOf",
                ref: canonicalRef.push("oneOf"),
            },
        );
        const caseAttributes = accessors.map((accessor) =>
            makeUnionMemberNamesAttribute(
                identifierAttribute,
                makeAccessorEntry(accessor),
            ),
        );
        return { forUnion: identifierAttribute, forCases: caseAttributes };
    }
}
