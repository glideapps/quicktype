"use strict";

import { List } from "immutable";

type Type =
    | AnyType
    | NullType
    | BoolType
    | IntegerType
    | FloatType
    | StringType
    | ArrayType
    | ClassType
    | MapType
    | UnionType;

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

interface FloatType {
    kind: "float";
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
    properties: { [name: string]: Type };
}

interface MapType {
    kind: "map";
    values: Type;
}

interface UnionType {
    kind: "union";
    members: List<Type>;
}
