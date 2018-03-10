"use strict";

import { List, OrderedSet, Map, Set, hash } from "immutable";
import * as pluralize from "pluralize";

import { ClassProperty } from "./Type";
import { panic, assertNever, StringMap, checkStringMap, assert, defined, addHashCode } from "./Support";
import { TypeGraphBuilder, TypeRef } from "./TypeBuilder";
import { TypeNames } from "./TypeNames";
import { makeNamesTypeAttributes, modifyTypeNames, singularizeTypeNames } from "./TypeNames";
import {
    TypeAttributes,
    descriptionTypeAttributeKind,
    propertyDescriptionsTypeAttributeKind,
    makeTypeAttributesInferred
} from "./TypeAttributes";

export enum PathElementKind {
    KeyOrIndex,
    Type,
    Object
}

export type PathElement =
    | { kind: PathElementKind.KeyOrIndex; key: string }
    | { kind: PathElementKind.Type; index: number }
    | { kind: PathElementKind.Object };

function keyOrIndex(pe: PathElement): string | undefined {
    if (pe.kind !== PathElementKind.KeyOrIndex) return undefined;
    return pe.key;
}

function pathElementEquals(a: PathElement, b: PathElement): boolean {
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
        case PathElementKind.Type:
            return a.index === (b as any).index;
        case PathElementKind.KeyOrIndex:
            return a.key === (b as any).key;
        default:
            return true;
    }
}

export type JSONSchema = StringMap | boolean;

export function checkJSONSchema(x: any): JSONSchema {
    if (typeof x === "boolean") return x;
    if (Array.isArray(x)) return panic("An array is not a valid JSON Schema");
    if (x === null) return panic("null is not a valid JSON Schema");
    if (typeof x !== "object") return panic("Only booleans and objects can be valid JSON Schemas");
    return x;
}

const numberRegexp = new RegExp("^[0-9]+$");

export class Ref {
    static root(address: string): Ref {
        return new Ref(address, List());
    }

    private static parsePath(path: string): List<PathElement> {
        // FIXME: We treat the paths `#/foo` and `#foo` the same, but they
        // shouldn't be.  Maybe the root `#/` should always have one empty
        // path element first?
        if (path.startsWith("#/")) {
            path = path.substr(2);
        } else if (path.startsWith("#")) {
            path = path.substr(1);
        }

        if (path === "") return List();

        const elements: PathElement[] = [];
        const parts = path.split("/");
        // FIXME: Just `map` here.
        for (let i = 0; i < parts.length; i++) {
            elements.push({ kind: PathElementKind.KeyOrIndex, key: parts[i] });
        }
        return List(elements);
    }

    static parse(ref: any): Ref {
        if (typeof ref !== "string") {
            return panic("$ref must be a string");
        }

        const indexOfHash = ref.indexOf("#");
        if (indexOfHash < 0) {
            return Ref.root(ref);
        }

        const address = ref.substr(0, indexOfHash);
        const path = ref.substr(indexOfHash);
        const elements = Ref.parsePath(path);
        return new Ref(address, elements);
    }

    constructor(readonly address: string, readonly path: List<PathElement>) { }

    get hasAddress(): boolean {
        return this.address !== "";
    }

    private pushElement(pe: PathElement): Ref {
        return new Ref(this.address, this.path.push(pe));
    }

    push(...keys: string[]): Ref {
        let ref: Ref = this;
        for (const key of keys) {
            ref = ref.pushElement({ kind: PathElementKind.KeyOrIndex, key });
        }
        return ref;
    }

    pushObject(): Ref {
        return this.pushElement({ kind: PathElementKind.Object });
    }

    pushType(index: number): Ref {
        return this.pushElement({ kind: PathElementKind.Type, index });
    }

    resolveAgainst(base: Ref | undefined): Ref {
        let address: string;
        if (this.hasAddress) {
            // FIXME: Address must be interpreted relative to base address.
            address = this.address;
        } else {
            if (base === undefined || !base.hasAddress) {
                return panic("Top-level ref must have an address");
            }
            address = base.address;
        }
        return new Ref(address, this.path);
    }

    get name(): string {
        let path = this.path;

        for (; ;) {
            const e = path.last();
            if (e === undefined) {
                return "Something";
            }

            switch (e.kind) {
                case PathElementKind.KeyOrIndex:
                    if (e.key.match(numberRegexp) !== null) {
                        return e.key;
                    }
                    break;
                case PathElementKind.Type:
                case PathElementKind.Object:
                    return panic("We shouldn't try to get the name of Type or Object refs");
                default:
                    return assertNever(e);
            }

            path = path.pop();
        }
    }

    get definitionName(): string | undefined {
        const pe = this.path.get(-2);
        if (pe === undefined) return undefined;
        if (keyOrIndex(pe) === "definitions") return keyOrIndex(defined(this.path.last()));
        return undefined;
    }

    toString(): string {
        function elementToString(e: PathElement): string {
            switch (e.kind) {
                case PathElementKind.Type:
                    return `type/${e.index.toString()}`;
                case PathElementKind.Object:
                    return "object";
                case PathElementKind.KeyOrIndex:
                    return e.key;
                default:
                    return assertNever(e);
            }
        }
        return "#/" + this.path.map(elementToString).join("/");
    }

    lookupRef(root: JSONSchema): JSONSchema {
        function lookup(
            local: any,
            path: List<PathElement>
        ): JSONSchema {
            const first = path.first();
            if (first === undefined) {
                return checkJSONSchema(local);
            }
            const rest = path.rest();
            switch (first.kind) {
                case PathElementKind.KeyOrIndex:
                    if (Array.isArray(local)) {
                        return lookup(local[parseInt(first.key, 10)], rest);
                    } else {
                        return lookup(checkStringMap(local)[first.key], rest);
                    }
                case PathElementKind.Type:
                    return panic('Cannot look up path that indexes "type"');
                case PathElementKind.Object:
                    return panic('Cannot look up path that indexes "object"');
                default:
                    return assertNever(first);
            }
        }
        return lookup(root, this.path);
    }

    equals(other: any): boolean {
        if (!(other instanceof Ref)) return false;
        if (this.address !== other.address) return false;
        if (this.path.size !== other.path.size) return false;
        return this.path.zipWith(pathElementEquals, other.path).every(x => x);
    }

    hashCode(): number {
        let acc = hash(this.address);
        this.path.forEach(pe => {
            acc = addHashCode(acc, pe.kind);
            switch (pe.kind) {
                case PathElementKind.Type:
                    acc = addHashCode(acc, pe.index);
                    break;
                case PathElementKind.KeyOrIndex:
                    acc = addHashCode(acc, hash(pe.key));
                    break;
                default:
                    break;
            }
        });
        return acc;
    }
}

class Location {
    public readonly canonicalRef: Ref;
    public readonly virtualRef: Ref;

    constructor(canonicalRef: Ref, virtualRef?: Ref) {
        this.canonicalRef = canonicalRef;
        this.virtualRef = virtualRef !== undefined ? virtualRef : canonicalRef;
    }

    updateWithID(id: any) {
        if (typeof id !== "string") return this;
        // FIXME: This is incorrect.  If the parsed ref doesn't have an address, the
        // current virtual one's must be used.  The canonizer must do this, too.
        return new Location(this.canonicalRef, Ref.parse(id).resolveAgainst(this.virtualRef));
    }

    push(...keys: string[]): Location {
        return new Location(this.canonicalRef.push(...keys), this.virtualRef.push(...keys));
    }

    pushObject(): Location {
        return new Location(this.canonicalRef.pushObject(), this.virtualRef.pushObject());
    }

    pushType(index: number): Location {
        return new Location(this.canonicalRef.pushType(index), this.virtualRef.pushType(index));
    }
}

export abstract class JSONSchemaStore {
    private _schemas: Map<string, JSONSchema> = Map();

    private add(address: string, schema: JSONSchema): void {
        assert(!this._schemas.has(address), "Cannot set a schema for an address twice");
        this._schemas = this._schemas.set(address, schema);
    }

    protected abstract fetch(_address: string): JSONSchema | undefined;

    get(address: string): JSONSchema {
        let schema = this._schemas.get(address);
        if (schema !== undefined) {
            return schema;
        }
        schema = this.fetch(address);
        if (schema === undefined) {
            return panic(`Schema at address "${address}" not available`);
        }
        this.add(address, schema);
        return schema;
    }
}

class Canonizer {
    private _map: Map<Ref, Ref> = Map();
    private _schemaAddressesAdded: Set<string> = Set();

    private addID(mapped: string, loc: Location): void {
        const ref = Ref.parse(mapped).resolveAgainst(loc.virtualRef);
        assert(ref.hasAddress, "$id must have an address");
        this._map = this._map.set(ref, loc.canonicalRef);
    }

    private addIDs(schema: any, loc: Location) {
        if (schema === null) return;
        if (Array.isArray(schema)) {
            for (let i = 0; i < schema.length; i++) {
                this.addIDs(schema[i], loc.push(i.toString()));
            }
            return;
        }
        if (typeof schema !== "object") {
            return;
        }
        const maybeID = schema["$id"];
        if (typeof maybeID === "string") {
            this.addID(maybeID, loc);
            loc = loc.updateWithID(maybeID);
        }
        for (const property of Object.getOwnPropertyNames(schema)) {
            this.addIDs(schema[property], loc.push(property));
        }
    }

    addSchema(schema: any, address: string) {
        if (this._schemaAddressesAdded.has(address)) return;

        this.addIDs(schema, new Location(Ref.root(address)));
        this._schemaAddressesAdded = this._schemaAddressesAdded.add(address);
    }

    // Returns: Canonical ref, full virtual ref
    canonize(virtualBase: Ref | undefined, ref: Ref): [Ref, Ref] {
        const fullVirtual = ref.resolveAgainst(virtualBase);
        let virtual = fullVirtual;
        let relative: List<PathElement> = List();
        for (; ;) {
            const maybeCanonical = this._map.get(virtual);
            if (maybeCanonical !== undefined) {
                return [new Ref(maybeCanonical.address, maybeCanonical.path.concat(relative)), fullVirtual];
            }
            const last = virtual.path.last();
            if (last === undefined) {
                // We've exhausted our options - it's not a mapped ref.
                return [fullVirtual, fullVirtual];
            }
            relative = relative.unshift(last);
            virtual = new Ref(virtual.address, virtual.path.pop());
        }
    }
}

function checkStringArray(arr: any): string[] {
    if (!Array.isArray(arr)) {
        return panic(`Expected a string array, but got ${arr}`);
    }
    for (const e of arr) {
        if (typeof e !== "string") {
            return panic(`Expected string, but got ${e}`);
        }
    }
    return arr;
}

function makeAttributes(schema: StringMap, loc: Location, attributes: TypeAttributes): TypeAttributes {
    const maybeDescription = schema.description;
    if (typeof maybeDescription === "string") {
        attributes = descriptionTypeAttributeKind.setInAttributes(attributes, OrderedSet([maybeDescription]));
    }
    return modifyTypeNames(attributes, maybeTypeNames => {
        const typeNames = defined(maybeTypeNames);
        if (!typeNames.areInferred) {
            return typeNames;
        }
        let title = schema.title;
        if (typeof title !== "string") {
            title = loc.canonicalRef.definitionName;
        }

        if (typeof title === "string") {
            return new TypeNames(OrderedSet([title]), OrderedSet(), false);
        } else {
            return typeNames.makeInferred();
        }
    });
}

function checkTypeList(typeOrTypes: any): OrderedSet<string> {
    if (typeof typeOrTypes === "string") {
        return OrderedSet([typeOrTypes]);
    } else if (Array.isArray(typeOrTypes)) {
        const arr: string[] = [];
        for (const t of typeOrTypes) {
            if (typeof t !== "string") {
                return panic(`element of type is not a string: ${t}`);
            }
            arr.push(t);
        }
        const set = OrderedSet(arr);
        assert(!set.isEmpty(), "JSON Schema must specify at least one type");
        return set;
    } else {
        return panic(`type is neither a string or array of strings: ${typeOrTypes}`);
    }
}

export function addTypesInSchema(
    typeBuilder: TypeGraphBuilder,
    store: JSONSchemaStore,
    references: Map<string, Ref>
): void {
    const canonizer = new Canonizer();

    function resolveVirtualRef(base: Location | undefined, virtualRef: Ref): [JSONSchema, Location] {
        const [canonical, fullVirtual] = canonizer.canonize(base !== undefined ? base.virtualRef : undefined, virtualRef);
        assert(canonical.hasAddress, "Canonical ref can't be resolved without an address");
        const schema = store.get(canonical.address);
        canonizer.addSchema(schema, canonical.address);
        return [canonical.lookupRef(schema), new Location(canonical, fullVirtual)];
    }

    let typeForCanonicalRef = Map<Ref, TypeRef>();

    function setTypeForLocation(loc: Location, t: TypeRef): void {
        const maybeRef = typeForCanonicalRef.get(loc.canonicalRef);
        if (maybeRef !== undefined) {
            assert(maybeRef === t, "Trying to set path again to different type");
        }
        typeForCanonicalRef = typeForCanonicalRef.set(loc.canonicalRef, t);
    }

    function makeClass(loc: Location, attributes: TypeAttributes, properties: StringMap, requiredArray: string[]): TypeRef {
        const required = Set(requiredArray);
        const propertiesMap = Map(properties);
        const propertyDescriptions = propertiesMap
            .map(propSchema => {
                if (typeof propSchema === "object") {
                    const desc = propSchema.description;
                    if (typeof desc === "string") {
                        return OrderedSet([desc]);
                    }
                }
                return undefined;
            })
            .filter(v => v !== undefined) as Map<string, OrderedSet<string>>;
        if (!propertyDescriptions.isEmpty()) {
            attributes = propertyDescriptionsTypeAttributeKind.setInAttributes(attributes, propertyDescriptions);
        }
        // FIXME: We're using a Map instead of an OrderedMap here because we represent
        // the JSON Schema as a JavaScript object, which has no map ordering.  Ideally
        // we would use a JSON parser that preserves order.
        const props = propertiesMap.map((propSchema, propName) => {
            const t = toType(
                checkStringMap(propSchema),
                loc.push("properties", propName),
                makeNamesTypeAttributes(pluralize.singular(propName), true)
            );
            const isOptional = !required.has(propName);
            return new ClassProperty(t, isOptional);
        });
        return typeBuilder.getUniqueClassType(attributes, true, props.toOrderedMap());
    }

    function makeMap(loc: Location, typeAttributes: TypeAttributes, additional: StringMap): TypeRef {
        loc = loc.push("additionalProperties");
        const valuesType = toType(additional, loc, singularizeTypeNames(typeAttributes));
        return typeBuilder.getMapType(valuesType);
    }

    function fromTypeName(schema: StringMap, loc: Location, typeAttributes: TypeAttributes, typeName: string): TypeRef {
        // FIXME: We seem to be overzealous in making attributes.  We get them from
        // our caller, then we make them again here, and then we make them again
        // in `makeClass`, potentially in other places, too.
        typeAttributes = makeAttributes(schema, loc, makeTypeAttributesInferred(typeAttributes));
        switch (typeName) {
            case "object":
                let required: string[];
                if (schema.required === undefined) {
                    required = [];
                } else {
                    required = checkStringArray(schema.required);
                }

                // FIXME: Don't put type attributes in the union AND its members.
                const unionType = typeBuilder.getUniqueUnionType(typeAttributes, undefined);
                setTypeForLocation(loc, unionType);

                const typesInUnion: TypeRef[] = [];

                if (schema.properties !== undefined) {
                    typesInUnion.push(makeClass(loc, typeAttributes, checkStringMap(schema.properties), required));
                }

                if (schema.additionalProperties !== undefined) {
                    const additional = schema.additionalProperties;
                    // FIXME: We don't treat `additional === true`, which is also the default,
                    // not according to spec.  It should be translated into a map type to any,
                    // though that's not what the intention usually is.  Ideally, we'd find a
                    // way to store additional attributes on regular classes.
                    if (additional === false) {
                        if (schema.properties === undefined) {
                            typesInUnion.push(makeClass(loc, typeAttributes, {}, required));
                        }
                    } else if (typeof additional === "object") {
                        typesInUnion.push(makeMap(loc, typeAttributes, checkStringMap(additional)));
                    }
                }

                if (typesInUnion.length === 0) {
                    typesInUnion.push(typeBuilder.getMapType(typeBuilder.getPrimitiveType("any")));
                }
                typeBuilder.setSetOperationMembers(unionType, OrderedSet(typesInUnion));
                return unionType;
            case "array":
                if (schema.items !== undefined) {
                    loc = loc.push("items");
                    return typeBuilder.getArrayType(
                        toType(checkStringMap(schema.items), loc, singularizeTypeNames(typeAttributes))
                    );
                }
                return typeBuilder.getArrayType(typeBuilder.getPrimitiveType("any"));
            case "boolean":
                return typeBuilder.getPrimitiveType("bool");
            case "string":
                if (schema.format !== undefined) {
                    switch (schema.format) {
                        case "date":
                            return typeBuilder.getPrimitiveType("date");
                        case "time":
                            return typeBuilder.getPrimitiveType("time");
                        case "date-time":
                            return typeBuilder.getPrimitiveType("date-time");
                        default:
                            // FIXME: Output a warning here instead to indicate that
                            // the format is uninterpreted.
                            return typeBuilder.getStringType(typeAttributes, undefined);
                    }
                }
                return typeBuilder.getStringType(typeAttributes, undefined);
            case "null":
                return typeBuilder.getPrimitiveType("null");
            case "integer":
                return typeBuilder.getPrimitiveType("integer");
            case "number":
                return typeBuilder.getPrimitiveType("double");
            default:
                return panic(`not a type name: ${typeName}`);
        }
    }

    function convertToType(schema: StringMap, loc: Location, typeAttributes: TypeAttributes): TypeRef {
        typeAttributes = makeAttributes(schema, loc, typeAttributes);

        function makeTypesFromCases(
            cases: any,
            kind: string
        ): TypeRef[] {
            if (!Array.isArray(cases)) {
                return panic(`Cases are not an array: ${cases}`);
            }
            // FIXME: This cast shouldn't be necessary, but TypeScript forces our hand.
            return cases.map((t, index) =>
                toType(checkStringMap(t), loc.push(kind, index.toString()), makeTypeAttributesInferred(typeAttributes))
            );
        }

        function convertOneOrAnyOf(cases: any, kind: string): TypeRef {
            const unionType = typeBuilder.getUniqueUnionType(makeTypeAttributesInferred(typeAttributes), undefined);
            typeBuilder.setSetOperationMembers(unionType, OrderedSet(makeTypesFromCases(cases, kind)));
            return unionType;
        }

        if (schema.$ref !== undefined) {
            const virtualRef = Ref.parse(schema.$ref);
            const [target, newLoc] = resolveVirtualRef(loc, virtualRef);
            const attributes = modifyTypeNames(typeAttributes, tn => {
                if (!defined(tn).areInferred) return tn;
                return new TypeNames(OrderedSet([newLoc.canonicalRef.name]), OrderedSet(), true);
            });
            return toType(target, newLoc, attributes);
        } else if (Array.isArray(schema.enum)) {
            let cases = schema.enum as any[];
            const haveNull = cases.indexOf(null) >= 0;
            cases = cases.filter(c => c !== null);
            if (cases.filter(c => typeof c !== "string").length > 0) {
                return panic(`Non-string enum cases are not supported, at ${loc.canonicalRef.toString()}`);
            }
            const tref = typeBuilder.getEnumType(typeAttributes, OrderedSet(checkStringArray(cases)));
            if (haveNull) {
                return typeBuilder.getUnionType(
                    typeAttributes,
                    OrderedSet([tref, typeBuilder.getPrimitiveType("null")])
                );
            } else {
                return tref;
            }
        }

        let jsonTypes: OrderedSet<string> | undefined = undefined;
        if (schema.type !== undefined) {
            jsonTypes = checkTypeList(schema.type);
        } else if (schema.properties !== undefined || schema.additionalProperties !== undefined) {
            jsonTypes = OrderedSet(["object"]);
        }

        const intersectionType = typeBuilder.getUniqueIntersectionType(typeAttributes, undefined);
        setTypeForLocation(loc, intersectionType);
        const types: TypeRef[] = [];
        if (schema.allOf !== undefined) {
            types.push(...makeTypesFromCases(schema.allOf, "allOf"));
        }
        if (schema.oneOf) {
            types.push(convertOneOrAnyOf(schema.oneOf, "oneOf"));
        }
        if (schema.anyOf) {
            types.push(convertOneOrAnyOf(schema.anyOf, "anyOf"));
        }
        if (jsonTypes !== undefined) {
            if (jsonTypes.size === 1) {
                types.push(fromTypeName(schema, loc.pushObject(), typeAttributes, defined(jsonTypes.first())));
            } else {
                const unionType = typeBuilder.getUniqueUnionType(typeAttributes, undefined);
                const unionTypes = jsonTypes
                    .toList()
                    .map((n, index) => fromTypeName(schema, loc.pushType(index), typeAttributes, n));
                typeBuilder.setSetOperationMembers(unionType, OrderedSet(unionTypes));
                types.push(unionType);
            }
        }
        typeBuilder.setSetOperationMembers(intersectionType, OrderedSet(types));
        return intersectionType;
    }

    function toType(schema: JSONSchema, loc: Location, typeAttributes: TypeAttributes): TypeRef {
        const maybeType = typeForCanonicalRef.get(loc.canonicalRef);
        if (maybeType !== undefined) {
            return maybeType;
        }

        let result: TypeRef;
        if (typeof schema === "boolean") {
            // FIXME: Empty union.  We'd have to check that it's supported everywhere,
            // in particular in union flattening.
            assert(schema === true, 'Schema "false" is not supported');
            result = typeBuilder.getPrimitiveType("any");
        } else {
            loc = loc.updateWithID(schema["$id"]);
            result = convertToType(schema, loc, typeAttributes);
        }

        setTypeForLocation(loc, result);
        return result;
    }

    references.forEach((topLevelRef, topLevelName) => {
        const [target, loc] = resolveVirtualRef(undefined, topLevelRef);
        const t = toType(target, loc, makeNamesTypeAttributes(topLevelName, false));
        typeBuilder.addTopLevel(topLevelName, t);
    });
}

export function definitionRefsInSchema(rootJson: any, rootAddress: string): Map<string, Ref> {
    if (typeof rootJson !== "object") return Map();
    const definitions = rootJson.definitions;
    if (typeof definitions !== "object") return Map();
    return Map(
        Object.keys(definitions).map(name => {
            return [name, Ref.root(rootAddress).push("definitions", name)] as [string, Ref];
        })
    );
}
