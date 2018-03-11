"use strict";

import { List, OrderedSet, Map, Set, hash } from "immutable";
import * as pluralize from "pluralize";

import { ClassProperty } from "./Type";
import { panic, assertNever, StringMap, checkStringMap, assert, defined, addHashCode, hashCodeInit } from "./Support";
import { TypeGraphBuilder, TypeRef } from "./TypeBuilder";
import { TypeNames } from "./TypeNames";
import { makeNamesTypeAttributes, modifyTypeNames, singularizeTypeNames } from "./TypeNames";
import {
    TypeAttributes,
    descriptionTypeAttributeKind,
    propertyDescriptionsTypeAttributeKind,
    makeTypeAttributesInferred
} from "./TypeAttributes";

enum PathElementKind {
    KeyOrIndex,
    Type,
    Object
}

type PathElement =
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

const numberRegexp = new RegExp("^[0-9]+$");

export class Ref {
    static readonly root: Ref = new Ref(List());

    static parse(ref: any): Ref {
        if (typeof ref !== "string") {
            return panic("$ref must be a string");
        }
        if (!ref.startsWith("#/")) {
            return panic('$ref must start with "#/"');
        }
        ref = ref.substr(2);
        if (ref === "") return Ref.root;

        const elements: PathElement[] = [];
        const parts = ref.split("/");
        for (let i = 0; i < parts.length; i++) {
            elements.push({ kind: PathElementKind.KeyOrIndex, key: parts[i] });
        }
        return new Ref(List(elements));
    }

    private constructor(private readonly _path: List<PathElement>) { }

    private pushElement(pe: PathElement): Ref {
        return new Ref(this._path.push(pe));
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

    get name(): string {
        let path = this._path;

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
        const pe = this._path.get(-2);
        if (pe === undefined) return undefined;
        if (keyOrIndex(pe) === "definitions") return keyOrIndex(defined(this._path.last()));
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
        return "#/" + this._path.map(elementToString).join("/");
    }

    lookupRef(root: StringMap): StringMap {
        function lookup(
            local: StringMap | any[],
            path: List<PathElement>
        ): StringMap {
            const first = path.first();
            if (first === undefined) {
                return checkStringMap(local);
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
        return lookup(root, this._path);
    }

    equals(other: any): boolean {
        if (!(other instanceof Ref)) return false;
        if (this._path.size !== other._path.size) return false;
        return this._path.zipWith(pathElementEquals, other._path).every(x => x);
    }

    hashCode(): number {
        let acc = hashCodeInit;
        this._path.forEach(pe => {
            acc = addHashCode(acc, pe.kind);
            switch (pe.kind) {
                case PathElementKind.Type:
                    acc = addHashCode(acc, pe.index);
                    break;
                case PathElementKind.KeyOrIndex:
                    acc = addHashCode(acc, hash(pe.key));
                    break;
            }
        });
        return acc;
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

function makeAttributes(schema: StringMap, path: Ref, attributes: TypeAttributes): TypeAttributes {
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
            title = path.definitionName;
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

export function addTypesInSchema(typeBuilder: TypeGraphBuilder, rootJson: any, references: Map<string, Ref>): void {
    const root = checkStringMap(rootJson);
    let typeForPath = Map<Ref, TypeRef>();

    function setTypeForPath(path: Ref, t: TypeRef): void {
        const maybeRef = typeForPath.get(path);
        if (maybeRef !== undefined) {
            assert(maybeRef === t, "Trying to set path again to different type");
        }
        typeForPath = typeForPath.set(path, t);
    }

    function makeClass(path: Ref, attributes: TypeAttributes, properties: StringMap, requiredArray: string[]): TypeRef {
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
                path.push("properties", propName),
                makeNamesTypeAttributes(pluralize.singular(propName), true)
            );
            const isOptional = !required.has(propName);
            return new ClassProperty(t, isOptional);
        });
        return typeBuilder.getUniqueClassType(attributes, true, props.toOrderedMap());
    }

    function makeMap(path: Ref, typeAttributes: TypeAttributes, additional: StringMap): TypeRef {
        path = path.push("additionalProperties");
        const valuesType = toType(additional, path, singularizeTypeNames(typeAttributes));
        return typeBuilder.getMapType(valuesType);
    }

    function fromTypeName(schema: StringMap, path: Ref, typeAttributes: TypeAttributes, typeName: string): TypeRef {
        // FIXME: We seem to be overzealous in making attributes.  We get them from
        // our caller, then we make them again here, and then we make them again
        // in `makeClass`, potentially in other places, too.
        typeAttributes = makeAttributes(schema, path, makeTypeAttributesInferred(typeAttributes));
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
                setTypeForPath(path, unionType);

                const typesInUnion: TypeRef[] = [];

                if (schema.properties !== undefined) {
                    typesInUnion.push(makeClass(path, typeAttributes, checkStringMap(schema.properties), required));
                }

                if (schema.additionalProperties !== undefined) {
                    const additional = schema.additionalProperties;
                    // FIXME: We don't treat `additional === true`, which is also the default,
                    // not according to spec.  It should be translated into a map type to any,
                    // though that's not what the intention usually is.  Ideally, we'd find a
                    // way to store additional attributes on regular classes.
                    if (additional === false) {
                        if (schema.properties === undefined) {
                            typesInUnion.push(makeClass(path, typeAttributes, {}, required));
                        }
                    } else if (typeof additional === "object") {
                        typesInUnion.push(makeMap(path, typeAttributes, checkStringMap(additional)));
                    }
                }

                if (typesInUnion.length === 0) {
                    typesInUnion.push(typeBuilder.getMapType(typeBuilder.getPrimitiveType("any")));
                }
                typeBuilder.setSetOperationMembers(unionType, OrderedSet(typesInUnion));
                return unionType;
            case "array":
                if (schema.items !== undefined) {
                    path = path.push("items");
                    return typeBuilder.getArrayType(
                        toType(checkStringMap(schema.items), path, singularizeTypeNames(typeAttributes))
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

    function convertToType(schema: StringMap, path: Ref, typeAttributes: TypeAttributes): TypeRef {
        typeAttributes = makeAttributes(schema, path, typeAttributes);

        function makeTypesFromCases(
            cases: any,
            kind: string
        ): TypeRef[] {
            if (!Array.isArray(cases)) {
                return panic(`Cases are not an array: ${cases}`);
            }
            // FIXME: This cast shouldn't be necessary, but TypeScript forces our hand.
            return cases.map((t, index) =>
                toType(checkStringMap(t), path.push(kind, index.toString()), makeTypeAttributesInferred(typeAttributes))
            );
        }

        function convertOneOrAnyOf(cases: any, kind: string): TypeRef {
            const unionType = typeBuilder.getUniqueUnionType(makeTypeAttributesInferred(typeAttributes), undefined);
            typeBuilder.setSetOperationMembers(unionType, OrderedSet(makeTypesFromCases(cases, kind)));
            return unionType;
        }

        if (schema.$ref !== undefined) {
            const ref = Ref.parse(schema.$ref);
            const target = ref.lookupRef(root);
            const attributes = modifyTypeNames(typeAttributes, tn => {
                if (!defined(tn).areInferred) return tn;
                return new TypeNames(OrderedSet([ref.name]), OrderedSet(), true);
            });
            return toType(target, ref, attributes);
        } else if (Array.isArray(schema.enum)) {
            let cases = schema.enum as any[];
            const haveNull = cases.indexOf(null) >= 0;
            cases = cases.filter(c => c !== null);
            if (cases.filter(c => typeof c !== "string").length > 0) {
                return panic(`Non-string enum cases are not supported, at ${path.toString()}`);
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
        setTypeForPath(path, intersectionType);
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
                types.push(fromTypeName(schema, path.pushObject(), typeAttributes, defined(jsonTypes.first())));
            } else {
                const unionType = typeBuilder.getUniqueUnionType(typeAttributes, undefined);
                const unionTypes = jsonTypes
                    .toList()
                    .map((n, index) => fromTypeName(schema, path.pushType(index), typeAttributes, n));
                typeBuilder.setSetOperationMembers(unionType, OrderedSet(unionTypes));
                types.push(unionType);
            }
        }
        typeBuilder.setSetOperationMembers(intersectionType, OrderedSet(types));
        return intersectionType;
    }

    function toType(schema: StringMap, path: Ref, typeAttributes: TypeAttributes): TypeRef {
        const maybeType = typeForPath.get(path);
        if (maybeType !== undefined) {
            return maybeType;
        }
        const result = convertToType(schema, path, typeAttributes);
        setTypeForPath(path, result);
        return result;
    }

    references.forEach((topLevelRef, topLevelName) => {
        const target = topLevelRef.lookupRef(root);
        const t = toType(target, topLevelRef, makeNamesTypeAttributes(topLevelName, false));
        typeBuilder.addTopLevel(topLevelName, t);
    });
}

export function definitionRefsInSchema(rootJson: any): Map<string, Ref> {
    if (typeof rootJson !== "object") return Map();
    const definitions = rootJson.definitions;
    if (typeof definitions !== "object") return Map();
    return Map(
        Object.keys(definitions).map(name => {
            return [name, Ref.root.push("definitions", name)] as [string, Ref];
        })
    );
}
