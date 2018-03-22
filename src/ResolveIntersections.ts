"use strict";

import { Set, OrderedSet, OrderedMap, Map } from "immutable";

import { TypeGraph } from "./TypeGraph";
import {
    StringTypeMapping,
    GraphRewriteBuilder,
    TypeRef,
    UnionTypeProvider,
    UnionBuilder,
    TypeBuilder,
    TypeLookerUp,
    TypeAttributeMap
} from "./TypeBuilder";
import {
    IntersectionType,
    Type,
    ClassType,
    ClassProperty,
    EnumType,
    UnionType,
    PrimitiveStringTypeKind,
    PrimitiveTypeKind,
    StringType,
    ArrayType,
    matchTypeExhaustive,
    MapType,
    isPrimitiveStringTypeKind,
    isPrimitiveTypeKind,
    isNumberTypeKind,
    GenericClassProperty,
    TypeKind
} from "./Type";
import { assert, defined, panic } from "./Support";
import {
    combineTypeAttributes,
    TypeAttributes,
    emptyTypeAttributes,
    makeTypeAttributesInferred
} from "./TypeAttributes";

function intersectionMembersRecursively(intersection: IntersectionType): [OrderedSet<Type>, TypeAttributes] {
    const types: Type[] = [];
    let attributes = emptyTypeAttributes;
    function process(t: Type): void {
        if (t instanceof IntersectionType) {
            attributes = combineTypeAttributes(attributes, t.getAttributes());
            t.members.forEach(process);
        } else if (t.kind !== "any") {
            types.push(t);
        } else {
            attributes = combineTypeAttributes(attributes, t.getAttributes());
        }
    }
    process(intersection);
    return [OrderedSet(types), attributes];
}

function canResolve(t: IntersectionType): boolean {
    const members = intersectionMembersRecursively(t)[0];
    if (members.size <= 1) return true;
    return members.every(m => !(m instanceof UnionType) || m.isCanonical);
}

function attributesForTypes<T extends TypeKind>(types: OrderedSet<Type>): TypeAttributeMap<T> {
    return types
        .toMap()
        .map(t => t.getAttributes())
        .mapKeys(t => t.kind) as Map<T, TypeAttributes>;
}

class IntersectionAccumulator
    implements
        UnionTypeProvider<
            OrderedSet<Type>,
            OrderedMap<string, GenericClassProperty<OrderedSet<Type>>> | undefined,
            OrderedSet<Type> | undefined
        > {
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

    // We allow only either maps, classes, or neither.  States:
    //
    // 1. Start: No types seen yet, both are allowed, _mapValueTypes is
    //    the empty set, _classProperties is undefined.
    // 2. At least one type seen, all of them can be maps: _mapValueTypes
    //    is a non-empty set, _classProperties is undefined.
    // 3. All types seen can be maps or classes, at least one of them
    //    can only be a class: Maps are not allowed anymore, but classes
    //    are.  _mapValueTypes is undefined, _classProperties is defined.
    // 4. At least one type seen that can't be map or class: Neither map
    //    nor class is allowed anymore.  _mapValueTypes and _classProperties
    //    are both undefined.

    private _mapValueTypes: OrderedSet<Type> | undefined = OrderedSet();
    private _mapAttributes: TypeAttributes = emptyTypeAttributes;

    private _classProperties: OrderedMap<string, GenericClassProperty<OrderedSet<Type>>> | undefined;
    private _classAttributes: TypeAttributes = emptyTypeAttributes;

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
        if (members.find(t => t instanceof StringType) === undefined) {
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
        const attributes = combineTypeAttributes(enums.toArray().map(t => t.getAttributes()));
        this._enumAttributes = combineTypeAttributes(this._enumAttributes, attributes);
        if (members.find(t => t instanceof StringType) !== undefined) {
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

    private updateMapValueTypesAndClassProperties(members: OrderedSet<Type>): void {
        function makeProperties(): OrderedMap<string, GenericClassProperty<OrderedSet<Type>>> {
            if (maybeClass === undefined) return panic("Didn't we just check for this?");
            return maybeClass.properties.map(cp => new GenericClassProperty(OrderedSet([cp.type]), cp.isOptional));
        }

        const maybeClass = members.find(t => t instanceof ClassType) as ClassType | undefined;
        const maybeMap = members.find(t => t instanceof MapType) as MapType | undefined;
        assert(
            maybeClass === undefined || maybeMap === undefined,
            "Can't have both class and map type in a canonical union"
        );

        if (maybeClass !== undefined) {
            this._classAttributes = combineTypeAttributes(this._classAttributes, maybeClass.getAttributes());
        }
        if (maybeMap !== undefined) {
            this._mapAttributes = combineTypeAttributes(this._mapAttributes, maybeMap.getAttributes());
        }

        if (maybeMap === undefined && maybeClass === undefined) {
            // Moving to state 4.
            this._mapValueTypes = undefined;
            this._classProperties = undefined;
            return;
        }

        if (this._mapValueTypes !== undefined) {
            // We're in state 1 or 2.
            assert(this._classProperties === undefined, "One of _mapValueTypes and _classProperties must be undefined");

            if (maybeMap !== undefined) {
                // Moving to state 2.
                this._mapValueTypes = this._mapValueTypes.add(maybeMap.values);
            } else {
                // Moving to state 3.

                this._mapValueTypes = undefined;
                this._classProperties = makeProperties();
                this._lostTypeAttributes = true;
            }
        } else if (this._classProperties !== undefined) {
            // We're in state 3.
            if (maybeMap !== undefined) {
                this._classProperties = this._classProperties.map(
                    cp => new GenericClassProperty(cp.typeData.add(maybeMap.values), cp.isOptional)
                );
            } else {
                // Staying in state 3.
                if (maybeClass === undefined) return panic("Didn't we just check for this?");

                this._classProperties = this._classProperties.mergeWith(
                    (cp1, cp2) =>
                        new GenericClassProperty(cp1.typeData.union(cp2.typeData), cp1.isOptional || cp2.isOptional),
                    makeProperties()
                );
            }
        } else {
            // We're in state 4.  No way out of state 4.
            this._lostTypeAttributes = true;
        }

        assert(
            this._mapValueTypes === undefined || this._classProperties === undefined,
            "We screwed up our sacred state machine."
        );
    }

    private addUnionSet(members: OrderedSet<Type>): void {
        this.updatePrimitiveStringTypes(members);
        this.updateOtherPrimitiveTypes(members);
        this.updateEnumCases(members);
        this.updateArrayItemTypes(members);
        this.updateMapValueTypesAndClassProperties(members);
    }

    addType(t: Type): TypeAttributes {
        let attributes = t.getAttributes();
        matchTypeExhaustive<void>(
            t,
            _noneType => {
                return panic("There shouldn't be a none type");
            },
            _anyType => {
                return panic("The any type should have been filtered out in intersectionMembersRecursively");
            },
            nullType => this.addUnionSet(OrderedSet([nullType])),
            boolType => this.addUnionSet(OrderedSet([boolType])),
            integerType => this.addUnionSet(OrderedSet([integerType])),
            doubleType => this.addUnionSet(OrderedSet([doubleType])),
            stringType => this.addUnionSet(OrderedSet([stringType])),
            arrayType => this.addUnionSet(OrderedSet([arrayType])),
            classType => this.addUnionSet(OrderedSet([classType])),
            mapType => this.addUnionSet(OrderedSet([mapType])),
            _objectType => {
                return panic("FIXME: Implement support for object types");
            },
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

    get mapData(): OrderedSet<Type> | undefined {
        return this._mapValueTypes;
    }

    get classData(): OrderedMap<string, GenericClassProperty<OrderedSet<Type>>> | undefined {
        return this._classProperties;
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

        const objectAttributes = combineTypeAttributes(this._classAttributes, this._mapAttributes);
        if (this._mapValueTypes !== undefined) {
            kinds = kinds.set("map", objectAttributes);
        } else if (this._classProperties !== undefined) {
            kinds = kinds.set("class", objectAttributes);
        } else if (!objectAttributes.isEmpty()) {
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
    OrderedMap<string, GenericClassProperty<OrderedSet<Type>>> | undefined,
    OrderedSet<Type> | undefined
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

    protected makeEnum(
        cases: string[],
        _counts: { [name: string]: number },
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        return this.typeBuilder.getEnumType(typeAttributes, OrderedSet(cases), forwardingRef);
    }

    protected makeClass(
        maybeProperties: OrderedMap<string, GenericClassProperty<OrderedSet<Type>>> | undefined,
        maybeMapValueTypes: OrderedSet<Type> | undefined,
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        if (maybeProperties !== undefined) {
            assert(maybeMapValueTypes === undefined);
            // FIXME: attributes
            const properties = maybeProperties.map(
                cp => new ClassProperty(this.makeIntersection(cp.typeData, Map()), cp.isOptional)
            );
            return this.typeBuilder.getUniqueClassType(typeAttributes, true, properties, forwardingRef);
        } else if (maybeMapValueTypes !== undefined) {
            // FIXME: attributes
            const valuesType = this.makeIntersection(maybeMapValueTypes, Map());
            const mapType = this.typeBuilder.getMapType(valuesType, forwardingRef);
            this.typeBuilder.addAttributes(mapType, typeAttributes);
            return mapType;
        } else {
            return panic("Either classes or maps must be given");
        }
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

export function resolveIntersections(graph: TypeGraph, stringTypeMapping: StringTypeMapping): [TypeGraph, boolean] {
    let needsRepeat = false;

    function replace(
        types: Set<IntersectionType>,
        builder: GraphRewriteBuilder<IntersectionType>,
        forwardingRef: TypeRef
    ): TypeRef {
        assert(types.size === 1);
        const [members, intersectionAttributes] = intersectionMembersRecursively(defined(types.first()));
        if (members.isEmpty()) {
            const t = builder.getPrimitiveType("any", forwardingRef);
            builder.addAttributes(t, intersectionAttributes);
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
    const intersections = graph.allTypesUnordered().filter(t => t instanceof IntersectionType) as Set<IntersectionType>;
    if (intersections.isEmpty()) {
        return [graph, true];
    }
    const resolvableIntersections = intersections.filter(canResolve);
    if (resolvableIntersections.isEmpty()) {
        return [graph, false];
    }
    const groups = resolvableIntersections.map(i => [i]).toArray();
    graph = graph.rewrite("resolve intersections", stringTypeMapping, false, groups, replace);

    // console.log(`resolved ${resolvableIntersections.size} of ${intersections.size} intersections`);
    return [graph, !needsRepeat && intersections.size === resolvableIntersections.size];
}
