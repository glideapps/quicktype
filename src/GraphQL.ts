"use strict";

import { parse } from "graphql/language";
import { Map, Set, OrderedSet } from "immutable";

import { Type, ClassType, ArrayType, EnumType, UnionType, PrimitiveType, TypeNames, removeNullFromUnion } from "./Type";
import { GraphQLSchema, TypeKind } from "./GraphQLSchema";
import { DocumentNode, SelectionSetNode, SelectionNode, OperationDefinitionNode, FieldNode } from "./GraphQLAST";
import { assertNever } from "./Support";

interface GQLType {
    kind: TypeKind;
    name?: string;
    description?: string;
    ofType?: GQLType;
    fields?: Field[];
    interfaces?: GQLType[];
    possibleTypes?: GQLType[];
    inputFields?: InputValue[];
    enumValues?: EnumValue[];
}

interface EnumValue {
    name: string;
    description?: string;
}

interface Field {
    name: string;
    description?: string;
    type: GQLType;
    args: InputValue[];
}

interface InputValue {
    name: string;
    description?: string;
    type: GQLType;
    defaultValue?: string;
}

function getField(t: GQLType, name: string): Field {
    if (!t.fields) throw `Error: Required field ${name} in type ${t.name} which doesn't have fields.`;
    for (const f of t.fields) {
        if (f.name === name) {
            return f;
        }
    }
    throw `Error: Required field ${name} not defined on type ${t.name}.`;
}

function makeTypeNames(name: string): TypeNames {
    return { names: Set([name]), combined: name };
}

function makeNullable(t: Type, name: string): Type {
    if (!(t instanceof UnionType)) {
        return new UnionType(makeTypeNames(name), OrderedSet([t, new PrimitiveType("null")]));
    }
    const [maybeNull, nonNulls] = removeNullFromUnion(t);
    if (maybeNull) return t;
    return new UnionType(makeTypeNames(name), nonNulls.add(new PrimitiveType("null")));
}

function removeNull(t: Type): Type {
    if (!(t instanceof UnionType)) {
        return t;
    }
    const [_, nonNulls] = removeNullFromUnion(t);
    const first = nonNulls.first();
    if (first) {
        if (nonNulls.size === 1) return first;
        return new UnionType(t.names, nonNulls);
    }
    throw "Error: Trying to remove null results in empty union.";
}

function makeScalar(ft: GQLType): Type {
    switch (ft.name) {
        case "Boolean":
            return new PrimitiveType("bool");
        case "String":
            return new PrimitiveType("string");
        case "Int":
            return new PrimitiveType("integer");
        case "Float":
            return new PrimitiveType("double");
        case "ID":
            // FIXME: support ID?
            return new PrimitiveType("string");
        default:
            throw `Error: Scalar type ${ft.name} not supported.`;
    }
}

function makeIRTypeFromFieldNode(fieldNode: FieldNode, fieldType: GQLType): Type {
    switch (fieldType.kind) {
        case TypeKind.SCALAR:
            return makeScalar(fieldType);
        case TypeKind.OBJECT:
            if (!fieldNode.selectionSet) throw "Error: No selection set on object.";
            return makeNullable(makeIRTypeFromSelectionSet(fieldNode.selectionSet, fieldType), fieldNode.name.value);
        case TypeKind.INTERFACE:
            throw "FIXME: support interfaces";
        case TypeKind.UNION:
            throw "FIXME: support unions";
        case TypeKind.ENUM:
            if (!fieldType.enumValues) throw "Error: Enum type doesn't have values.";
            const values = fieldType.enumValues.map(ev => ev.name);
            const name = fieldType.name || fieldNode.name.value;
            return new EnumType(makeTypeNames(name), OrderedSet(values));
        case TypeKind.INPUT_OBJECT:
            throw "FIXME: support input objects";
        case TypeKind.LIST:
            if (!fieldType.ofType) throw "Error: No type for list.";
            return new ArrayType(makeIRTypeFromFieldNode(fieldNode, fieldType.ofType));
        case TypeKind.NON_NULL:
            if (!fieldType.ofType) throw "Error: No type for non-null.";
            return removeNull(makeIRTypeFromFieldNode(fieldNode, fieldType.ofType));
        default:
            return assertNever(fieldType.kind);
    }
}

function makeIRTypeFromSelectionSet(selectionSet: SelectionSetNode, gqlType: GQLType): ClassType {
    if (gqlType.kind !== TypeKind.OBJECT) throw "Error: Type for selection set is not object.";
    if (!gqlType.name) throw "Error: Object type doesn't have a name.";
    let properties = Map<string, Type>();
    for (const selection of selectionSet.selections) {
        if (selection.kind === "Field") {
            const name = selection.name.value;
            const field = getField(gqlType, name);
            const fieldType = makeIRTypeFromFieldNode(selection, field.type);
            properties = properties.set(name, fieldType);
        }
    }
    const classType = new ClassType(makeTypeNames(gqlType.name));
    classType.setProperties(properties);
    return classType;
}

export function readGraphQLSchema(json: any, queryString: string): Type {
    const schema: GraphQLSchema = json.data;
    let types: { [name: string]: GQLType } = {};

    function addTypeFields(target: GQLType, source: GQLType): void {
        if (source.fields) {
            target.fields = source.fields.map(f => {
                return {
                    name: f.name,
                    description: f.description,
                    type: makeType(f.type),
                    args: f.args.map(makeInputValue)
                };
            });
            // console.log(`${target.name} has ${target.fields.length} fields`);
        }
        if (source.interfaces) {
            target.interfaces = source.interfaces.map(makeType);
            // console.log(`${target.name} has ${target.interfaces.length} interfaces`);
        }
        if (source.possibleTypes) {
            target.possibleTypes = source.possibleTypes.map(makeType);
            // console.log(`${target.name} has ${target.possibleTypes.length} possibleTypes`);
        }
        if (source.inputFields) {
            target.inputFields = source.inputFields.map(makeInputValue);
            // console.log(`${target.name} has ${target.inputFields.length} inputFields`);
        }
        if (source.enumValues) {
            target.enumValues = source.enumValues.map(ev => {
                return { name: ev.name, description: ev.description };
            });
            // console.log(`${target.name} has ${target.enumValues.length} enumValues`);
        }
    }

    function makeInputValue(iv: InputValue): InputValue {
        return {
            name: iv.name,
            description: iv.description,
            type: makeType(iv.type),
            defaultValue: iv.defaultValue
        };
    }

    function makeType(t: GQLType): GQLType {
        if (t.name) {
            const namedType = types[t.name];
            if (!namedType) throw `Type ${t.name} not found`;
            return namedType;
        }
        if (!t.ofType) throw `Type of kind ${t.kind} has neither name nor ofType`;
        const type: GQLType = {
            kind: t.kind,
            description: t.description,
            ofType: makeType(t.ofType)
        };
        addTypeFields(type, t);
        return type;
    }

    if (schema.__schema.queryType.name === null) {
        throw "Error: Query type doesn't have a name.";
    }

    for (const t of schema.__schema.types as GQLType[]) {
        if (!t.name) throw "No top-level type name given";
        types[t.name] = { kind: t.kind, name: t.name, description: t.description };
    }
    for (const t of schema.__schema.types) {
        if (!t.name) throw "This cannot happen";
        const type = types[t.name];
        addTypeFields(type, t as GQLType);
        // console.log(`type ${type.name} is ${type.kind}`);
    }

    const queryType = types[schema.__schema.queryType.name];
    if (!queryType) {
        throw "Error: Query type not found.";
    }
    // console.log(`query type ${queryType.name} is ${queryType.kind}`);

    const queryDocument = <DocumentNode>parse(queryString);
    const queries = <OperationDefinitionNode[]>queryDocument.definitions.filter(
        d => d.kind === "OperationDefinition" && d.operation === "query"
    );
    if (queries.length !== 1) {
        throw "Error: Must have exactly one query defined.";
    }
    const query = queries[0];
    return makeIRTypeFromSelectionSet(query.selectionSet, queryType);

    // console.log(JSON.stringify(queries, undefined, 4));
}
