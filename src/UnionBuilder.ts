"use strict";

import { Map, Set, OrderedMap, OrderedSet } from "immutable";

import { TypeKind, Type, UnionType, Transformation } from "./Type";
import { matchTypeExhaustive } from "./TypeUtils";
import {
    TypeAttributes,
    combineTypeAttributes,
    emptyTypeAttributes,
    makeTypeAttributesInferred
} from "./TypeAttributes";
import { defined, assert, panic, assertNever } from "./Support";
import { TypeRef, TypeBuilder } from "./TypeBuilder";

// FIXME: This interface is badly designed.  All the properties
// should use immutable types, and getMemberKinds should be
// implementable using the interface, not be part of it.  That
// means we'll have to expose primitive types, too.
//
// FIXME: Also, only UnionAccumulator seems to implement it.
export interface UnionTypeProvider<TArrayData, TObjectData> {
    readonly arrayData: TArrayData;
    readonly objectData: TObjectData;
    // FIXME: We're losing order here.
    enumCaseMap: { [name: string]: number };
    enumCases: string[];

    getMemberKinds(): TypeAttributeMap<TypeKind>;

    readonly lostTypeAttributes: boolean;
}

export type TypeAttributeMap<T> = OrderedMap<T, TypeAttributes>;

function addAttributes(
    accumulatorAttributes: TypeAttributes | undefined,
    newAttributes: TypeAttributes
): TypeAttributes {
    if (accumulatorAttributes === undefined) return newAttributes;
    return combineTypeAttributes(accumulatorAttributes, newAttributes);
}

function setAttributes<T>(
    attributeMap: TypeAttributeMap<T>,
    key: T,
    newAttributes: TypeAttributes
): TypeAttributeMap<T> {
    return attributeMap.set(key, addAttributes(attributeMap.get(key), newAttributes));
}

function moveAttributes<T>(map: TypeAttributeMap<T>, fromKey: T, toKey: T): TypeAttributeMap<T> {
    const fromAttributes = defined(map.get(fromKey));
    map = map.remove(fromKey);
    return setAttributes(map, toKey, fromAttributes);
}

export class UnionAccumulator<TArray, TObject> implements UnionTypeProvider<TArray[], TObject[]> {
    private _nonStringTypeAttributes: TypeAttributeMap<TypeKind> = OrderedMap();
    // Once enums are not allowed anymore, this goes to undefined.
    // Invariant: _enumTypeAttributes === undefined || _stringTypeAttributes.isEmpty()
    private _enumTypeAttributes: TypeAttributes | undefined = Map();
    private _stringTypeAttributes: TypeAttributeMap<Transformation | undefined> = OrderedMap();

    readonly arrayData: TArray[] = [];
    readonly objectData: TObject[] = [];

    private _lostTypeAttributes: boolean = false;

    // FIXME: we're losing order here
    enumCaseMap: { [name: string]: number } = {};
    enumCases: string[] = [];

    constructor(private readonly _conflateNumbers: boolean) {}

    private have(kind: TypeKind): boolean {
        if (kind === "string") {
            return !this._stringTypeAttributes.isEmpty();
        } else if (kind === "enum") {
            return this._enumTypeAttributes !== undefined;
        }
        if (this._nonStringTypeAttributes.has(kind)) {
            return true;
        }
        return false;
    }

    get haveString(): boolean {
        return this.have("string");
    }

    addNone(_attributes: TypeAttributes): void {
        // FIXME: Add them to all members?  Or add them to the union, which means we'd have
        // to change getMemberKinds() to also return the attributes for the union itself,
        // or add a new method that does that.
        this._lostTypeAttributes = true;
    }
    addAny(attributes: TypeAttributes): void {
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "any", attributes);
        this._lostTypeAttributes = true;
    }
    addNull(attributes: TypeAttributes): void {
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "null", attributes);
    }
    addBool(attributes: TypeAttributes): void {
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "bool", attributes);
    }
    addInteger(attributes: TypeAttributes): void {
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "integer", attributes);
    }
    addDouble(attributes: TypeAttributes): void {
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "double", attributes);
    }

    addStringType(transformation: Transformation | undefined, attributes: TypeAttributes): void {
        if (this._enumTypeAttributes !== undefined) {
            attributes = combineTypeAttributes(this._enumTypeAttributes, attributes);
        }
        this._stringTypeAttributes = setAttributes(this._stringTypeAttributes, transformation, attributes);
        // string overrides enum
        this._enumTypeAttributes = undefined;
        this.enumCaseMap = {};
        this.enumCases = [];
    }
    addArray(t: TArray, attributes: TypeAttributes): void {
        this.arrayData.push(t);
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "array", attributes);
    }
    addObject(t: TObject, attributes: TypeAttributes): void {
        this.objectData.push(t);
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "object", attributes);
    }

    addEnumCases(cases: OrderedMap<string, number>, attributes: TypeAttributes): void {
        if (this.have("string")) {
            this.addStringType(undefined, attributes);
            return;
        }
        if (this._enumTypeAttributes === undefined) {
            return panic("State machine screwed up");
        }

        cases.forEach((count, s) => {
            if (!Object.prototype.hasOwnProperty.call(this.enumCaseMap, s)) {
                this.enumCaseMap[s] = 0;
                this.enumCases.push(s);
            }
            this.enumCaseMap[s] += count;
        });

        this._enumTypeAttributes = combineTypeAttributes(this._enumTypeAttributes, attributes);
    }
    addEnumCase(s: string, count: number, attributes: TypeAttributes): void {
        this.addEnumCases(OrderedMap([[s, count] as [string, number]]), attributes);
    }

    getMemberKinds(): OrderedMap<TypeKind, [Transformation | undefined, TypeAttributes]> {
        let merged = this._nonStringTypeAttributes.map(ta => [undefined, ta] as [Transformation | undefined, TypeAttributes]);
        if (this._enumTypeAttributes !== undefined) {
            assert(this._stringTypeAttributes.isEmpty(), "State machine screwed up");
            if (this.enumCases.length > 0) {
                merged = merged.set("enum", [undefined, this._enumTypeAttributes]);
            } else {
                assert(this._enumTypeAttributes.size === 0, "How do we have enum type attributes but no cases?");
            }
        }
        if (this._stringTypeAttributes.size > 0) {
            assert(this._enumTypeAttributes === undefined, "State machine screwed up");
            const combinedAttributes = combineTypeAttributes(this._stringTypeAttributes.valueSeq().toArray());
            const transformations = this._stringTypeAttributes.keySeq().toSet();
            let transformation: Transformation | undefined;
            if (transformations.has(undefined)) {
                transformation = undefined;
            } else if (transformations.size === 1) {
                transformation = defined(transformations.first());
            } else {
                transformation = unionOfTransformations("string", transformations);
            }
            merged = merged.set("string", [transformation, combinedAttributes]);
        }

        if (merged.isEmpty()) {
            return OrderedMap([["none", [undefined, Map()]] as [TypeKind, [Transformation | undefined, TypeAttributes]]]);
        }

        if (this._nonStringTypeAttributes.has("any")) {
            assert(this._lostTypeAttributes, "This had to be set when we added 'any'");

            const allAttributes = combineTypeAttributes(merged.valueSeq().toArray().map(([_, ta]) => ta));
            return OrderedMap([["any", [undefined, allAttributes]] as [TypeKind, [Transformation | undefined, TypeAttributes]]]);
        }

        if (this._conflateNumbers && this.have("integer") && this.have("double")) {
            merged = moveAttributes(merged, "integer", "double");
        }
        if (this.have("map")) {
            merged = moveAttributes(merged, "map", "class");
        }
        return merged;
    }

    get lostTypeAttributes(): boolean {
        return this._lostTypeAttributes;
    }
}

class FauxUnion {
    getAttributes(): TypeAttributes {
        return emptyTypeAttributes;
    }
}

function attributesForTypes(types: Set<Type>): [OrderedMap<Type, TypeAttributes>, TypeAttributes] {
    let unionsForType: OrderedMap<Type, Set<UnionType | FauxUnion>> = OrderedMap();
    let typesForUnion: Map<UnionType | FauxUnion, Set<Type>> = Map();
    let unions: OrderedSet<UnionType> = OrderedSet();
    let unionsEquivalentToRoot: Set<UnionType> = Set();
    function traverse(t: Type, path: Set<UnionType | FauxUnion>, isEquivalentToRoot: boolean): void {
        if (t instanceof UnionType) {
            unions = unions.add(t);
            if (isEquivalentToRoot) {
                unionsEquivalentToRoot = unionsEquivalentToRoot.add(t);
            }

            path = path.add(t);
            isEquivalentToRoot = isEquivalentToRoot && t.members.size === 1;
            t.members.forEach(m => traverse(m, path, isEquivalentToRoot));
        } else {
            unionsForType = unionsForType.update(t, Set(), s => s.union(path));
            path.forEach(u => {
                typesForUnion = typesForUnion.update(u, Set(), s => s.add(t));
            });
        }
    }

    const rootPath = Set([new FauxUnion()]);
    types.forEach(t => traverse(t, rootPath, types.size === 1));

    const resultAttributes = unionsForType.map((unionForType, t) => {
        const singleAncestors = unionForType.filter(u => defined(typesForUnion.get(u)).size === 1);
        assert(singleAncestors.every(u => defined(typesForUnion.get(u)).has(t)), "We messed up bookkeeping");
        const inheritedAttributes = singleAncestors.toArray().map(u => u.getAttributes());
        return combineTypeAttributes([t.getAttributes()].concat(inheritedAttributes));
    });
    const unionAttributes = unions.toArray().map(u => {
        const t = typesForUnion.get(u);
        if (t !== undefined && t.size === 1) {
            return emptyTypeAttributes;
        }
        const attributes = u.getAttributes();
        if (unionsEquivalentToRoot.has(u)) {
            return attributes;
        }
        return makeTypeAttributesInferred(attributes);
    });
    return [resultAttributes, combineTypeAttributes(unionAttributes)];
}

// FIXME: Move this to UnifyClasses.ts?
export class TypeRefUnionAccumulator extends UnionAccumulator<TypeRef, TypeRef> {
    // There is a method analogous to this in the IntersectionAccumulator.  It might
    // make sense to find a common interface.
    private addType(t: Type, attributes: TypeAttributes): void {
        assert(t.transformation === undefined, "We don't support transformations in unions yet");
        matchTypeExhaustive(
            t,
            _noneType => this.addNone(attributes),
            _anyType => this.addAny(attributes),
            _nullType => this.addNull(attributes),
            _boolType => this.addBool(attributes),
            _integerType => this.addInteger(attributes),
            _doubleType => this.addDouble(attributes),
            stringType => {
                const enumCases = stringType.enumCases;
                if (enumCases === undefined) {
                    this.addStringType("string", attributes);
                } else {
                    this.addEnumCases(enumCases, attributes);
                }
            },
            arrayType => this.addArray(arrayType.items.typeRef, attributes),
            classType => this.addObject(classType.typeRef, attributes),
            mapType => this.addObject(mapType.typeRef, attributes),
            objectType => this.addObject(objectType.typeRef, attributes),
            // FIXME: We're not carrying counts, so this is not correct if we do enum
            // inference.  JSON Schema input uses this case, however, without enum
            // inference, which is fine, but still a bit ugly.
            enumType => this.addEnumCases(enumType.cases.toOrderedMap().map(_ => 1), attributes),
            _unionType => {
                return panic("The unions should have been eliminated in attributesForTypesInUnion");
            },
            _dateType => this.addStringType("date", attributes),
            _timeType => this.addStringType("time", attributes),
            _dateTimeType => this.addStringType("date-time", attributes)
        );
    }

    addTypes(types: Set<Type>): TypeAttributes {
        const [attributesMap, unionAttributes] = attributesForTypes(types);
        attributesMap.forEach((attributes, t) => this.addType(t, attributes));
        return unionAttributes;
    }
}

export abstract class UnionBuilder<TBuilder extends TypeBuilder, TArrayData, TObjectData> {
    constructor(protected readonly typeBuilder: TBuilder) {}

    protected abstract makeEnum(
        cases: string[],
        counts: { [name: string]: number },
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef;
    protected abstract makeObject(
        objects: TObjectData,
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef;
    protected abstract makeArray(
        arrays: TArrayData,
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef;

    private makeTypeOfKind(
        typeProvider: UnionTypeProvider<TArrayData, TObjectData>,
        kind: TypeKind,
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        switch (kind) {
            case "any":
            case "none":
            case "null":
            case "bool":
            case "double":
            case "integer":
            case "date":
            case "time":
            case "date-time":
                const t = this.typeBuilder.getPrimitiveType(kind, undefined, forwardingRef);
                this.typeBuilder.addAttributes(t, typeAttributes);
                return t;
            case "string":
                return this.typeBuilder.getStringType(typeAttributes, undefined, undefined, forwardingRef);
            case "enum":
                return this.makeEnum(typeProvider.enumCases, typeProvider.enumCaseMap, typeAttributes, forwardingRef);
            case "object":
                return this.makeObject(typeProvider.objectData, typeAttributes, forwardingRef);
            case "array":
                return this.makeArray(typeProvider.arrayData, typeAttributes, forwardingRef);
            default:
                if (
                    kind === "union" ||
                    kind === "class" ||
                    kind === "map" ||
                    kind === "intersection" ||
                    kind === "transformed"
                ) {
                    return panic(`getMemberKinds() shouldn't return ${kind}`);
                }
                return assertNever(kind);
        }
    }

    buildUnion(
        typeProvider: UnionTypeProvider<TArrayData, TObjectData>,
        unique: boolean,
        typeAttributes: TypeAttributes,
        forwardingRef?: TypeRef
    ): TypeRef {
        const kinds = typeProvider.getMemberKinds();

        if (typeProvider.lostTypeAttributes) {
            this.typeBuilder.setLostTypeAttributes();
        }

        if (kinds.size === 1) {
            const [[kind, memberAttributes]] = kinds.toArray();
            const allAttributes = combineTypeAttributes(typeAttributes, memberAttributes);
            const t = this.makeTypeOfKind(typeProvider, kind, allAttributes, forwardingRef);
            return t;
        }

        const union = unique
            ? this.typeBuilder.getUniqueUnionType(typeAttributes, undefined, undefined, forwardingRef)
            : undefined;

        const types: TypeRef[] = [];
        kinds.forEach((memberAttributes, kind) => {
            types.push(this.makeTypeOfKind(typeProvider, kind, memberAttributes, undefined));
        });
        const typesSet = OrderedSet(types);
        if (union !== undefined) {
            this.typeBuilder.setSetOperationMembers(union, typesSet);
            return union;
        } else {
            return this.typeBuilder.getUnionType(typeAttributes, typesSet, undefined, forwardingRef);
        }
    }
}
