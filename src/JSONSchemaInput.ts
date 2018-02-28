"use strict";

import { List, OrderedSet, Map, fromJS, Set } from "immutable";
import * as pluralize from "pluralize";

import { ClassProperty } from "./Type";
import { panic, assertNever, StringMap, checkStringMap, assert, defined } from "./Support";
import { TypeGraphBuilder, TypeRef } from "./TypeBuilder";
import { TypeNames } from "./TypeNames";
import { makeNamesTypeAttributes, modifyTypeNames, singularizeTypeNames } from "./TypeNames";
import { TypeAttributes, descriptionTypeAttributeKind, propertyDescriptionsTypeAttributeKind } from "./TypeAttributes";

export enum PathElementKind {
    Root,
    Definition,
    OneOf,
    AnyOf,
    AllOf,
    Property,
    AdditionalProperty,
    Items,
    Type
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
    | { kind: PathElementKind.Type; index: number };

export type Ref = List<PathElement>;

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
            const index = Math.floor(parseInt(parts[i + 1]));
            if (isNaN(index)) {
                return panic(`Could not parse oneOf index ${parts[i + 1]}`);
            }
            elements.push({ kind: PathElementKind.OneOf, index });
            i += 1;
            refName = "OneOf";
        } else if (parts[i] === "anyOf" && i + 1 < parts.length) {
            const index = Math.floor(parseInt(parts[i + 1]));
            if (isNaN(index)) {
                return panic(`Could not parse anyOf index ${parts[i + 1]}`);
            }
            elements.push({ kind: PathElementKind.AnyOf, index });
            i += 1;
            refName = "AnyOf";
        } else if (parts[i] === "allOf" && i + 1 < parts.length) {
            const index = Math.floor(parseInt(parts[i + 1]));
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
    return [List(elements), refName];
}

function refToString(ref: Ref): string {
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
            default:
                return assertNever(e);
        }
    }
    return ref.map(elementToString).join("/");
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
            const last = path.last();
            if (last !== undefined && last.kind === PathElementKind.Definition) {
                title = last.name;
            }
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

function makeImmutablePath(path: Ref): List<any> {
    return path.map(pe => fromJS(pe));
}

export const rootRef: Ref = List([{ kind: PathElementKind.Root } as PathElement]);

export function addTypesInSchema(typeBuilder: TypeGraphBuilder, rootJson: any, references: Map<string, Ref>): void {
    const root = checkStringMap(rootJson);
    let typeForPath = Map<List<any>, TypeRef>();

    function setTypeForPath(path: Ref, t: TypeRef): void {
        const immutablePath = makeImmutablePath(path);
        const maybeRef = typeForPath.get(immutablePath);
        if (maybeRef !== undefined) {
            assert(maybeRef === t, "Trying to set path again to different type");
        }
        typeForPath = typeForPath.set(immutablePath, t);
    }

    function lookupRef(local: StringMap, localPath: Ref, ref: Ref): [StringMap, Ref] {
        const first = ref.first();
        if (first === undefined) {
            return [local, localPath];
        }
        const rest = ref.rest();
        if (first.kind === PathElementKind.Root) {
            return lookupRef(root, List([first]), ref.rest());
        }
        localPath = localPath.push(first);
        switch (first.kind) {
            case PathElementKind.Definition:
                return lookupRef(lookupDefinition(local, first.name), localPath, rest);
            case PathElementKind.OneOf:
                return lookupRef(indexArray(local.oneOf, first.index), localPath, rest);
            case PathElementKind.AnyOf:
                return lookupRef(indexArray(local.anyOf, first.index), localPath, rest);
            case PathElementKind.AllOf:
                return lookupRef(indexArray(local.allOf, first.index), localPath, rest);
            case PathElementKind.Property:
                return lookupRef(lookupProperty(local, first.name), localPath, rest);
            case PathElementKind.AdditionalProperty:
                return lookupRef(checkStringMap(local.additionalProperties), localPath, rest);
            case PathElementKind.Items:
                return lookupRef(checkStringMap(local.items), localPath, rest);
            case PathElementKind.Type:
                return panic('Cannot look up path that indexes "type"');
            default:
                return assertNever(first);
        }
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
        typeAttributes = makeAttributes(
            schema,
            path,
            modifyTypeNames(typeAttributes, tn => defined(tn).makeInferred())
        );
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

        function convertOneOrAnyOf(cases: any, kind: PathElementKind.OneOf | PathElementKind.AnyOf): TypeRef {
            if (!Array.isArray(cases)) {
                return panic(`oneOf or anyOf is not an array: ${cases}`);
            }
            const unionType = typeBuilder.getUniqueUnionType(typeAttributes, undefined);
            setTypeForPath(path, unionType);
            // FIXME: This cast shouldn't be necessary, but TypeScript forces our hand.
            const types = cases.map((t, index) =>
                toType(checkStringMap(t), path.push({ kind, index } as any), typeAttributes)
            );
            typeBuilder.setSetOperationMembers(unionType, OrderedSet(types));
            return unionType;
        }

        function convertAllOf(cases: any): TypeRef {
            if (!Array.isArray(cases)) {
                return panic(`allOf is not an array at ${refToString(path)}: ${cases}`);
            }
            const intersectionType = typeBuilder.getUniqueIntersectionType(typeAttributes, undefined);
            setTypeForPath(path, intersectionType);
            // FIXME: This cast shouldn't be necessary, but TypeScript forces our hand.
            const types = cases.map((t, index) =>
                toType(checkStringMap(t), path.push({ kind: PathElementKind.AllOf, index } as any), typeAttributes)
            );
            typeBuilder.setSetOperationMembers(intersectionType, OrderedSet(types));
            return intersectionType;
        }

        if (schema.$ref !== undefined) {
            const [ref, refName] = parseRef(schema.$ref);
            const [target, targetPath] = lookupRef(schema, path, ref);
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
                return panic(`Non-string enum cases are not supported, at ${refToString(path)}`);
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
        } else if (schema.type !== undefined) {
            const jsonTypes = checkTypeList(schema.type);
            if (jsonTypes.size === 1) {
                return fromTypeName(schema, path, typeAttributes, defined(jsonTypes.first()));
            } else {
                const unionType = typeBuilder.getUniqueUnionType(typeAttributes, undefined);
                setTypeForPath(path, unionType);
                const types = jsonTypes
                    .toList()
                    .map((n, index) =>
                        fromTypeName(schema, path.push({ kind: PathElementKind.Type, index }), typeAttributes, n)
                    );
                typeBuilder.setSetOperationMembers(unionType, OrderedSet(types));
                return unionType;
            }
        } else if (schema.oneOf !== undefined) {
            return convertOneOrAnyOf(schema.oneOf, PathElementKind.OneOf);
        } else if (schema.anyOf !== undefined) {
            return convertOneOrAnyOf(schema.anyOf, PathElementKind.AnyOf);
        } else if (schema.allOf !== undefined) {
            return convertAllOf(schema.allOf);
        } else {
            return typeBuilder.getPrimitiveType("any");
        }
    }

    function toType(schema: StringMap, path: Ref, typeAttributes: TypeAttributes): TypeRef {
        // FIXME: This fromJS thing is ugly and inefficient.  Schemas aren't
        // big, so it most likely doesn't matter.
        const immutablePath = makeImmutablePath(path);
        const maybeType = typeForPath.get(immutablePath);
        if (maybeType !== undefined) {
            return maybeType;
        }
        const result = convertToType(schema, path, typeAttributes);
        setTypeForPath(path, result);
        return result;
    }

    references.forEach((topLevelRef, topLevelName) => {
        const [target, targetPath] = lookupRef(root, rootRef, topLevelRef);
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
