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
    PrimitiveType,
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
            attributes = combineTypeAttributes([attributes, t.getAttributes()]);
            t.members.forEach(process);
        } else if (t.kind !== "any") {
            types.push(t);
        } else {
            attributes = combineTypeAttributes([attributes, t.getAttributes()]);
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

class IntersectionAccumulator
    implements
    UnionTypeProvider<
    OrderedSet<Type>,
    OrderedMap<string, GenericClassProperty<OrderedSet<Type>>> | undefined,
    OrderedSet<Type> | undefined
    > {
    private _primitiveStringTypes: OrderedSet<PrimitiveStringTypeKind> | undefined;
    private _otherPrimitiveTypes: OrderedSet<PrimitiveTypeKind> | undefined;
    private _enumCases: OrderedSet<string> | undefined;
    // * undefined: We haven't seen any types yet.
    // * OrderedSet: All types we've seen can be arrays.
    // * false: At least one of the types seen can't be an array.
    private _arrayItemTypes: OrderedSet<Type> | undefined | false;

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
    private _classProperties: OrderedMap<string, GenericClassProperty<OrderedSet<Type>>> | undefined;

    private updatePrimitiveStringTypes(members: OrderedSet<Type>): void {
        const types = members.filter(t => isPrimitiveStringTypeKind(t.kind));
        const kinds = types.map(t => t.kind) as OrderedSet<PrimitiveStringTypeKind>;
        if (this._primitiveStringTypes === undefined) {
            this._primitiveStringTypes = kinds;
            return;
        }

        if (members.find(t => t instanceof StringType) === undefined) {
            this._primitiveStringTypes = this._primitiveStringTypes.intersect(kinds);
        }
    }

    private updateOtherPrimitiveTypes(members: OrderedSet<Type>): void {
        const types = members.filter(t => isPrimitiveTypeKind(t.kind) && !isPrimitiveStringTypeKind(t.kind));
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
        if (members.find(t => t instanceof StringType) !== undefined) {
            return;
        }
        const newCases = OrderedSet<string>().union(
            ...members.map(t => (t instanceof EnumType ? t.cases : OrderedSet<string>())).toArray()
        );
        if (this._enumCases === undefined) {
            this._enumCases = newCases;
        } else {
            this._enumCases = this._enumCases.intersect(newCases);
        }
    }

    private updateArrayItemTypes(members: OrderedSet<Type>): void {
        if (this._arrayItemTypes === false) return;

        const maybeArray = members.find(t => t instanceof ArrayType) as ArrayType | undefined;
        if (maybeArray === undefined) {
            this._arrayItemTypes = false;
            return;
        }

        if (this._arrayItemTypes === undefined) {
            this._arrayItemTypes = OrderedSet();
        }
        this._arrayItemTypes = this._arrayItemTypes.add(maybeArray.items);
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
        }

        assert(
            this._mapValueTypes === undefined || this._classProperties === undefined,
            "We screwed up our sacred state machine."
        );
    }

    private addAny(_t: PrimitiveType): void {
        // "any" doesn't change the types at all
        // FIXME: just add attributes
    }

    private addUnionSet(members: OrderedSet<Type>): void {
        this.updatePrimitiveStringTypes(members);
        this.updateOtherPrimitiveTypes(members);
        this.updateEnumCases(members);
        this.updateArrayItemTypes(members);
        this.updateMapValueTypesAndClassProperties(members);
    }

    private addUnion(u: UnionType): void {
        this.addUnionSet(u.members);
    }

    addType(t: Type): TypeAttributes {
        // FIXME: We're very lazy here.  We're supposed to keep type
        // attributes separately for each type kind, but we collect
        // them all together and return them as attributes for the
        // overall result type.
        let attributes = t.getAttributes();
        matchTypeExhaustive<void>(
            t,
            _noneType => {
                return panic("There shouldn't be a none type");
            },
            anyType => this.addAny(anyType),
            nullType => this.addUnionSet(OrderedSet([nullType])),
            boolType => this.addUnionSet(OrderedSet([boolType])),
            integerType => this.addUnionSet(OrderedSet([integerType])),
            doubleType => this.addUnionSet(OrderedSet([doubleType])),
            stringType => this.addUnionSet(OrderedSet([stringType])),
            arrayType => this.addUnionSet(OrderedSet([arrayType])),
            classType => this.addUnionSet(OrderedSet([classType])),
            mapType => this.addUnionSet(OrderedSet([mapType])),
            enumType => this.addUnionSet(OrderedSet([enumType])),
            unionType => this.addUnion(unionType),
            dateType => this.addUnionSet(OrderedSet([dateType])),
            timeType => this.addUnionSet(OrderedSet([timeType])),
            dateTimeType => this.addUnionSet(OrderedSet([dateTimeType]))
        );
        return attributes;
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
        let kinds: OrderedSet<TypeKind> = defined(this._primitiveStringTypes).union(defined(this._otherPrimitiveTypes));
        if (this._enumCases !== undefined && this._enumCases.size > 0) {
            kinds = kinds.add("enum");
        }
        if (OrderedSet.isOrderedSet(this._arrayItemTypes)) {
            kinds = kinds.add("array");
        }
        if (this._mapValueTypes !== undefined) {
            kinds = kinds.add("map");
        } else if (this._classProperties !== undefined) {
            kinds = kinds.add("class");
        }
        return kinds.toOrderedMap().map(_ => emptyTypeAttributes);
    }

    get lostTypeAttributes(): boolean {
        return false;
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
            const tref = this.typeBuilder.getUniqueClassType(typeAttributes, true, undefined, forwardingRef);
            // FIXME: attributes
            const properties = maybeProperties.map(
                cp => new ClassProperty(this.makeIntersection(cp.typeData, Map()), cp.isOptional)
            );
            this.typeBuilder.setClassProperties(tref, properties);
            return tref;
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
            return builder.getPrimitiveType("any", forwardingRef);
        }
        if (members.size === 1) {
            const single = builder.reconstituteType(defined(members.first()), forwardingRef);
            builder.addAttributes(single, intersectionAttributes);
            return single;
        }

        const accumulator = new IntersectionAccumulator();
        const extraAttributes = makeTypeAttributesInferred(
            combineTypeAttributes(members.map(t => accumulator.addType(t)).toArray())
        );
        const attributes = combineTypeAttributes([intersectionAttributes, extraAttributes]);

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
    graph = graph.rewrite(stringTypeMapping, false, groups, replace);

    // console.log(`resolved ${resolvableIntersections.size} of ${intersections.size} intersections`);
    return [graph, !needsRepeat && intersections.size === resolvableIntersections.size];
}
