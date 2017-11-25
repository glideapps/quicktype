"use strict";

import { List, OrderedSet, Map, OrderedMap, fromJS, Set } from "immutable";
import * as pluralize from "pluralize";

import { Type, ClassType, NameOrNames, matchType, EnumType, makeNullable } from "./Type";
import { panic, assertNever, StringMap, checkStringMap } from "./Support";
import { TypeGraph, UnionBuilder } from "./TypeBuilder";

enum PathElementKind {
    Root,
    Definition,
    OneOf,
    Property,
    AdditionalProperty,
    Items
}

type PathElement =
    | { kind: PathElementKind.Root }
    | { kind: PathElementKind.Definition; name: string }
    | { kind: PathElementKind.OneOf; index: number }
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

function indexOneOf(schema: StringMap, index: number): StringMap {
    const cases = schema.oneOf;
    if (!Array.isArray(cases)) {
        return panic("oneOf value must be an array");
    }
    return checkStringMap(cases[index]);
}

function getName(schema: StringMap, inferredName: string): [string, boolean] {
    let name: string;
    let isInferred: boolean;
    const title = schema.title;
    if (typeof title === "string") {
        return [title, false];
    } else {
        return [inferredName, true];
    }
}

function checkTypeList(typeOrTypes: any): string[] {
    if (typeof typeOrTypes === "string") {
        return [typeOrTypes];
    } else if (Array.isArray(typeOrTypes)) {
        const arr: string[] = [];
        for (const t of typeOrTypes) {
            if (typeof t !== "string") {
                return panic(`element of type is not a string: ${t}`);
            }
            arr.push(t);
        }
        return arr;
    } else {
        return panic(`type is neither a string or array of strings: ${typeOrTypes}`);
    }
}

class UnifyUnionBuilder extends UnionBuilder<Type, ClassType, Type> {
    constructor(
        typeBuilder: TypeGraph,
        typeName: string,
        isInferred: boolean,
        private readonly _unifyTypes: (typesToUnify: Type[], typeName: string, isInferred: boolean) => Type
    ) {
        super(typeBuilder, typeName, isInferred);
    }

    protected makeEnum(enumCases: string[]): EnumType {
        return this.typeBuilder.getEnumType(this.typeName, this.isInferred, OrderedSet(enumCases));
    }

    protected makeClass(classes: ClassType[], maps: Type[]): Type {
        if (classes.length > 0 && maps.length > 0) {
            return panic("Cannot handle a class type that's also a map");
        }
        if (maps.length > 0) {
            return this.typeBuilder.getMapType(this._unifyTypes(maps, this.typeName, this.isInferred));
        }
        if (classes.length === 1) {
            return classes[0];
        }
        let properties = OrderedMap<string, Type[]>();
        for (const c of classes) {
            c.properties.forEach((t, name) => {
                const types = properties.get(name);
                if (types === undefined) {
                    properties = properties.set(name, [t]);
                } else {
                    types.push(t);
                }
            });
        }
        return this.typeBuilder.getUniqueClassType(
            this.typeName,
            this.isInferred,
            properties.map((ts, name) => this._unifyTypes(ts, name, true))
        );
    }

    protected makeArray(arrays: Type[]): Type {
        return this.typeBuilder.getArrayType(this._unifyTypes(arrays, pluralize.singular(this.typeName), true));
    }
}

export function schemaToType(typeBuilder: TypeGraph, topLevelName: string, rootJson: any): Type {
    const root = checkStringMap(rootJson);
    let typeForPath = Map<Ref, Type>();

    function setTypeForPath(path: Ref, t: Type): void {
        typeForPath = typeForPath.set(path.map(pe => fromJS(pe)), t);
    }

    function unifyTypes(typesToUnify: Type[], typeName: string, isInferred: boolean): Type {
        if (typesToUnify.length === 0) {
            return panic("Cannot unify empty list of types");
        } else if (typesToUnify.length === 1) {
            return typesToUnify[0];
        } else {
            const unionBuilder = new UnifyUnionBuilder(typeBuilder, typeName, isInferred, unifyTypes);

            const registerType = (t: Type): void => {
                matchType<void>(
                    t,
                    anyType => unionBuilder.addAny(),
                    nullType => unionBuilder.addNull(),
                    boolType => unionBuilder.addBool(),
                    integerType => unionBuilder.addInteger(),
                    doubleType => unionBuilder.addDouble(),
                    stringType => unionBuilder.addString(),
                    arrayType => unionBuilder.addArray(arrayType.items),
                    classType => unionBuilder.addClass(classType),
                    mapType => unionBuilder.addMap(mapType.values),
                    enumType => enumType.cases.forEach(s => unionBuilder.addEnumCase(s)),
                    unionType => unionType.members.forEach(registerType)
                );
            };

            for (const t of typesToUnify) {
                registerType(t);
            }

            return unionBuilder.buildUnion(true);
        }
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
                return lookupRef(indexOneOf(local, first.index), localPath, rest);
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
        inferredName: string,
        properties: StringMap,
        requiredArray: string[]
    ): ClassType {
        const required = Set(requiredArray);
        const [name, isInferred] = getName(schema, inferredName);
        const c = typeBuilder.getUniqueClassType(name, isInferred);
        setTypeForPath(path, c);
        const props = Map(properties).map((propSchema, propName) => {
            let t = toType(
                checkStringMap(propSchema),
                path.push({ kind: PathElementKind.Property, name: propName }),
                pluralize.singular(propName)
            );
            if (!required.has(propName)) {
                t = makeNullable(t, propName, true);
            }
            return t;
        });
        c.setProperties(props);
        return c;
    }

    function fromTypeName(schema: StringMap, path: Ref, inferredName: string, typeName: string): Type {
        const [name, isInferred] = getName(schema, inferredName);
        switch (typeName) {
            case "object":
                let required: string[];
                if (schema.required === undefined) {
                    required = [];
                } else {
                    required = checkStringArray(schema.required);
                }
                if (schema.properties !== undefined) {
                    return makeClass(schema, path, name, checkStringMap(schema.properties), required);
                } else if (schema.additionalProperties !== undefined) {
                    const additional = schema.additionalProperties;
                    if (additional === true) {
                        return typeBuilder.getMapType(typeBuilder.getPrimitiveType("any"));
                    } else if (additional === false) {
                        return makeClass(schema, path, name, {}, required);
                    } else {
                        path = path.push({ kind: PathElementKind.AdditionalProperty });
                        return typeBuilder.getMapType(
                            toType(checkStringMap(additional), path, pluralize.singular(name))
                        );
                    }
                } else {
                    return typeBuilder.getMapType(typeBuilder.getPrimitiveType("any"));
                }
            case "array":
                if (schema.items !== undefined) {
                    path = path.push({ kind: PathElementKind.Items });
                    return typeBuilder.getArrayType(
                        toType(checkStringMap(schema.items), path, pluralize.singular(name))
                    );
                }
                return typeBuilder.getArrayType(typeBuilder.getPrimitiveType("any"));
            case "boolean":
                return typeBuilder.getPrimitiveType("bool");
            case "string":
                return typeBuilder.getPrimitiveType("string");
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

    function convertToType(schema: StringMap, path: Ref, inferredName: string): Type {
        const [name, isInferred] = getName(schema, inferredName);
        if (schema.$ref !== undefined) {
            const [ref, refName] = parseRef(schema.$ref);
            const [target, targetPath] = lookupRef(schema, path, ref);
            return toType(target, targetPath, refName);
        } else if (schema.enum !== undefined) {
            return typeBuilder.getEnumType(name, isInferred, OrderedSet(checkStringArray(schema.enum)));
        } else if (schema.type !== undefined) {
            const typeNames = checkTypeList(schema.type);
            const types = typeNames.map(n => fromTypeName(schema, path, name, n));
            return unifyTypes(types, name, isInferred);
        } else if (schema.oneOf !== undefined) {
            const oneOf = schema.oneOf;
            if (!Array.isArray(oneOf)) {
                return panic(`oneOf is not an array: ${schema.oneOf}`);
            }
            const types = oneOf.map((t, index) =>
                toType(checkStringMap(t), path.push({ kind: PathElementKind.OneOf, index }), name)
            );
            return unifyTypes(types, name, isInferred);
        } else {
            return typeBuilder.getPrimitiveType("any");
        }
    }

    function toType(schema: StringMap, path: Ref, name: string): Type {
        // FIXME: This fromJS thing is ugly and inefficient.  Schemas aren't
        // big, so it most likely doesn't matter.
        const immutablePath = path.map(pe => fromJS(pe));
        const maybeType = typeForPath.get(immutablePath);
        if (maybeType !== undefined) {
            return maybeType;
        }
        const result = convertToType(schema, path, name);
        setTypeForPath(immutablePath, result);
        return result;
    }

    const rootPathElement: PathElement = { kind: PathElementKind.Root };
    const rootType = toType(root, List<PathElement>([rootPathElement]), topLevelName);
    if (rootType.isNamedType()) {
        rootType.setGivenName(topLevelName);
    }
    return rootType;
}
