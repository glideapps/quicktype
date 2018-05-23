/* tslint:disable:strict-boolean-expressions */

import {
    DocumentNode,
    SelectionSetNode,
    SelectionNode,
    OperationDefinitionNode,
    FragmentDefinitionNode,
    DirectiveNode,
    FieldNode
} from "graphql/language/ast";
import * as graphql from "graphql/language";

import {
    UnionType,
    ClassProperty,
    removeNullFromUnion,
    assertNever,
    panic,
    toString,
    StringInput,
    TypeBuilder,
    TypeRef,
    TypeNames,
    makeNamesTypeAttributes,
    namesTypeAttributeKind,
    messageAssert,
    TypeAttributes,
    emptyTypeAttributes,
    StringTypes,
    Input,
    setMap,
    iterableFirst,
    mapFromObject,
    derefTypeRef
} from "../quicktype-core";

import { TypeKind, GraphQLSchema } from "./GraphQLSchema";

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
    if (!t.fields) return panic(`Required field ${name} in type ${t.name} which doesn't have fields.`);
    for (const f of t.fields) {
        if (f.name === name) {
            return f;
        }
    }
    return panic(`Required field ${name} not defined on type ${t.name}.`);
}

function makeNames(name: string, fieldName: string | null, containingTypeName: string | null): TypeAttributes {
    const alternatives: string[] = [];
    if (fieldName) alternatives.push(fieldName);
    if (containingTypeName) alternatives.push(`${containingTypeName}_${name}`);
    if (fieldName && containingTypeName) alternatives.push(`${containingTypeName}_${fieldName}`);
    return namesTypeAttributeKind.makeAttributes(TypeNames.make(new Set([name]), new Set(alternatives), false));
}

function makeNullable(
    builder: TypeBuilder,
    tref: TypeRef,
    name: string,
    fieldName: string | null,
    containingTypeName: string
): TypeRef {
    const typeNames = makeNames(name, fieldName, containingTypeName);
    const t = derefTypeRef(tref, builder.typeGraph);
    if (!(t instanceof UnionType)) {
        return builder.getUnionType(typeNames, new Set([tref, builder.getPrimitiveType("null")]));
    }
    const [maybeNull, nonNulls] = removeNullFromUnion(t);
    if (maybeNull) return tref;
    return builder.getUnionType(typeNames, setMap(nonNulls, nn => nn.typeRef).add(builder.getPrimitiveType("null")));
}

// This is really not the way to do this, but it's easy and works.  By default
// all types in GraphQL are nullable, and non-nullability must be specially marked,
// so we just construct a nullable type first, and then remove the null from the
// union if the type is modified to be non-nullable.  That means that the union
// (and the null) might be left unreachable in the graph.  Provenance checking
// won't work in this case, which is why it's disabled in testing for GraphQL.
function removeNull(builder: TypeBuilder, tref: TypeRef): TypeRef {
    const t = derefTypeRef(tref, builder.typeGraph);
    if (!(t instanceof UnionType)) {
        return tref;
    }
    const nonNulls = removeNullFromUnion(t)[1];
    const first = iterableFirst(nonNulls);
    if (first) {
        if (nonNulls.size === 1) return first.typeRef;
        return builder.getUnionType(t.getAttributes(), setMap(nonNulls, nn => nn.typeRef));
    }
    return panic("Trying to remove null results in empty union.");
}

function makeScalar(builder: TypeBuilder, ft: GQLType): TypeRef {
    switch (ft.name) {
        case "Boolean":
            return builder.getPrimitiveType("bool");
        case "Int":
            return builder.getPrimitiveType("integer");
        case "Float":
            return builder.getPrimitiveType("double");
        default:
            // FIXME: support ID specifically?
            return builder.getStringType(emptyTypeAttributes, StringTypes.unrestricted);
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
    return selectionSet.selections
        .reverse()
        .map(s => ({ selection: s, inType, optional: optional || hasOptionalDirectives(s.directives) }));
}

interface GQLSchema {
    readonly types: { [name: string]: GQLType };
    readonly queryType: GQLType;
}

class GQLQuery {
    private readonly _schema: GQLSchema;
    private readonly _fragments: { [name: string]: FragmentDefinitionNode };

    readonly queries: ReadonlyArray<OperationDefinitionNode>;

    constructor(schema: GQLSchema, queryString: string) {
        this._schema = schema;
        this._fragments = {};

        const queryDocument = graphql.parse(queryString) as DocumentNode;
        const queries: OperationDefinitionNode[] = [];
        for (const def of queryDocument.definitions) {
            if (def.kind === "OperationDefinition") {
                if (def.operation !== "query") continue;
                queries.push(def);
            } else if (def.kind === "FragmentDefinition") {
                this._fragments[def.name.value] = def;
            }
        }
        messageAssert(queries.length >= 1, "GraphQLNoQueriesDefined", {});
        this.queries = queries;
    }

    private makeIRTypeFromFieldNode = (
        builder: TypeBuilder,
        fieldNode: FieldNode,
        fieldType: GQLType,
        containingTypeName: string
    ): TypeRef => {
        const optional = hasOptionalDirectives(fieldNode.directives);
        let result: TypeRef;
        switch (fieldType.kind) {
            case TypeKind.SCALAR:
                result = makeScalar(builder, fieldType);
                break;
            case TypeKind.OBJECT:
            case TypeKind.INTERFACE:
            case TypeKind.UNION:
                if (!fieldNode.selectionSet) {
                    return panic("No selection set on object or interface");
                }
                return makeNullable(
                    builder,
                    this.makeIRTypeFromSelectionSet(
                        builder,
                        fieldNode.selectionSet,
                        fieldType,
                        fieldNode.name.value,
                        containingTypeName
                    ),
                    fieldNode.name.value,
                    null,
                    containingTypeName
                );
            case TypeKind.ENUM:
                if (!fieldType.enumValues) {
                    return panic("Enum type doesn't have values");
                }
                const values = fieldType.enumValues.map(ev => ev.name);
                let name: string;
                let fieldName: string | null;
                if (fieldType.name) {
                    name = fieldType.name;
                    fieldName = fieldNode.name.value;
                } else {
                    name = fieldNode.name.value;
                    fieldName = null;
                }
                result = builder.getEnumType(makeNames(name, fieldName, containingTypeName), new Set(values));
                break;
            case TypeKind.INPUT_OBJECT:
                return panic("FIXME: Support input objects");
            case TypeKind.LIST:
                if (!fieldType.ofType) {
                    return panic("No type for list.");
                }
                result = builder.getArrayType(
                    this.makeIRTypeFromFieldNode(builder, fieldNode, fieldType.ofType, containingTypeName)
                );
                break;
            case TypeKind.NON_NULL:
                if (!fieldType.ofType) {
                    return panic("No type for non-null");
                }
                result = removeNull(
                    builder,
                    this.makeIRTypeFromFieldNode(builder, fieldNode, fieldType.ofType, containingTypeName)
                );
                break;
            default:
                return assertNever(fieldType.kind);
        }
        if (optional) {
            result = makeNullable(builder, result, fieldNode.name.value, null, containingTypeName);
        }
        return result;
    };

    private getFragment = (name: string): FragmentDefinitionNode => {
        const fragment = this._fragments[name];
        if (!fragment) return panic(`Fragment ${name} is not defined.`);
        return fragment;
    };

    private makeIRTypeFromSelectionSet = (
        builder: TypeBuilder,
        selectionSet: SelectionSetNode,
        gqlType: GQLType,
        containingFieldName: string | null,
        containingTypeName: string | null,
        overrideName?: string
    ): TypeRef => {
        if (
            gqlType.kind !== TypeKind.OBJECT &&
            gqlType.kind !== TypeKind.INTERFACE &&
            gqlType.kind !== TypeKind.UNION
        ) {
            return panic("Type for selection set is not object, interface, or union.");
        }
        if (!gqlType.name) {
            return panic("Object, interface, or union type doesn't have a name.");
        }
        const nameOrOverride = overrideName || gqlType.name;
        const properties = new Map<string, ClassProperty>();
        let selections = expandSelectionSet(selectionSet, gqlType, false);
        for (;;) {
            const nextItem = selections.pop();
            if (!nextItem) break;
            const { selection, optional, inType } = nextItem;
            switch (selection.kind) {
                case "Field":
                    const fieldName = selection.name.value;
                    const givenName = selection.alias ? selection.alias.value : fieldName;
                    const field = getField(inType, fieldName);
                    let fieldType = this.makeIRTypeFromFieldNode(builder, selection, field.type, nameOrOverride);
                    properties.set(givenName, builder.makeClassProperty(fieldType, optional));
                    break;
                case "FragmentSpread": {
                    const fragment = this.getFragment(selection.name.value);
                    const fragmentType = this._schema.types[fragment.typeCondition.name.value];
                    const fragmentOptional = optional || fragmentType.name !== inType.name;
                    const expanded = expandSelectionSet(fragment.selectionSet, fragmentType, fragmentOptional);
                    selections = selections.concat(expanded);
                    break;
                }
                case "InlineFragment": {
                    // FIXME: support type conditions with discriminated unions
                    const fragmentType = selection.typeCondition
                        ? this._schema.types[selection.typeCondition.name.value]
                        : inType;
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
        return builder.getClassType(makeNames(nameOrOverride, containingFieldName, containingTypeName), properties);
    };

    makeType(builder: TypeBuilder, query: OperationDefinitionNode, queryName: string): TypeRef {
        return this.makeIRTypeFromSelectionSet(
            builder,
            query.selectionSet,
            this._schema.queryType,
            null,
            queryName,
            "data"
        );
    }
}

class GQLSchemaFromJSON implements GQLSchema {
    readonly types: { [name: string]: GQLType } = {};
    // @ts-ignore: The constructor can return early, but only by throwing.
    readonly queryType: GQLType;

    constructor(json: any) {
        const schema: GraphQLSchema = json.data;

        if (schema.__schema.queryType.name === null) {
            return panic("Query type doesn't have a name.");
        }

        for (const t of schema.__schema.types as GQLType[]) {
            if (!t.name) return panic("No top-level type name given");
            this.types[t.name] = { kind: t.kind, name: t.name, description: t.description };
        }
        for (const t of schema.__schema.types) {
            if (!t.name) return panic("This cannot happen");
            const type = this.types[t.name];
            this.addTypeFields(type, t as GQLType);
            // console.log(`type ${type.name} is ${type.kind}`);
        }

        const queryType = this.types[schema.__schema.queryType.name];
        if (queryType === undefined) {
            return panic("Query type not found.");
        }
        // console.log(`query type ${queryType.name} is ${queryType.kind}`);
        this.queryType = queryType;
    }

    private addTypeFields = (target: GQLType, source: GQLType): void => {
        if (source.fields) {
            target.fields = source.fields.map(f => {
                return {
                    name: f.name,
                    description: f.description,
                    type: this.makeType(f.type),
                    args: f.args.map(this.makeInputValue)
                };
            });
            // console.log(`${target.name} has ${target.fields.length} fields`);
        }
        if (source.interfaces) {
            target.interfaces = source.interfaces.map(this.makeType);
            // console.log(`${target.name} has ${target.interfaces.length} interfaces`);
        }
        if (source.possibleTypes) {
            target.possibleTypes = source.possibleTypes.map(this.makeType);
            // console.log(`${target.name} has ${target.possibleTypes.length} possibleTypes`);
        }
        if (source.inputFields) {
            target.inputFields = source.inputFields.map(this.makeInputValue);
            // console.log(`${target.name} has ${target.inputFields.length} inputFields`);
        }
        if (source.enumValues) {
            target.enumValues = source.enumValues.map(ev => {
                return { name: ev.name, description: ev.description };
            });
            // console.log(`${target.name} has ${target.enumValues.length} enumValues`);
        }
    };

    private makeInputValue = (iv: InputValue): InputValue => {
        return {
            name: iv.name,
            description: iv.description,
            type: this.makeType(iv.type),
            defaultValue: iv.defaultValue
        };
    };

    private makeType = (t: GQLType): GQLType => {
        if (t.name) {
            const namedType = this.types[t.name];
            if (!namedType) return panic(`Type ${t.name} not found`);
            return namedType;
        }
        if (!t.ofType) return panic(`Type of kind ${t.kind} has neither name nor ofType`);
        const type: GQLType = {
            kind: t.kind,
            description: t.description,
            ofType: this.makeType(t.ofType)
        };
        this.addTypeFields(type, t);
        return type;
    };
}

function makeGraphQLQueryTypes(
    topLevelName: string,
    builder: TypeBuilder,
    json: any,
    queryString: string
): Map<string, TypeRef> {
    const schema = new GQLSchemaFromJSON(json);
    const query = new GQLQuery(schema, queryString);
    const types = new Map<string, TypeRef>();
    for (const odn of query.queries) {
        const queryName = odn.name ? odn.name.value : topLevelName;
        if (types.has(queryName)) {
            return panic(`Duplicate query name ${queryName}`);
        }
        const dataType = query.makeType(builder, odn, queryName);
        const errorType = builder.getClassType(
            namesTypeAttributeKind.makeAttributes(TypeNames.make(new Set(["error"]), new Set(["graphQLError"]), false)),
            mapFromObject({
                message: builder.makeClassProperty(
                    builder.getStringType(emptyTypeAttributes, StringTypes.unrestricted),
                    false
                )
            })
        );
        const errorArray = builder.getArrayType(errorType);
        builder.addAttributes(
            errorArray,
            namesTypeAttributeKind.makeAttributes(
                TypeNames.make(new Set(["errors"]), new Set(["graphQLErrors"]), false)
            )
        );
        const t = builder.getClassType(
            makeNamesTypeAttributes(queryName, false),
            mapFromObject({
                data: builder.makeClassProperty(dataType, false),
                errors: builder.makeClassProperty(errorArray, true)
            })
        );
        types.set(queryName, t);
    }
    return types;
}

export type GraphQLSourceData = { name: string; schema: any; query: StringInput };

type GraphQLTopLevel = { schema: any; query: string };

export class GraphQLInput implements Input<GraphQLSourceData> {
    readonly kind: string = "graphql";
    readonly needIR: boolean = true;
    readonly needSchemaProcessing: boolean = false;

    private readonly _topLevels: Map<string, GraphQLTopLevel> = new Map();

    async addSource(source: GraphQLSourceData): Promise<void> {
        this._topLevels.set(source.name, {
            schema: source.schema,
            query: await toString(source.query)
        });
    }

    async finishAddingInputs(): Promise<void> {
        return;
    }

    singleStringSchemaSource(): undefined {
        return undefined;
    }

    async addTypes(typeBuilder: TypeBuilder): Promise<void> {
        for (const [name, { schema, query }] of this._topLevels) {
            const newTopLevels = makeGraphQLQueryTypes(name, typeBuilder, schema, query);
            for (const [actualName, t] of newTopLevels) {
                typeBuilder.addTopLevel(this._topLevels.size === 1 ? name : actualName, t);
            }
        }
    }
}
