"use strict";

import { List, OrderedSet, Map, fromJS, Set } from "immutable";
import * as pluralize from "pluralize";

import { MapType, assertIsClass } from "./Type";
import { panic, assertNever, StringMap, checkStringMap, assert, defined } from "./Support";
import { TypeGraphBuilder, TypeRef, getHopefullyFinishedType } from "./TypeBuilder";
import { TypeNames, makeTypeNames } from "./TypeNames";
import { unifyTypes } from "./UnifyClasses";

enum PathElementKind {
    Root,
    Definition,
    OneOf,
    AnyOf,
    Property,
    AdditionalProperty,
    Items
}

type PathElement =
    | { kind: PathElementKind.Root }
    | { kind: PathElementKind.Definition; name: string }
    | { kind: PathElementKind.OneOf; index: number }
    | { kind: PathElementKind.AnyOf; index: number }
    | { kind: PathElementKind.Property; name: string }
    | { kind: PathElementKind.AdditionalProperty }
    | { kind: PathElementKind.Items };

type Ref = List<PathElement>;

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
        } else if (parts[i] === "definitions" && i + 1 < parts.length) {
            refName = parts[i + 1];
            elements.push({ kind: PathElementKind.Definition, name: refName });
            i += 1;
        } else {
            panic(`Could not parse JSON schema reference ${ref}`);
        }
    }
    return [List(elements), refName];
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

function getName(schema: StringMap, typeNames: TypeNames): TypeNames {
    if (!typeNames.areInferred) {
        return typeNames;
    }
    const title = schema.title;
    if (typeof title === "string") {
        return makeTypeNames(title, false);
    } else {
        return typeNames.makeInferred();
    }
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

export function schemaToType(typeBuilder: TypeGraphBuilder, topLevelName: string, rootJson: any): TypeRef {
    const root = checkStringMap(rootJson);
    let typeForPath = Map<List<any>, TypeRef>();

    function setTypeForPath(path: Ref, t: TypeRef): void {
        typeForPath = typeForPath.set(makeImmutablePath(path), t);
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
            case PathElementKind.Property:
                return lookupRef(lookupProperty(local, first.name), localPath, rest);
            case PathElementKind.AdditionalProperty:
                return lookupRef(checkStringMap(local.additionalProperties), localPath, rest);
            case PathElementKind.Items:
                return lookupRef(checkStringMap(local.items), localPath, rest);
            default:
                return assertNever(first);
        }
    }

    function makeClass(
        schema: StringMap,
        path: Ref,
        typeNames: TypeNames,
        properties: StringMap,
        requiredArray: string[]
    ): TypeRef {
        const required = Set(requiredArray);
        const result = typeBuilder.getUniqueClassType(getName(schema, typeNames));
        const c = assertIsClass(getHopefullyFinishedType(typeBuilder, result));
        setTypeForPath(path, result);
        // FIXME: We're using a Map instead of an OrderedMap here because we represent
        // the JSON Schema as a JavaScript object, which has no map ordering.  Ideally
        // we would use a JSON parser that preserves order.
        const props = Map(properties).map((propSchema, propName) => {
            let t = toType(
                checkStringMap(propSchema),
                path.push({ kind: PathElementKind.Property, name: propName }),
                makeTypeNames(pluralize.singular(propName), true)
            );
            if (!required.has(propName)) {
                return typeBuilder.makeNullable(t, makeTypeNames(propName, true));
            }
            return t;
        });
        c.setProperties(props.toOrderedMap());
        return result;
    }

    function makeMap(path: Ref, typeNames: TypeNames, additional: StringMap): TypeRef {
        let valuesType: TypeRef | undefined = undefined;
        let mustSet = false;
        const result = typeBuilder.getLazyMapType(() => {
            mustSet = true;
            return valuesType;
        });
        setTypeForPath(path, result);
        path = path.push({ kind: PathElementKind.AdditionalProperty });
        valuesType = toType(additional, path, typeNames.singularize());
        if (mustSet) {
            (result.deref()[0] as MapType).setValues(valuesType);
        }
        return result;
    }

    function fromTypeName(schema: StringMap, path: Ref, typeNames: TypeNames, typeName: string): TypeRef {
        typeNames = getName(schema, typeNames.makeInferred());
        switch (typeName) {
            case "object":
                let required: string[];
                if (schema.required === undefined) {
                    required = [];
                } else {
                    required = checkStringArray(schema.required);
                }
                if (schema.properties !== undefined) {
                    return makeClass(schema, path, typeNames, checkStringMap(schema.properties), required);
                } else if (schema.additionalProperties !== undefined) {
                    const additional = schema.additionalProperties;
                    if (additional === true) {
                        return typeBuilder.getMapType(typeBuilder.getPrimitiveType("any"));
                    } else if (additional === false) {
                        return makeClass(schema, path, typeNames, {}, required);
                    } else {
                        return makeMap(path, typeNames, checkStringMap(additional));
                    }
                } else {
                    return typeBuilder.getMapType(typeBuilder.getPrimitiveType("any"));
                }
            case "array":
                if (schema.items !== undefined) {
                    path = path.push({ kind: PathElementKind.Items });
                    return typeBuilder.getArrayType(
                        toType(checkStringMap(schema.items), path, typeNames.singularize())
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
                            return panic(`String format ${schema.format} not supported`);
                    }
                }
                return typeBuilder.getStringType(typeNames, undefined);
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

    function convertToType(schema: StringMap, path: Ref, typeNames: TypeNames): TypeRef {
        typeNames = getName(schema, typeNames);

        function convertOneOrAnyOf(cases: any, kind: PathElementKind.OneOf | PathElementKind.AnyOf): TypeRef {
            if (!Array.isArray(cases)) {
                return panic(`oneOf or anyOf is not an array: ${cases}`);
            }
            // FIXME: This cast shouldn't be necessary, but TypeScript forces our hand.
            const types = cases.map(
                (t, index) => toType(checkStringMap(t), path.push({ kind, index } as any), typeNames).deref()[0]
            );
            return unifyTypes(OrderedSet(types), typeNames, typeBuilder, true);
        }

        if (schema.$ref !== undefined) {
            const [ref, refName] = parseRef(schema.$ref);
            const [target, targetPath] = lookupRef(schema, path, ref);
            return toType(target, targetPath, typeNames.areInferred ? makeTypeNames(refName, true) : typeNames);
        } else if (schema.enum !== undefined) {
            return typeBuilder.getEnumType(typeNames, OrderedSet(checkStringArray(schema.enum)));
        } else if (schema.type !== undefined) {
            const jsonTypes = checkTypeList(schema.type);
            if (jsonTypes.size === 1) {
                return fromTypeName(schema, path, typeNames, defined(jsonTypes.first()));
            } else {
                const types = jsonTypes.map(n => fromTypeName(schema, path, typeNames, n).deref()[0]);
                return unifyTypes(types, typeNames, typeBuilder, true);
            }
        } else if (schema.oneOf !== undefined) {
            return convertOneOrAnyOf(schema.oneOf, PathElementKind.OneOf);
        } else if (schema.anyOf !== undefined) {
            return convertOneOrAnyOf(schema.anyOf, PathElementKind.AnyOf);
        } else {
            return typeBuilder.getPrimitiveType("any");
        }
    }

    function toType(schema: StringMap, path: Ref, typeNames: TypeNames): TypeRef {
        // FIXME: This fromJS thing is ugly and inefficient.  Schemas aren't
        // big, so it most likely doesn't matter.
        const immutablePath = makeImmutablePath(path);
        const maybeType = typeForPath.get(immutablePath);
        if (maybeType !== undefined) {
            return maybeType;
        }
        const result = convertToType(schema, path, typeNames);
        setTypeForPath(immutablePath, result);
        return result;
    }

    const rootPathElement: PathElement = { kind: PathElementKind.Root };
    const rootType = toType(root, List<PathElement>([rootPathElement]), makeTypeNames(topLevelName, false));
    return rootType;
}
