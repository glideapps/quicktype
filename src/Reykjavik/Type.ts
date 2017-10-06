"use strict";

import { List, Map } from "immutable";

type NativeTypes = ClassType | UnionType;

type GlueTypes = GlueClassType | GlueUnionType;

type GenericType<T> =
    | AnyType
    | NullType
    | BoolType
    | IntegerType
    | DoubleType
    | StringType
    | ArrayType
    | MapType
    | T;

type Type = GenericType<NativeTypes>;

interface AnyType {
    kind: "any";
}

interface NullType {
    kind: "null";
}

interface BoolType {
    kind: "bool";
}

interface IntegerType {
    kind: "integer";
}

interface DoubleType {
    kind: "double";
}

interface StringType {
    kind: "string";
}

interface ArrayType {
    kind: "array";
    items: Type;
}

interface ClassType {
    kind: "class";
    properties: Map<string, Type>;
}

interface GlueClassType {
    kind: "class";
    properties: { [name: string]: Type };
}

interface MapType {
    kind: "map";
    values: Type;
}

interface UnionType {
    kind: "union";
    // FIXME: ordered set?  Then we'd have to have classes
    // and implement hash and equals.
    members: List<Type>;
}

interface GlueUnionType {
    kind: "union";
    members: Type[];
}
