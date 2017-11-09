"use strict";

import { GraphQLSchema, TypeKind } from "./GraphQLSchema";

export interface Type {
    kind: TypeKind;
    name?: string;
    description?: string;
    ofType?: Type;
    fields?: Field[];
    interfaces?: Type[];
    possibleTypes?: Type[];
    inputFields?: InputValue[];
    enumValues?: EnumValue[];
}

export interface EnumValue {
    name: string;
    description?: string;
}

export interface Field {
    name: string;
    description?: string;
    type: Type;
    args: InputValue[];
}

export interface InputValue {
    name: string;
    description?: string;
    type: Type;
    defaultValue?: string;
}

export function readGraphQLSchema(json: any): Type | null {
    const schema: GraphQLSchema = json.data;
    let types: { [name: string]: Type } = {};

    function addTypeFields(target: Type, source: Type): void {
        if (source.fields) {
            target.fields = source.fields.map(f => {
                return {
                    name: f.name,
                    description: f.description,
                    type: makeType(f.type),
                    args: f.args.map(makeInputValue)
                };
            });
            console.log(`${target.name} has ${target.fields.length} fields`);
        }
        if (source.interfaces) {
            target.interfaces = source.interfaces.map(makeType);
            console.log(`${target.name} has ${target.interfaces.length} interfaces`);
        }
        if (source.possibleTypes) {
            target.possibleTypes = source.possibleTypes.map(makeType);
            console.log(`${target.name} has ${target.possibleTypes.length} possibleTypes`);
        }
        if (source.inputFields) {
            target.inputFields = source.inputFields.map(makeInputValue);
            console.log(`${target.name} has ${target.inputFields.length} inputFields`);
        }
        if (source.enumValues) {
            target.enumValues = source.enumValues.map(ev => {
                return { name: ev.name, description: ev.description };
            });
            console.log(`${target.name} has ${target.enumValues.length} enumValues`);
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

    function makeType(t: Type): Type {
        if (t.name) {
            const namedType = types[t.name];
            if (!namedType) throw `Type ${t.name} not found`;
            return namedType;
        }
        if (!t.ofType) throw `Type of kind ${t.kind} has neither name nor ofType`;
        const type: Type = { kind: t.kind, description: t.description, ofType: makeType(t.ofType) };
        addTypeFields(type, t);
        return type;
    }

    if (schema.__schema.queryType.name === null) {
        return null;
    }
    
    for (const t of schema.__schema.types as Type[]) {
        if (!t.name) throw "No top-level type name given";
        types[t.name] = { kind: t.kind, name: t.name, description: t.description };
    }
    for (const t of schema.__schema.types) {
        if (!t.name) throw "This cannot happen";
        const type = types[t.name];
        addTypeFields(type, t as Type);
        console.log(`type ${type.name} is ${type.kind}`);
    }

    const queryType = types[schema.__schema.queryType.name];
    if (!queryType) {
        return null;
    }
    console.log(`query type ${queryType.name} is ${queryType.kind}`);
    return queryType;
}
