import { Map, Set, OrderedMap, OrderedSet } from "immutable";

import { TypeKind, PrimitiveStringTypeKind, Type, UnionType } from "./Type";
import { matchTypeExhaustive } from "./TypeUtils";
import {
    TypeAttributes,
    combineTypeAttributes,
    emptyTypeAttributes,
    makeTypeAttributesInferred
} from "./TypeAttributes";
import { defined, assert, panic, assertNever } from "./support/Support";
import { TypeRef, TypeBuilder } from "./TypeBuilder";
import { StringTypes, stringTypesTypeAttributeKind } from "./StringTypes";

// FIXME: This interface is badly designed.  All the properties
// should use immutable types, and getMemberKinds should be
// implementable using the interface, not be part of it.  That
// means we'll have to expose primitive types, too.
//
// Well, maybe getMemberKinds() is fine as it is.
export interface UnionTypeProvider<TArrayData, TObjectData> {
    readonly arrayData: TArrayData;
    readonly objectData: TObjectData;

    readonly enumCases: OrderedSet<string>;

    getMemberKinds(): TypeAttributeMap<TypeKind>;

    readonly lostTypeAttributes: boolean;
}

export type TypeAttributeMap<T extends TypeKind> = OrderedMap<T, TypeAttributes>;

function addAttributes(
    accumulatorAttributes: TypeAttributes | undefined,
    newAttributes: TypeAttributes
): TypeAttributes {
    if (accumulatorAttributes === undefined) return newAttributes;
    return combineTypeAttributes("union", accumulatorAttributes, newAttributes);
}

function setAttributes<T extends TypeKind>(
    attributeMap: TypeAttributeMap<T>,
    kind: T,
    newAttributes: TypeAttributes
): TypeAttributeMap<T> {
    return attributeMap.set(kind, addAttributes(attributeMap.get(kind), newAttributes));
}

function moveAttributes<T extends TypeKind>(map: TypeAttributeMap<T>, fromKind: T, toKind: T): TypeAttributeMap<T> {
    const fromAttributes = defined(map.get(fromKind));
    map = map.remove(fromKind);
    return setAttributes(map, toKind, fromAttributes);
}

export class UnionAccumulator<TArray, TObject> implements UnionTypeProvider<TArray[], TObject[]> {
    private _nonStringTypeAttributes: TypeAttributeMap<TypeKind> = OrderedMap();
    private _stringTypeAttributes: TypeAttributeMap<PrimitiveStringTypeKind> = OrderedMap();

    readonly arrayData: TArray[] = [];
    readonly objectData: TObject[] = [];

    private _enumCases: OrderedSet<string> = OrderedSet();

    private _lostTypeAttributes: boolean = false;

    constructor(private readonly _conflateNumbers: boolean) {}

    private have(kind: TypeKind): boolean {
        return (
            this._nonStringTypeAttributes.has(kind) || this._stringTypeAttributes.has(kind as PrimitiveStringTypeKind)
        );
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

    protected addFullStringType(attributes: TypeAttributes, stringTypes: StringTypes | undefined): void {
        if (stringTypes === undefined) {
            stringTypes = stringTypesTypeAttributeKind.tryGetInAttributes(attributes);
        } else {
            attributes = stringTypesTypeAttributeKind.combineInAttributes(attributes, stringTypes);
        }
        if (stringTypes === undefined) {
            stringTypes = StringTypes.unrestricted;
            attributes = stringTypesTypeAttributeKind.combineInAttributes(attributes, stringTypes);
        }

        const maybeEnumAttributes = this._nonStringTypeAttributes.get("enum");
        if (stringTypes.isRestricted) {
            assert(
                maybeEnumAttributes === undefined,
                "We can't add both an enum as well as a restricted string type to a union builder"
            );
        }

        this._stringTypeAttributes = setAttributes(this._stringTypeAttributes, "string", attributes);
    }

    addStringType(kind: PrimitiveStringTypeKind, attributes: TypeAttributes, stringTypes?: StringTypes): void {
        if (kind === "string") {
            this.addFullStringType(attributes, stringTypes);
            return;
        }
        if (stringTypes !== undefined) {
            attributes = stringTypesTypeAttributeKind.combineInAttributes(attributes, stringTypes);
        }
        this._stringTypeAttributes = setAttributes(this._stringTypeAttributes, kind, attributes);
    }

    addArray(t: TArray, attributes: TypeAttributes): void {
        this.arrayData.push(t);
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "array", attributes);
    }
    addObject(t: TObject, attributes: TypeAttributes): void {
        this.objectData.push(t);
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "object", attributes);
    }

    addEnum(cases: OrderedSet<string>, attributes: TypeAttributes): void {
        const maybeStringAttributes = this._stringTypeAttributes.get("string");
        if (maybeStringAttributes !== undefined) {
            assert(
                !defined(stringTypesTypeAttributeKind.tryGetInAttributes(maybeStringAttributes)).isRestricted,
                "We can't add an enum to a union builder that has a restricted string type"
            );
            this._stringTypeAttributes = setAttributes(this._stringTypeAttributes, "string", attributes);
            return;
        }
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "enum", attributes);
        this._enumCases = this._enumCases.union(cases);
    }

    addStringCases(cases: string[], attributes: TypeAttributes): void {
        this.addFullStringType(attributes, StringTypes.fromCases(cases));
    }
    addStringCase(s: string, count: number, attributes: TypeAttributes): void {
        this.addFullStringType(attributes, StringTypes.fromCase(s, count));
    }

    get enumCases(): OrderedSet<string> {
        return this._enumCases;
    }

    getMemberKinds(): TypeAttributeMap<TypeKind> {
        assert(!(this.have("enum") && this.have("string")), "We can't have both strings and enums in the same union");

        let merged = this._nonStringTypeAttributes.merge(this._stringTypeAttributes);

        if (merged.isEmpty()) {
            return OrderedMap([["none", Map()] as [TypeKind, TypeAttributes]]);
        }

        if (this._nonStringTypeAttributes.has("any")) {
            assert(this._lostTypeAttributes, "This had to be set when we added 'any'");

            const allAttributes = combineTypeAttributes("union", merged.valueSeq().toArray());
            return OrderedMap([["any", allAttributes] as [TypeKind, TypeAttributes]]);
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
        return combineTypeAttributes("union", [t.getAttributes()].concat(inheritedAttributes));
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
    return [resultAttributes, combineTypeAttributes("union", unionAttributes)];
}

// FIXME: Move this to UnifyClasses.ts?
export class TypeRefUnionAccumulator extends UnionAccumulator<TypeRef, TypeRef> {
    // There is a method analogous to this in the IntersectionAccumulator.  It might
    // make sense to find a common interface.
    private addType(t: Type, attributes: TypeAttributes): void {
        matchTypeExhaustive(
            t,
            _noneType => this.addNone(attributes),
            _anyType => this.addAny(attributes),
            _nullType => this.addNull(attributes),
            _boolType => this.addBool(attributes),
            _integerType => this.addInteger(attributes),
            _doubleType => this.addDouble(attributes),
            _stringType => this.addStringType("string", attributes),
            arrayType => this.addArray(arrayType.items.typeRef, attributes),
            classType => this.addObject(classType.typeRef, attributes),
            mapType => this.addObject(mapType.typeRef, attributes),
            objectType => this.addObject(objectType.typeRef, attributes),
            // FIXME: We're not carrying counts, so this is not correct if we do enum
            // inference.  JSON Schema input uses this case, however, without enum
            // inference, which is fine, but still a bit ugly.
            enumType => this.addEnum(enumType.cases, attributes),
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
                return this.typeBuilder.getPrimitiveType(kind, typeAttributes, forwardingRef);
            case "string":
                return this.typeBuilder.getStringType(typeAttributes, undefined, forwardingRef);
            case "enum":
                return this.typeBuilder.getEnumType(typeAttributes, typeProvider.enumCases, forwardingRef);
            case "object":
                return this.makeObject(typeProvider.objectData, typeAttributes, forwardingRef);
            case "array":
                return this.makeArray(typeProvider.arrayData, typeAttributes, forwardingRef);
            default:
                if (kind === "union" || kind === "class" || kind === "map" || kind === "intersection") {
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
            const allAttributes = combineTypeAttributes("union", typeAttributes, memberAttributes);
            const t = this.makeTypeOfKind(typeProvider, kind, allAttributes, forwardingRef);
            return t;
        }

        const union = unique
            ? this.typeBuilder.getUniqueUnionType(typeAttributes, undefined, forwardingRef)
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
            return this.typeBuilder.getUnionType(typeAttributes, typesSet, forwardingRef);
        }
    }
}
