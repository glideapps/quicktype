"use strict";

import { parse } from "graphql/language";
import { Map, Set, OrderedSet } from "immutable";

import { Type, ClassType, ArrayType, EnumType, UnionType, PrimitiveType, TypeNames, removeNullFromUnion } from "./Type";
import { GraphQLSchema, TypeKind } from "./GraphQLSchema";
import {
    DocumentNode,
    SelectionSetNode,
    SelectionNode,
    OperationDefinitionNode,
    FragmentDefinitionNode,
    DirectiveNode,
    FieldNode,
    FragmentSpreadNode,
    InlineFragmentNode
} from "./GraphQLAST";
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
        case "Int":
            return new PrimitiveType("integer");
        case "Float":
            return new PrimitiveType("double");
        default:
            // FIXME: support ID specifically?
            return new PrimitiveType("string");
    }
}

function hasOptionalDirectives(directives?: DirectiveNode[]): boolean {
    if (!directives) return false;
    for (const d of directives) {
        const name = d.name.value;
        if (name === "include" || name === "skip") return true;
    }
    return false;
}

interface Selection {
    selection: SelectionNode;
    inType: GQLType;
    optional: boolean;
}

function expandSelectionSet(selectionSet: SelectionSetNode, inType: GQLType, optional: boolean): Selection[] {
    return selectionSet.selections.reverse().map(s => ({ selection: s, inType, optional }));
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

    function makeIRTypeFromFieldNode(fieldNode: FieldNode, fieldType: GQLType): Type {
        switch (fieldType.kind) {
            case TypeKind.SCALAR:
                return makeScalar(fieldType);
            case TypeKind.OBJECT:
            case TypeKind.INTERFACE:
                if (!fieldNode.selectionSet) throw "Error: No selection set on object or interface.";
                return makeNullable(
                    makeIRTypeFromSelectionSet(fieldNode.selectionSet, fieldType),
                    fieldNode.name.value
                );
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

    function getFragment(name: string): FragmentDefinitionNode {
        const fragment = fragments[name];
        if (!fragment) throw `Error: Fragment ${name} is not defined.`;
        return fragment;
    }

    function makeIRTypeFromSelectionSet(selectionSet: SelectionSetNode, gqlType: GQLType): ClassType {
        if (gqlType.kind !== TypeKind.OBJECT && gqlType.kind !== TypeKind.INTERFACE) {
            throw "Error: Type for selection set is not object or interface.";
        }
        if (!gqlType.name) throw "Error: Object or interface type doesn't have a name.";
        let properties = Map<string, Type>();
        let selections = expandSelectionSet(selectionSet, gqlType, false);
        for (;;) {
            const nextItem = selections.pop();
            if (!nextItem) break;
            const { selection, optional, inType } = nextItem;
            switch (selection.kind) {
                case "Field":
                    const name = selection.name.value;
                    const field = getField(inType, name);
                    let fieldType = makeIRTypeFromFieldNode(selection, field.type);
                    if (optional) {
                        fieldType = makeNullable(fieldType, name);
                    }
                    properties = properties.set(name, fieldType);
                    break;
                case "FragmentSpread": {
                    const fragment = getFragment(selection.name.value);
                    const fragmentType = types[fragment.typeCondition.name.value];
                    const fragmentOptional = optional || fragmentType.name !== inType.name;
                    const expanded = expandSelectionSet(fragment.selectionSet, fragmentType, fragmentOptional);
                    selections = selections.concat(expanded);
                    break;
                }
                case "InlineFragment": {
                    // FIXME: support type conditions with discriminated unions
                    const fragmentType = selection.typeCondition ? types[selection.typeCondition.name.value] : inType;
                    const fragmentOptional =
                        optional || fragmentType.name !== inType.name || hasOptionalDirectives(selection.directives);
                    const expanded = expandSelectionSet(selection.selectionSet, fragmentType, fragmentOptional);
                    selections = selections.concat(expanded);
                    break;
                }
                default:
                    assertNever(selection);
            }
        }
        const classType = new ClassType(makeTypeNames(gqlType.name));
        classType.setProperties(properties);
        return classType;
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
    const queries: OperationDefinitionNode[] = [];
    const fragments: { [name: string]: FragmentDefinitionNode } = {};
    for (const def of queryDocument.definitions) {
        if (def.kind === "OperationDefinition") {
            if (def.operation !== "query") continue;
            queries.push(def);
        } else if (def.kind === "FragmentDefinition") {
            fragments[def.name.value] = def;
        }
    }
    if (queries.length !== 1) {
        throw "Error: Must have exactly one query defined.";
    }
    const query = queries[0];
    return makeIRTypeFromSelectionSet(query.selectionSet, queryType);

    // console.log(JSON.stringify(queries, undefined, 4));
}
