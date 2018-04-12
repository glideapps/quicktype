"use strict";

import { Set, OrderedMap, OrderedSet, Map } from "immutable";

import { Type, ClassProperty, UnionType, ObjectType, combineTypeAttributesOfTypes, assertIsObject } from "./Type";
import {
    TypeRef,
    UnionBuilder,
    TypeBuilder,
    TypeLookerUp,
    GraphRewriteBuilder,
    TypeRefUnionAccumulator
} from "./TypeBuilder";
import { panic, assert, defined, unionOfSets } from "./Support";
import { TypeNames, namesTypeAttributeKind } from "./TypeNames";
import { TypeAttributes, combineTypeAttributes, emptyTypeAttributes } from "./TypeAttributes";

function getCliqueProperties(
    clique: ObjectType[],
    makePropertyType: (attributes: TypeAttributes, types: OrderedSet<Type>) => TypeRef
): [OrderedMap<string, ClassProperty>, TypeRef | undefined, boolean] {
    let lostTypeAttributes = false;
    let propertyNames = OrderedSet<string>();
    for (const o of clique) {
        propertyNames = propertyNames.union(o.getProperties().keySeq());
    }

    let properties = propertyNames
        .toArray()
        .map(name => [name, OrderedSet(), false] as [string, OrderedSet<Type>, boolean]);
    let additionalProperties: OrderedSet<Type> | undefined = undefined;
    for (const o of clique) {
        let additional = o.getAdditionalProperties();
        if (additional !== undefined) {
            if (additionalProperties === undefined) {
                additionalProperties = OrderedSet();
            }
            if (additional !== undefined) {
                additionalProperties = additionalProperties.add(additional);
            }
        }

        for (let i = 0; i < properties.length; i++) {
            let [name, types, isOptional] = properties[i];
            const maybeProperty = o.getProperties().get(name);
            if (maybeProperty === undefined) {
                isOptional = true;
                if (additional !== undefined && additional.kind !== "any") {
                    types = types.add(additional);
                }
            } else {
                if (maybeProperty.isOptional) {
                    isOptional = true;
                }
                types = types.add(maybeProperty.type);
            }

            properties[i][1] = types;
            properties[i][2] = isOptional;
        }
    }

    const unifiedAdditionalProperties =
        additionalProperties === undefined
            ? undefined
            : makePropertyType(combineTypeAttributesOfTypes(additionalProperties), additionalProperties);

    const unifiedPropertiesArray = properties.map(([name, types, isOptional]) => {
        let attributes = combineTypeAttributesOfTypes(types);
        attributes = namesTypeAttributeKind.setDefaultInAttributes(attributes, () =>
            TypeNames.make(OrderedSet([name]), OrderedSet(), true)
        );
        return [name, new ClassProperty(makePropertyType(attributes, types), isOptional)] as [string, ClassProperty];
    });
    const unifiedProperties = OrderedMap(unifiedPropertiesArray);

    return [unifiedProperties, unifiedAdditionalProperties, lostTypeAttributes];
}

function countProperties(
    clique: ObjectType[]
): { hasProperties: boolean; hasAdditionalProperties: boolean; hasNonAnyAdditionalProperties: boolean } {
    let hasProperties = false;
    let hasAdditionalProperties = false;
    let hasNonAnyAdditionalProperties = false;
    for (const o of clique) {
        if (!o.getProperties().isEmpty()) {
            hasProperties = true;
        }
        const additional = o.getAdditionalProperties();
        if (additional !== undefined) {
            hasAdditionalProperties = true;
            if (additional.kind !== "any") {
                hasNonAnyAdditionalProperties = true;
            }
        }
    }
    return { hasProperties, hasAdditionalProperties, hasNonAnyAdditionalProperties };
}

export class UnifyUnionBuilder extends UnionBuilder<TypeBuilder & TypeLookerUp, TypeRef[], TypeRef[]> {
    constructor(
        typeBuilder: TypeBuilder & TypeLookerUp,
        private readonly _makeEnums: boolean,
        private readonly _makeObjectTypes: boolean,
        private readonly _makeClassesFixed: boolean,
        private readonly _unifyTypes: (typesToUnify: TypeRef[], typeAttributes: TypeAttributes) => TypeRef
    ) {
        super(typeBuilder);
    }

    protected makeEnum(
        enumCases: string[],
        counts: { [name: string]: number },
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        if (this._makeEnums) {
            return this.typeBuilder.getEnumType(typeAttributes, OrderedSet(enumCases), forwardingRef);
        } else {
            return this.typeBuilder.getStringType(typeAttributes, OrderedMap(counts), forwardingRef);
        }
    }

    protected makeObject(
        objectRefs: TypeRef[],
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        const maybeTypeRef = this.typeBuilder.lookupTypeRefs(objectRefs, forwardingRef);
        if (maybeTypeRef !== undefined) {
            this.typeBuilder.addAttributes(maybeTypeRef, typeAttributes);
            return maybeTypeRef;
        }

        const objectTypes = objectRefs.map(r => assertIsObject(r.deref()[0]));
        const { hasProperties, hasAdditionalProperties, hasNonAnyAdditionalProperties } = countProperties(objectTypes);

        if (!this._makeObjectTypes && (hasNonAnyAdditionalProperties || (!hasProperties && hasAdditionalProperties))) {
            const propertyTypes = unionOfSets(
                objectTypes.map(o =>
                    o
                        .getProperties()
                        .map(cp => cp.typeRef)
                        .toOrderedSet()
                )
            );
            const additionalPropertyTypes = OrderedSet(
                objectTypes
                    .filter(o => o.getAdditionalProperties() !== undefined)
                    .map(o => defined(o.getAdditionalProperties()).typeRef)
            );
            const allPropertyTypes = propertyTypes.union(additionalPropertyTypes).toArray();
            const tref = this.typeBuilder.getMapType(this._unifyTypes(allPropertyTypes, emptyTypeAttributes));
            this.typeBuilder.addAttributes(tref, typeAttributes);
            return tref;
        } else {
            const [properties, additionalProperties, lostTypeAttributes] = getCliqueProperties(
                objectTypes,
                (names, types) => {
                    assert(types.size > 0, "Property has no type");
                    return this._unifyTypes(types.map(t => t.typeRef).toArray(), names);
                }
            );
            if (lostTypeAttributes) {
                this.typeBuilder.setLostTypeAttributes();
            }
            if (this._makeObjectTypes) {
                return this.typeBuilder.getUniqueObjectType(
                    typeAttributes,
                    properties,
                    additionalProperties,
                    forwardingRef
                );
            } else {
                assert(additionalProperties === undefined, "We have additional properties but want to make a class");
                return this.typeBuilder.getUniqueClassType(
                    typeAttributes,
                    this._makeClassesFixed,
                    properties,
                    forwardingRef
                );
            }
        }
    }

    protected makeArray(
        arrays: TypeRef[],
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        const ref = this.typeBuilder.getArrayType(this._unifyTypes(arrays, Map()), forwardingRef);
        this.typeBuilder.addAttributes(ref, typeAttributes);
        return ref;
    }
}

export function unionBuilderForUnification<T extends Type>(
    typeBuilder: GraphRewriteBuilder<T>,
    makeEnums: boolean,
    makeObjectTypes: boolean,
    makeClassesFixed: boolean,
    conflateNumbers: boolean
): UnionBuilder<TypeBuilder & TypeLookerUp, TypeRef[], TypeRef[]> {
    return new UnifyUnionBuilder(typeBuilder, makeEnums, makeObjectTypes, makeClassesFixed, (trefs, names) =>
        unifyTypes(
            Set(trefs.map(tref => tref.deref()[0])),
            names,
            typeBuilder,
            unionBuilderForUnification(typeBuilder, makeEnums, makeObjectTypes, makeClassesFixed, conflateNumbers),
            conflateNumbers
        )
    );
}

// FIXME: The UnionBuilder might end up not being used.
export function unifyTypes<T extends Type>(
    types: Set<Type>,
    typeAttributes: TypeAttributes,
    typeBuilder: GraphRewriteBuilder<T>,
    unionBuilder: UnionBuilder<TypeBuilder & TypeLookerUp, TypeRef[], TypeRef[]>,
    conflateNumbers: boolean,
    maybeForwardingRef?: TypeRef
): TypeRef {
    if (types.isEmpty()) {
        return panic("Cannot unify empty set of types");
    } else if (types.count() === 1) {
        const first = defined(types.first());
        if (!(first instanceof UnionType)) {
            const tref = typeBuilder.reconstituteTypeRef(first.typeRef, maybeForwardingRef);
            typeBuilder.addAttributes(tref, typeAttributes);
            return tref;
        }
    }

    const typeRefs = types.toArray().map(t => t.typeRef);
    const maybeTypeRef = typeBuilder.lookupTypeRefs(typeRefs, maybeForwardingRef);
    if (maybeTypeRef !== undefined) {
        typeBuilder.addAttributes(maybeTypeRef, typeAttributes);
        return maybeTypeRef;
    }

    const accumulator = new TypeRefUnionAccumulator(conflateNumbers);
    const nestedAttributes = accumulator.addTypes(types);
    typeAttributes = combineTypeAttributes(typeAttributes, nestedAttributes);

    return typeBuilder.withForwardingRef(maybeForwardingRef, forwardingRef => {
        typeBuilder.registerUnion(typeRefs, forwardingRef);
        return unionBuilder.buildUnion(accumulator, false, typeAttributes, forwardingRef);
    });
}
