"use strict";

import { Set, OrderedSet, OrderedMap, Map } from "immutable";

import { TypeGraph } from "./TypeGraph";
import { StringTypeMapping, TypeRef, TypeBuilder } from "./TypeBuilder";
import { GraphRewriteBuilder, TypeLookerUp } from "./GraphRewriting";
import { UnionTypeProvider, UnionBuilder, TypeAttributeMap } from "./UnionBuilder";
import {
    IntersectionType,
    Type,
    ClassProperty,
    EnumType,
    UnionType,
    PrimitiveStringTypeKind,
    PrimitiveTypeKind,
    ArrayType,
    isPrimitiveStringTypeKind,
    isPrimitiveTypeKind,
    isNumberTypeKind,
    GenericClassProperty,
    TypeKind,
    ObjectType
} from "./Type";
import {
    setOperationMembersRecursively,
    matchTypeExhaustive,
    combineTypeAttributesOfTypes,
    makeGroupsToFlatten
} from "./TypeUtils";
import { assert, defined, panic, mustNotHappen } from "./Support";
import {
    combineTypeAttributes,
    TypeAttributes,
    emptyTypeAttributes,
    makeTypeAttributesInferred
} from "./TypeAttributes";

function canResolve(t: IntersectionType): boolean {
    const members = setOperationMembersRecursively(t)[0];
    if (members.size <= 1) return true;
    return members.every(m => !(m instanceof UnionType) || m.isCanonical);
}

function attributesForTypes<T extends TypeKind>(types: OrderedSet<Type>): TypeAttributeMap<T> {
    return types
        .toMap()
        .map(t => t.getAttributes())
        .mapKeys(t => t.kind) as Map<T, TypeAttributes>;
}

type PropertyMap = OrderedMap<string, GenericClassProperty<OrderedSet<Type>>>;

class IntersectionAccumulator
    implements UnionTypeProvider<OrderedSet<Type>, [PropertyMap, OrderedSet<Type> | undefined] | undefined> {
    private _primitiveStringTypes: OrderedSet<PrimitiveStringTypeKind> | undefined;
    private _primitiveStringAttributes: TypeAttributeMap<PrimitiveStringTypeKind> = OrderedMap();

    private _otherPrimitiveTypes: OrderedSet<PrimitiveTypeKind> | undefined;
    private _otherPrimitiveAttributes: TypeAttributeMap<PrimitiveTypeKind> = OrderedMap();

    private _enumCases: OrderedSet<string> | undefined;
    private _enumAttributes: TypeAttributes = emptyTypeAttributes;

    // * undefined: We haven't seen any types yet.
    // * OrderedSet: All types we've seen can be arrays.
    // * false: At least one of the types seen can't be an array.
    private _arrayItemTypes: OrderedSet<Type> | undefined | false;
    private _arrayAttributes: TypeAttributes = emptyTypeAttributes;

    // We start out with all object types allowed, which means
    // _additionalPropertyTypes is empty - no restrictions - and
    // _classProperties is empty - no defined properties so far.
    //
    // If _additionalPropertyTypes is undefined, no additional
    // properties are allowed anymore.  If _classProperties is
    // undefined, no object types are allowed, in which case
    // _additionalPropertyTypes must also be undefined;
    private _objectProperties: PropertyMap | undefined = OrderedMap();
    private _objectAttributes: TypeAttributes = emptyTypeAttributes;
    private _additionalPropertyTypes: OrderedSet<Type> | undefined = OrderedSet();

    private _lostTypeAttributes: boolean = false;

    private updatePrimitiveStringTypes(members: OrderedSet<Type>): void {
        const types = members.filter(t => isPrimitiveStringTypeKind(t.kind));
        const attributes = attributesForTypes<PrimitiveStringTypeKind>(types);
        this._primitiveStringAttributes = this._primitiveStringAttributes.mergeWith(combineTypeAttributes, attributes);

        const kinds = types.map(t => t.kind) as OrderedSet<PrimitiveStringTypeKind>;
        if (this._primitiveStringTypes === undefined) {
            this._primitiveStringTypes = kinds;
            return;
        }

        // If the unrestricted string type is part of the union, this doesn't add
        // any more restrictions.
        if (members.find(t => t.kind === "string") === undefined) {
            this._primitiveStringTypes = this._primitiveStringTypes.intersect(kinds);
        }
    }

    private updateOtherPrimitiveTypes(members: OrderedSet<Type>): void {
        const types = members.filter(t => isPrimitiveTypeKind(t.kind) && !isPrimitiveStringTypeKind(t.kind));
        const attributes = attributesForTypes<PrimitiveTypeKind>(types);
        this._otherPrimitiveAttributes = this._otherPrimitiveAttributes.mergeWith(combineTypeAttributes, attributes);

        const kinds = types.map(t => t.kind) as OrderedSet<PrimitiveStringTypeKind>;
        if (this._otherPrimitiveTypes === undefined) {
            this._otherPrimitiveTypes = kinds;
            return;
        }

        const haveNumber =
            this._otherPrimitiveTypes.find(isNumberTypeKind) !== undefined &&
            kinds.find(isNumberTypeKind) !== undefined;
        this._otherPrimitiveTypes = this._otherPrimitiveTypes.intersect(kinds);
        if (haveNumber && this._otherPrimitiveTypes.find(isNumberTypeKind) === undefined) {
            // One set has integer, the other has double.  The intersection
            // of that is integer.
            this._otherPrimitiveTypes = this._otherPrimitiveTypes.add("integer");
        }
    }

    private updateEnumCases(members: OrderedSet<Type>): void {
        const enums = members.filter(t => t instanceof EnumType) as OrderedSet<EnumType>;
        const attributes = combineTypeAttributesOfTypes(enums);
        this._enumAttributes = combineTypeAttributes(this._enumAttributes, attributes);
        if (members.find(t => t.kind === "string") !== undefined) {
            return;
        }
        const newCases = OrderedSet<string>().union(...enums.map(t => t.cases).toArray());
        if (this._enumCases === undefined) {
            this._enumCases = newCases;
        } else {
            this._enumCases = this._enumCases.intersect(newCases);
        }
    }

    private updateArrayItemTypes(members: OrderedSet<Type>): void {
        const maybeArray = members.find(t => t instanceof ArrayType) as ArrayType | undefined;
        if (maybeArray === undefined) {
            this._arrayItemTypes = false;
            return;
        }

        this._arrayAttributes = combineTypeAttributes(this._arrayAttributes, maybeArray.getAttributes());

        if (this._arrayItemTypes === undefined) {
            this._arrayItemTypes = OrderedSet();
        } else if (this._arrayItemTypes !== false) {
            this._arrayItemTypes = this._arrayItemTypes.add(maybeArray.items);
        }
    }

    private updateObjectProperties(members: OrderedSet<Type>): void {
        const maybeObject = members.find(t => t instanceof ObjectType) as ObjectType | undefined;
        if (maybeObject === undefined) {
            this._objectProperties = undefined;
            this._additionalPropertyTypes = undefined;
            return;
        }

        this._objectAttributes = combineTypeAttributes(this._objectAttributes, maybeObject.getAttributes());
        const objectAdditionalProperties = maybeObject.getAdditionalProperties();

        if (this._objectProperties === undefined) {
            assert(this._additionalPropertyTypes === undefined);
            return;
        }

        const allPropertyNames = this._objectProperties
            .keySeq()
            .toOrderedSet()
            .union(maybeObject.getProperties().keySeq());
        allPropertyNames.forEach(name => {
            const existing = defined(this._objectProperties).get(name);
            const newProperty = maybeObject.getProperties().get(name);

            if (existing !== undefined && newProperty !== undefined) {
                const cp = new GenericClassProperty(
                    existing.typeData.add(newProperty.type),
                    existing.isOptional && newProperty.isOptional
                );
                this._objectProperties = defined(this._objectProperties).set(name, cp);
            } else if (existing !== undefined && objectAdditionalProperties !== undefined) {
                const cp = new GenericClassProperty(
                    existing.typeData.add(objectAdditionalProperties),
                    existing.isOptional
                );
                this._objectProperties = defined(this._objectProperties).set(name, cp);
            } else if (existing !== undefined) {
                this._objectProperties = defined(this._objectProperties).remove(name);
            } else if (newProperty !== undefined && this._additionalPropertyTypes !== undefined) {
                const types = this._additionalPropertyTypes.add(newProperty.type);
                this._objectProperties = defined(this._objectProperties).set(
                    name,
                    new GenericClassProperty(types, newProperty.isOptional)
                );
            } else if (newProperty !== undefined) {
                this._objectProperties = defined(this._objectProperties).remove(name);
            } else {
                return mustNotHappen();
            }
        });

        if (this._additionalPropertyTypes !== undefined && objectAdditionalProperties !== undefined) {
            this._additionalPropertyTypes = this._additionalPropertyTypes.add(objectAdditionalProperties);
        } else if (this._additionalPropertyTypes !== undefined || objectAdditionalProperties !== undefined) {
            this._additionalPropertyTypes = undefined;
            this._lostTypeAttributes = true;
        }
    }

    private addUnionSet(members: OrderedSet<Type>): void {
        this.updatePrimitiveStringTypes(members);
        this.updateOtherPrimitiveTypes(members);
        this.updateEnumCases(members);
        this.updateArrayItemTypes(members);
        this.updateObjectProperties(members);
    }

    addType(t: Type): TypeAttributes {
        let attributes = t.getAttributes();
        matchTypeExhaustive<void>(
            t,
            _noneType => {
                return panic("There shouldn't be a none type");
            },
            _anyType => {
                return panic("The any type should have been filtered out in setOperationMembersRecursively");
            },
            nullType => this.addUnionSet(OrderedSet([nullType])),
            boolType => this.addUnionSet(OrderedSet([boolType])),
            integerType => this.addUnionSet(OrderedSet([integerType])),
            doubleType => this.addUnionSet(OrderedSet([doubleType])),
            stringType => this.addUnionSet(OrderedSet([stringType])),
            arrayType => this.addUnionSet(OrderedSet([arrayType])),
            _classType => panic("We should never see class types in intersections"),
            _mapType => panic("We should never see map types in intersections"),
            objectType => this.addUnionSet(OrderedSet([objectType])),
            enumType => this.addUnionSet(OrderedSet([enumType])),
            unionType => {
                attributes = combineTypeAttributes(
                    [attributes].concat(unionType.members.toArray().map(m => m.getAttributes()))
                );
                this.addUnionSet(unionType.members);
            },
            dateType => this.addUnionSet(OrderedSet([dateType])),
            timeType => this.addUnionSet(OrderedSet([timeType])),
            dateTimeType => this.addUnionSet(OrderedSet([dateTimeType]))
        );
        return makeTypeAttributesInferred(attributes);
    }

    get arrayData(): OrderedSet<Type> {
        if (this._arrayItemTypes === undefined || this._arrayItemTypes === false) {
            return panic("This should not be called if the type can't be an array");
        }
        return this._arrayItemTypes;
    }

    get objectData(): [PropertyMap, OrderedSet<Type> | undefined] | undefined {
        if (this._objectProperties === undefined) {
            assert(this._additionalPropertyTypes === undefined);
            return undefined;
        }

        return [this._objectProperties, this._additionalPropertyTypes];
    }

    get enumCases(): string[] {
        return defined(this._enumCases).toArray();
    }

    get enumCaseMap(): { [name: string]: number } {
        const caseMap: { [name: string]: number } = {};
        defined(this._enumCases).forEach(n => (caseMap[n] = 1));
        return caseMap;
    }

    getMemberKinds(): TypeAttributeMap<TypeKind> {
        let primitiveStringKinds = defined(this._primitiveStringTypes)
            .toOrderedMap()
            .map(k => defined(this._primitiveStringAttributes.get(k)));
        const maybeStringAttributes = this._primitiveStringAttributes.get("string");
        // If full string was eliminated, add its attribute to the other string types
        if (maybeStringAttributes !== undefined && !primitiveStringKinds.has("string")) {
            primitiveStringKinds = primitiveStringKinds.map(a => combineTypeAttributes(a, maybeStringAttributes));
        }

        let otherPrimitiveKinds = defined(this._otherPrimitiveTypes)
            .toOrderedMap()
            .map(k => defined(this._otherPrimitiveAttributes.get(k)));
        const maybeDoubleAttributes = this._otherPrimitiveAttributes.get("double");
        // If double was eliminated, add its attributes to integer
        if (maybeDoubleAttributes !== undefined && !otherPrimitiveKinds.has("double")) {
            otherPrimitiveKinds = otherPrimitiveKinds.map((a, k) => {
                if (k !== "integer") return a;
                return combineTypeAttributes(a, maybeDoubleAttributes);
            });
        }

        let kinds: TypeAttributeMap<TypeKind> = primitiveStringKinds.merge(otherPrimitiveKinds);

        if (this._enumCases !== undefined && this._enumCases.size > 0) {
            kinds = kinds.set("enum", this._enumAttributes);
        } else if (!this._enumAttributes.isEmpty()) {
            if (kinds.has("string")) {
                kinds = kinds.update("string", ta => combineTypeAttributes(ta, this._enumAttributes));
            } else {
                this._lostTypeAttributes = true;
            }
        }

        if (OrderedSet.isOrderedSet(this._arrayItemTypes)) {
            kinds = kinds.set("array", this._arrayAttributes);
        } else if (!this._arrayAttributes.isEmpty()) {
            this._lostTypeAttributes = true;
        }

        if (this._objectProperties !== undefined) {
            kinds = kinds.set("object", this._objectAttributes);
        } else if (!this._objectAttributes.isEmpty()) {
            this._lostTypeAttributes = true;
        }

        return kinds;
    }

    get lostTypeAttributes(): boolean {
        return this._lostTypeAttributes;
    }
}

class IntersectionUnionBuilder extends UnionBuilder<
    TypeBuilder & TypeLookerUp,
    OrderedSet<Type>,
    [PropertyMap, OrderedSet<Type> | undefined] | undefined
> {
    private _createdNewIntersections: boolean = false;

    private makeIntersection(members: OrderedSet<Type>, attributes: TypeAttributes): TypeRef {
        const reconstitutedMembers = members.map(t => this.typeBuilder.reconstituteTypeRef(t.typeRef));

        const first = defined(reconstitutedMembers.first());
        if (reconstitutedMembers.size === 1) {
            this.typeBuilder.addAttributes(first, attributes);
            return first;
        }

        this._createdNewIntersections = true;
        return this.typeBuilder.getUniqueIntersectionType(attributes, reconstitutedMembers);
    }

    get createdNewIntersections(): boolean {
        return this._createdNewIntersections;
    }

    protected makeObject(
        maybeData: [PropertyMap, OrderedSet<Type> | undefined] | undefined,
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        if (maybeData === undefined) {
            return panic("Either properties or additional properties must be given to make an object type");
        }

        const [propertyTypes, maybeAdditionalProperties] = maybeData;
        const properties = propertyTypes.map(
            cp => new ClassProperty(this.makeIntersection(cp.typeData, Map()), cp.isOptional)
        );
        const additionalProperties =
            maybeAdditionalProperties === undefined
                ? undefined
                : this.makeIntersection(maybeAdditionalProperties, emptyTypeAttributes);
        return this.typeBuilder.getUniqueObjectType(typeAttributes, properties, additionalProperties, forwardingRef);
    }

    protected makeArray(
        arrays: OrderedSet<Type>,
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        // FIXME: attributes
        const itemsType = this.makeIntersection(arrays, Map());
        const tref = this.typeBuilder.getArrayType(itemsType, forwardingRef);
        this.typeBuilder.addAttributes(tref, typeAttributes);
        return tref;
    }
}

export function resolveIntersections(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    debugPrintReconstitution: boolean
): [TypeGraph, boolean] {
    let needsRepeat = false;

    function replace(types: Set<Type>, builder: GraphRewriteBuilder<Type>, forwardingRef: TypeRef): TypeRef {
        const intersections = types.filter(t => t instanceof IntersectionType) as Set<IntersectionType>;
        const [members, intersectionAttributes] = setOperationMembersRecursively(intersections.toArray());
        if (members.isEmpty()) {
            const t = builder.getPrimitiveType("any", intersectionAttributes, forwardingRef);
            return t;
        }
        if (members.size === 1) {
            const single = builder.reconstituteType(defined(members.first()), forwardingRef);
            builder.addAttributes(single, intersectionAttributes);
            return single;
        }

        const accumulator = new IntersectionAccumulator();
        const extraAttributes = makeTypeAttributesInferred(
            combineTypeAttributes(members.toArray().map(t => accumulator.addType(t)))
        );
        const attributes = combineTypeAttributes(intersectionAttributes, extraAttributes);

        const unionBuilder = new IntersectionUnionBuilder(builder);
        const tref = unionBuilder.buildUnion(accumulator, true, attributes, forwardingRef);
        if (unionBuilder.createdNewIntersections) {
            needsRepeat = true;
        }
        return tref;
    }
    // FIXME: We need to handle intersections that resolve to the same set of types.
    // See for example the intersections-nested.schema example.
    const allIntersections = graph.allTypesUnordered().filter(t => t instanceof IntersectionType) as Set<
        IntersectionType
    >;
    const resolvableIntersections = allIntersections.filter(canResolve);
    const groups = makeGroupsToFlatten(resolvableIntersections, undefined);
    graph = graph.rewrite("resolve intersections", stringTypeMapping, false, groups, debugPrintReconstitution, replace);

    // console.log(`resolved ${resolvableIntersections.size} of ${intersections.size} intersections`);
    return [graph, !needsRepeat && allIntersections.size === resolvableIntersections.size];
}
