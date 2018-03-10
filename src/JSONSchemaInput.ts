"use strict";

import { List, OrderedSet, Map, fromJS, Set } from "immutable";
import * as pluralize from "pluralize";

import { ClassProperty } from "./Type";
import { panic, assertNever, StringMap, checkStringMap, assert, defined } from "./Support";
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
    Root,
    Definition,
    OneOf,
    AnyOf,
    AllOf,
    Property,
    AdditionalProperty,
    Items,
    Type,
    Object
}

export type PathElement =
    | { kind: PathElementKind.Root }
    | { kind: PathElementKind.Definition; name: string }
    | { kind: PathElementKind.OneOf; index: number }
    | { kind: PathElementKind.AnyOf; index: number }
    | { kind: PathElementKind.AllOf; index: number }
    | { kind: PathElementKind.Property; name: string }
    | { kind: PathElementKind.AdditionalProperty }
    | { kind: PathElementKind.Items }
    | { kind: PathElementKind.Type; index: number }
    | { kind: PathElementKind.Object };

export class Ref {
    constructor(public readonly path: List<PathElement>) {}

    push(pe: PathElement): Ref {
        return new Ref(this.path.push(pe));
    }

    get definitionName(): string | undefined {
        const last = this.path.last();
        if (last !== undefined && last.kind === PathElementKind.Definition) {
            return last.name;
        }
        return undefined;
    }

    toString(): string {
        function elementToString(e: PathElement): string {
            switch (e.kind) {
                case PathElementKind.Root:
                    return "#";
                case PathElementKind.Definition:
                    return `definitions/${e.name}`;
                case PathElementKind.OneOf:
                    return `oneOf/${e.index.toString()}`;
                case PathElementKind.AnyOf:
                    return `anyOf/${e.index.toString()}`;
                case PathElementKind.AllOf:
                    return `allOf/${e.index.toString()}`;
                case PathElementKind.Property:
                    return `properties/${e.name}`;
                case PathElementKind.AdditionalProperty:
                    return "additionalProperties";
                case PathElementKind.Items:
                    return "items";
                case PathElementKind.Type:
                    return `type/${e.index.toString()}`;
                case PathElementKind.Object:
                    return "object";
                default:
                    return assertNever(e);
            }
        }
        return this.path.map(elementToString).join("/");
    }

    lookupRef(root: StringMap, localSchema: StringMap, localRef: Ref): [StringMap, Ref] {
        function lookup(local: StringMap, localPath: List<PathElement>, path: List<PathElement>): [StringMap, Ref] {
            const first = path.first();
            if (first === undefined) {
                return [local, new Ref(localPath)];
            }
            const rest = path.rest();
            if (first.kind === PathElementKind.Root) {
                return lookup(root, List([first]), path.rest());
            }
            localPath = localPath.push(first);
            switch (first.kind) {
                case PathElementKind.Definition:
                    return lookup(lookupDefinition(local, first.name), localPath, rest);
                case PathElementKind.OneOf:
                    return lookup(indexArray(local.oneOf, first.index), localPath, rest);
                case PathElementKind.AnyOf:
                    return lookup(indexArray(local.anyOf, first.index), localPath, rest);
                case PathElementKind.AllOf:
                    return lookup(indexArray(local.allOf, first.index), localPath, rest);
                case PathElementKind.Property:
                    return lookup(lookupProperty(local, first.name), localPath, rest);
                case PathElementKind.AdditionalProperty:
                    return lookup(checkStringMap(local.additionalProperties), localPath, rest);
                case PathElementKind.Items:
                    return lookup(checkStringMap(local.items), localPath, rest);
                case PathElementKind.Type:
                    return panic('Cannot look up path that indexes "type"');
                case PathElementKind.Object:
                    return panic('Cannot look up path that indexes "object"');
                default:
                    return assertNever(first);
            }
        }
        return lookup(localSchema, localRef.path, this.path);
    }

    get immutable(): List<any> {
        return this.path.map(pe => fromJS(pe));
    }
}

export const rootRef: Ref = new Ref(List([{ kind: PathElementKind.Root } as PathElement]));

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

function parseRef(ref: any): [Ref, string] {
    if (typeof ref !== "string") {
        return panic("$ref must be a string");
    }

    let refName = "Something";

    const parts = ref.split("/");
    const elements: PathElement[] = [];
    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === "#") {
            elements.push({ kind: PathElementKind.Root });
            refName = "Root";
        } else if (parts[i] === "items") {
            elements.push({ kind: PathElementKind.Items });
            refName = "ArrayItems";
        } else if (parts[i] === "additionalProperties") {
            elements.push({ kind: PathElementKind.AdditionalProperty });
            refName = "AdditionalProperties";
        } else if (parts[i] === "definitions" && i + 1 < parts.length) {
            refName = parts[i + 1];
            elements.push({ kind: PathElementKind.Definition, name: refName });
            i += 1;
        } else if (parts[i] === "properties" && i + 1 < parts.length) {
            refName = parts[i + 1];
            elements.push({ kind: PathElementKind.Property, name: refName });
            i += 1;
        } else if (parts[i] === "oneOf" && i + 1 < parts.length) {
            const index = Math.floor(parseInt(parts[i + 1], 10));
            if (isNaN(index)) {
                return panic(`Could not parse oneOf index ${parts[i + 1]}`);
            }
            elements.push({ kind: PathElementKind.OneOf, index });
            i += 1;
            refName = "OneOf";
        } else if (parts[i] === "anyOf" && i + 1 < parts.length) {
            const index = Math.floor(parseInt(parts[i + 1], 10));
            if (isNaN(index)) {
                return panic(`Could not parse anyOf index ${parts[i + 1]}`);
            }
            elements.push({ kind: PathElementKind.AnyOf, index });
            i += 1;
            refName = "AnyOf";
        } else if (parts[i] === "allOf" && i + 1 < parts.length) {
            const index = Math.floor(parseInt(parts[i + 1], 10));
            if (isNaN(index)) {
                return panic(`Could not parse allOf index ${parts[i + 1]}`);
            }
            elements.push({ kind: PathElementKind.AllOf, index });
            i += 1;
            refName = "AllOf";
        } else {
            panic(`Could not parse JSON schema reference ${ref}`);
        }
    }
    return [new Ref(List(elements)), refName];
}

function lookupDefinition(schema: StringMap, name: string): StringMap {
    const definitions = checkStringMap(schema.definitions);
    return checkStringMap(definitions[name]);
}

function lookupProperty(schema: StringMap, name: string): StringMap {
    const properties = checkStringMap(schema.properties);
    return checkStringMap(properties[name]);
}

function indexArray(cases: any, index: number): StringMap {
    if (!Array.isArray(cases)) {
        return panic("oneOf or anyOf value must be an array");
    }
    return checkStringMap(cases[index]);
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
    let typeForPath = Map<List<any>, TypeRef>();

    function setTypeForPath(path: Ref, t: TypeRef): void {
        const immutablePath = path.immutable;
        const maybeRef = typeForPath.get(immutablePath);
        if (maybeRef !== undefined) {
            assert(maybeRef === t, "Trying to set path again to different type");
        }
        typeForPath = typeForPath.set(immutablePath, t);
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
                path.push({ kind: PathElementKind.Property, name: propName }),
                makeNamesTypeAttributes(pluralize.singular(propName), true)
            );
            const isOptional = !required.has(propName);
            return new ClassProperty(t, isOptional);
        });
        return typeBuilder.getUniqueClassType(attributes, true, props.toOrderedMap());
    }

    function makeMap(path: Ref, typeAttributes: TypeAttributes, additional: StringMap): TypeRef {
        path = path.push({ kind: PathElementKind.AdditionalProperty });
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
                    path = path.push({ kind: PathElementKind.Items });
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
            kind: PathElementKind.OneOf | PathElementKind.AnyOf | PathElementKind.AllOf
        ): TypeRef[] {
            if (!Array.isArray(cases)) {
                return panic(`Cases are not an array: ${cases}`);
            }
            // FIXME: This cast shouldn't be necessary, but TypeScript forces our hand.
            return cases.map((t, index) =>
                toType(checkStringMap(t), path.push({ kind, index } as any), makeTypeAttributesInferred(typeAttributes))
            );
        }

        function convertOneOrAnyOf(cases: any, kind: PathElementKind.OneOf | PathElementKind.AnyOf): TypeRef {
            const unionType = typeBuilder.getUniqueUnionType(makeTypeAttributesInferred(typeAttributes), undefined);
            typeBuilder.setSetOperationMembers(unionType, OrderedSet(makeTypesFromCases(cases, kind)));
            return unionType;
        }

        if (schema.$ref !== undefined) {
            const [ref, refName] = parseRef(schema.$ref);
            const [target, targetPath] = ref.lookupRef(root, schema, path);
            const attributes = modifyTypeNames(typeAttributes, tn => {
                if (!defined(tn).areInferred) return tn;
                return new TypeNames(OrderedSet([refName]), OrderedSet(), true);
            });
            return toType(target, targetPath, attributes);
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
            types.push(...makeTypesFromCases(schema.allOf, PathElementKind.AllOf));
        }
        if (schema.oneOf) {
            types.push(convertOneOrAnyOf(schema.oneOf, PathElementKind.OneOf));
        }
        if (schema.anyOf) {
            types.push(convertOneOrAnyOf(schema.anyOf, PathElementKind.AnyOf));
        }
        if (jsonTypes !== undefined) {
            if (jsonTypes.size === 1) {
                types.push(
                    fromTypeName(
                        schema,
                        path.push({ kind: PathElementKind.Object }),
                        typeAttributes,
                        defined(jsonTypes.first())
                    )
                );
            } else {
                const unionType = typeBuilder.getUniqueUnionType(typeAttributes, undefined);
                const unionTypes = jsonTypes
                    .toList()
                    .map((n, index) =>
                        fromTypeName(schema, path.push({ kind: PathElementKind.Type, index }), typeAttributes, n)
                    );
                typeBuilder.setSetOperationMembers(unionType, OrderedSet(unionTypes));
                types.push(unionType);
            }
        }
        typeBuilder.setSetOperationMembers(intersectionType, OrderedSet(types));
        return intersectionType;
    }

    function toType(schema: StringMap, path: Ref, typeAttributes: TypeAttributes): TypeRef {
        // FIXME: This fromJS thing is ugly and inefficient.  Schemas aren't
        // big, so it most likely doesn't matter.
        const immutablePath = path.immutable;
        const maybeType = typeForPath.get(immutablePath);
        if (maybeType !== undefined) {
            return maybeType;
        }
        const result = convertToType(schema, path, typeAttributes);
        setTypeForPath(path, result);
        return result;
    }

    references.forEach((topLevelRef, topLevelName) => {
        const [target, targetPath] = topLevelRef.lookupRef(root, root, rootRef);
        const t = toType(target, targetPath, makeNamesTypeAttributes(topLevelName, false));
        typeBuilder.addTopLevel(topLevelName, t);
    });
}

export function definitionRefsInSchema(rootJson: any): Map<string, Ref> {
    if (typeof rootJson !== "object") return Map();
    const definitions = rootJson.definitions;
    if (typeof definitions !== "object") return Map();
    return Map(
        Object.keys(definitions).map(name => {
            return [name, rootRef.push({ kind: PathElementKind.Definition, name } as PathElement)] as [string, Ref];
        })
    );
}
