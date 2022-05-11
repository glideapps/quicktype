"use strict";
/* tslint:disable:strict-boolean-expressions */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const graphql = require("graphql/language");
const collection_utils_1 = require("collection-utils");
const quicktype_core_1 = require("../quicktype-core");
const GraphQLSchema_1 = require("./GraphQLSchema");
function getField(t, name) {
    if (!t.fields)
        return quicktype_core_1.panic(`Required field ${name} in type ${t.name} which doesn't have fields.`);
    for (const f of t.fields) {
        if (f.name === name) {
            return f;
        }
    }
    return quicktype_core_1.panic(`Required field ${name} not defined on type ${t.name}.`);
}
function makeNames(name, fieldName, containingTypeName) {
    const alternatives = [];
    if (fieldName)
        alternatives.push(fieldName);
    if (containingTypeName)
        alternatives.push(`${containingTypeName}_${name}`);
    if (fieldName && containingTypeName)
        alternatives.push(`${containingTypeName}_${fieldName}`);
    return quicktype_core_1.namesTypeAttributeKind.makeAttributes(quicktype_core_1.TypeNames.make(new Set([name]), new Set(alternatives), false));
}
function makeNullable(builder, tref, name, fieldName, containingTypeName) {
    const typeNames = makeNames(name, fieldName, containingTypeName);
    const t = quicktype_core_1.derefTypeRef(tref, builder.typeGraph);
    if (!(t instanceof quicktype_core_1.UnionType)) {
        return builder.getUnionType(typeNames, new Set([tref, builder.getPrimitiveType("null")]));
    }
    const [maybeNull, nonNulls] = quicktype_core_1.removeNullFromUnion(t);
    if (maybeNull)
        return tref;
    return builder.getUnionType(typeNames, collection_utils_1.setMap(nonNulls, nn => nn.typeRef).add(builder.getPrimitiveType("null")));
}
// This is really not the way to do this, but it's easy and works.  By default
// all types in GraphQL are nullable, and non-nullability must be specially marked,
// so we just construct a nullable type first, and then remove the null from the
// union if the type is modified to be non-nullable.  That means that the union
// (and the null) might be left unreachable in the graph.  Provenance checking
// won't work in this case, which is why it's disabled in testing for GraphQL.
function removeNull(builder, tref) {
    const t = quicktype_core_1.derefTypeRef(tref, builder.typeGraph);
    if (!(t instanceof quicktype_core_1.UnionType)) {
        return tref;
    }
    const nonNulls = quicktype_core_1.removeNullFromUnion(t)[1];
    const first = collection_utils_1.iterableFirst(nonNulls);
    if (first) {
        if (nonNulls.size === 1)
            return first.typeRef;
        return builder.getUnionType(t.getAttributes(), collection_utils_1.setMap(nonNulls, nn => nn.typeRef));
    }
    return quicktype_core_1.panic("Trying to remove null results in empty union.");
}
function makeScalar(builder, ft) {
    switch (ft.name) {
        case "Boolean":
            return builder.getPrimitiveType("bool");
        case "Int":
            return builder.getPrimitiveType("integer");
        case "Float":
            return builder.getPrimitiveType("double");
        default:
            // FIXME: support ID specifically?
            return builder.getStringType(quicktype_core_1.emptyTypeAttributes, quicktype_core_1.StringTypes.unrestricted);
    }
}
function hasOptionalDirectives(directives) {
    if (!directives)
        return false;
    for (const d of directives) {
        const name = d.name.value;
        if (name === "include" || name === "skip")
            return true;
    }
    return false;
}
function expandSelectionSet(selectionSet, inType, optional) {
    return selectionSet.selections
        .reverse()
        .map(s => ({ selection: s, inType, optional: optional || hasOptionalDirectives(s.directives) }));
}
class GQLQuery {
    constructor(schema, queryString) {
        this.makeIRTypeFromFieldNode = (builder, fieldNode, fieldType, containingTypeName) => {
            let optional = hasOptionalDirectives(fieldNode.directives);
            let result;
            switch (fieldType.kind) {
                case GraphQLSchema_1.TypeKind.SCALAR:
                    result = makeScalar(builder, fieldType);
                    optional = true;
                    break;
                case GraphQLSchema_1.TypeKind.OBJECT:
                case GraphQLSchema_1.TypeKind.INTERFACE:
                case GraphQLSchema_1.TypeKind.UNION:
                    if (!fieldNode.selectionSet) {
                        return quicktype_core_1.panic("No selection set on object or interface");
                    }
                    return makeNullable(builder, this.makeIRTypeFromSelectionSet(builder, fieldNode.selectionSet, fieldType, fieldNode.name.value, containingTypeName), fieldNode.name.value, null, containingTypeName);
                case GraphQLSchema_1.TypeKind.ENUM:
                    if (!fieldType.enumValues) {
                        return quicktype_core_1.panic("Enum type doesn't have values");
                    }
                    const values = fieldType.enumValues.map(ev => ev.name);
                    let name;
                    let fieldName;
                    if (fieldType.name) {
                        name = fieldType.name;
                        fieldName = fieldNode.name.value;
                    }
                    else {
                        name = fieldNode.name.value;
                        fieldName = null;
                    }
                    optional = true;
                    result = builder.getEnumType(makeNames(name, fieldName, containingTypeName), new Set(values));
                    break;
                case GraphQLSchema_1.TypeKind.INPUT_OBJECT:
                    // FIXME: Support input objects
                    return quicktype_core_1.panic("Input objects not supported");
                case GraphQLSchema_1.TypeKind.LIST:
                    if (!fieldType.ofType) {
                        return quicktype_core_1.panic("No type for list");
                    }
                    result = builder.getArrayType(quicktype_core_1.emptyTypeAttributes, this.makeIRTypeFromFieldNode(builder, fieldNode, fieldType.ofType, containingTypeName));
                    break;
                case GraphQLSchema_1.TypeKind.NON_NULL:
                    if (!fieldType.ofType) {
                        return quicktype_core_1.panic("No type for non-null");
                    }
                    result = removeNull(builder, this.makeIRTypeFromFieldNode(builder, fieldNode, fieldType.ofType, containingTypeName));
                    break;
                default:
                    return quicktype_core_1.assertNever(fieldType.kind);
            }
            if (optional) {
                result = makeNullable(builder, result, fieldNode.name.value, null, containingTypeName);
            }
            return result;
        };
        this.getFragment = (name) => {
            const fragment = this._fragments[name];
            if (!fragment)
                return quicktype_core_1.panic(`Fragment ${name} is not defined.`);
            return fragment;
        };
        this.makeIRTypeFromSelectionSet = (builder, selectionSet, gqlType, containingFieldName, containingTypeName, overrideName) => {
            if (gqlType.kind !== GraphQLSchema_1.TypeKind.OBJECT &&
                gqlType.kind !== GraphQLSchema_1.TypeKind.INTERFACE &&
                gqlType.kind !== GraphQLSchema_1.TypeKind.UNION) {
                return quicktype_core_1.panic("Type for selection set is not object, interface, or union.");
            }
            if (!gqlType.name) {
                return quicktype_core_1.panic("Object, interface, or union type doesn't have a name.");
            }
            const nameOrOverride = overrideName || gqlType.name;
            const properties = new Map();
            let selections = expandSelectionSet(selectionSet, gqlType, false);
            for (;;) {
                const nextItem = selections.pop();
                if (!nextItem)
                    break;
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
                        const fragmentOptional = optional || fragmentType.name !== inType.name || hasOptionalDirectives(selection.directives);
                        const expanded = expandSelectionSet(selection.selectionSet, fragmentType, fragmentOptional);
                        selections = selections.concat(expanded);
                        break;
                    }
                    default:
                        quicktype_core_1.assertNever(selection);
                }
            }
            return builder.getClassType(makeNames(nameOrOverride, containingFieldName, containingTypeName), properties);
        };
        this._schema = schema;
        this._fragments = {};
        const queryDocument = graphql.parse(queryString);
        const queries = [];
        for (const def of queryDocument.definitions) {
            if (def.kind === "OperationDefinition") {
                if (def.operation === "query" || def.operation === "mutation") {
                    queries.push(def);
                }
            }
            else if (def.kind === "FragmentDefinition") {
                this._fragments[def.name.value] = def;
            }
        }
        quicktype_core_1.messageAssert(queries.length >= 1, "GraphQLNoQueriesDefined", {});
        this.queries = queries;
    }
    makeType(builder, query, queryName) {
        if (query.operation === "query") {
            return this.makeIRTypeFromSelectionSet(builder, query.selectionSet, this._schema.queryType, null, queryName, "data");
        }
        if (query.operation === "mutation") {
            if (this._schema.mutationType === undefined) {
                return quicktype_core_1.panic("This GraphQL endpoint has no mutations.");
            }
            return this.makeIRTypeFromSelectionSet(builder, query.selectionSet, this._schema.mutationType, null, queryName, "data");
        }
        return quicktype_core_1.panic(`Unknown query operation type: "${query.operation}"`);
    }
}
class GQLSchemaFromJSON {
    constructor(json) {
        this.types = {};
        this.addTypeFields = (target, source) => {
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
        this.makeInputValue = (iv) => {
            return {
                name: iv.name,
                description: iv.description,
                type: this.makeType(iv.type),
                defaultValue: iv.defaultValue
            };
        };
        this.makeType = (t) => {
            if (t.name) {
                const namedType = this.types[t.name];
                if (!namedType)
                    return quicktype_core_1.panic(`Type ${t.name} not found`);
                return namedType;
            }
            if (!t.ofType)
                return quicktype_core_1.panic(`Type of kind ${t.kind} has neither name nor ofType`);
            const type = {
                kind: t.kind,
                description: t.description,
                ofType: this.makeType(t.ofType)
            };
            this.addTypeFields(type, t);
            return type;
        };
        const schema = json.data;
        if (schema.__schema.queryType.name === null) {
            return quicktype_core_1.panic("Query type doesn't have a name.");
        }
        for (const t of schema.__schema.types) {
            if (!t.name)
                return quicktype_core_1.panic("No top-level type name given");
            this.types[t.name] = { kind: t.kind, name: t.name, description: t.description };
        }
        for (const t of schema.__schema.types) {
            if (!t.name)
                return quicktype_core_1.panic("This cannot happen");
            const type = this.types[t.name];
            this.addTypeFields(type, t);
            // console.log(`type ${type.name} is ${type.kind}`);
        }
        const queryType = this.types[schema.__schema.queryType.name];
        if (queryType === undefined) {
            return quicktype_core_1.panic("Query type not found.");
        }
        // console.log(`query type ${queryType.name} is ${queryType.kind}`);
        this.queryType = queryType;
        if (schema.__schema.mutationType === null) {
            return;
        }
        if (schema.__schema.mutationType.name === null) {
            return quicktype_core_1.panic("Mutation type doesn't have a name.");
        }
        const mutationType = this.types[schema.__schema.mutationType.name];
        if (mutationType === undefined) {
            return quicktype_core_1.panic("Mutation type not found.");
        }
        this.mutationType = mutationType;
    }
}
function makeGraphQLQueryTypes(topLevelName, builder, json, queryString) {
    const schema = new GQLSchemaFromJSON(json);
    const query = new GQLQuery(schema, queryString);
    const types = new Map();
    for (const odn of query.queries) {
        const queryName = odn.name ? odn.name.value : topLevelName;
        if (types.has(queryName)) {
            return quicktype_core_1.panic(`Duplicate query name ${queryName}`);
        }
        const dataType = query.makeType(builder, odn, queryName);
        const dataOrNullType = builder.getUnionType(quicktype_core_1.emptyTypeAttributes, new Set([dataType, builder.getPrimitiveType("null")]));
        const errorType = builder.getClassType(quicktype_core_1.namesTypeAttributeKind.makeAttributes(quicktype_core_1.TypeNames.make(new Set(["error"]), new Set(["graphQLError"]), false)), collection_utils_1.mapFromObject({
            message: builder.makeClassProperty(builder.getStringType(quicktype_core_1.emptyTypeAttributes, quicktype_core_1.StringTypes.unrestricted), false)
        }));
        const errorArray = builder.getArrayType(quicktype_core_1.namesTypeAttributeKind.makeAttributes(quicktype_core_1.TypeNames.make(new Set(["errors"]), new Set(["graphQLErrors"]), false)), errorType);
        const t = builder.getClassType(quicktype_core_1.makeNamesTypeAttributes(queryName, false), collection_utils_1.mapFromObject({
            data: builder.makeClassProperty(dataOrNullType, false),
            errors: builder.makeClassProperty(errorArray, true)
        }));
        types.set(queryName, t);
    }
    return types;
}
class GraphQLInput {
    constructor() {
        this.kind = "graphql";
        this.needIR = true;
        this.needSchemaProcessing = false;
        this._topLevels = new Map();
    }
    addSource(source) {
        return __awaiter(this, void 0, void 0, function* () {
            this.addSourceSync(source);
        });
    }
    addSourceSync(source) {
        this._topLevels.set(source.name, {
            schema: source.schema,
            query: source.query
        });
    }
    singleStringSchemaSource() {
        return undefined;
    }
    addTypes(ctx, typeBuilder) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.addTypesSync(ctx, typeBuilder);
        });
    }
    addTypesSync(_ctx, typeBuilder) {
        for (const [name, { schema, query }] of this._topLevels) {
            const newTopLevels = makeGraphQLQueryTypes(name, typeBuilder, schema, query);
            for (const [actualName, t] of newTopLevels) {
                typeBuilder.addTopLevel(this._topLevels.size === 1 ? name : actualName, t);
            }
        }
    }
}
exports.GraphQLInput = GraphQLInput;
