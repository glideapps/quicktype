"use strict";

import { Set, OrderedMap, OrderedSet, Map } from "immutable";

import { ClassType, Type, assertIsClass, ClassProperty, allTypeCases, UnionType } from "./Type";
import { TypeRef, UnionBuilder, TypeBuilder, TypeLookerUp, addTypeToUnionAccumulator } from "./TypeBuilder";
import { panic, assert, defined } from "./Support";
import { TypeNames, namesTypeAttributeKind } from "./TypeNames";
import { TypeAttributes, combineTypeAttributes } from "./TypeAttributes";

function getCliqueProperties(
    clique: ClassType[],
    makePropertyType: (attributes: TypeAttributes, types: OrderedSet<Type>) => TypeRef
): OrderedMap<string, ClassProperty> {
    let properties = OrderedMap<string, [OrderedSet<Type>, number, boolean]>();
    for (const c of clique) {
        c.properties.forEach((cp, name) => {
            let p = properties.get(name);
            if (p === undefined) {
                p = [OrderedSet(), 0, false];
                properties = properties.set(name, p);
            }
            p[1] += 1;
            p[0] = p[0].union(allTypeCases(cp.type));
            if (cp.isOptional) {
                p[2] = true;
            }
        });
    }
    return properties.map(([types, count, isOptional], name) => {
        isOptional = isOptional || count < clique.length;
        let attributes = combineTypeAttributes(types.map(t => t.getAttributes()).toArray());
        attributes = namesTypeAttributeKind.setDefaultInAttributes(
            attributes,
            () => new TypeNames(OrderedSet([name]), OrderedSet(), true)
        );
        return new ClassProperty(makePropertyType(attributes, types), isOptional);
    });
}

class UnifyUnionBuilder extends UnionBuilder<TypeBuilder & TypeLookerUp, TypeRef, TypeRef, TypeRef> {
    constructor(
        typeBuilder: TypeBuilder & TypeLookerUp,
        private readonly _makeEnums: boolean,
        private readonly _makeClassesFixed: boolean,
        conflateNumbers: boolean,
        private readonly _unifyTypes: (typesToUnify: TypeRef[], typeAttributes: TypeAttributes) => TypeRef
    ) {
        super(typeBuilder, conflateNumbers);
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

    protected makeClass(
        classes: TypeRef[],
        maps: TypeRef[],
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        if (maps.length > 0) {
            const propertyTypes = maps.slice();
            for (let classRef of classes) {
                const c = assertIsClass(classRef.deref()[0]);
                c.properties.forEach(cp => {
                    propertyTypes.push(cp.typeRef);
                });
            }
            const t = this.typeBuilder.getMapType(this._unifyTypes(propertyTypes, Map()), forwardingRef);
            this.typeBuilder.addAttributes(t, typeAttributes);
            return t;
        }
        if (classes.length === 1) {
            const t = this.typeBuilder.lookupTypeRef(classes[0]);
            this.typeBuilder.addAttributes(t, typeAttributes);
            return t;
        }
        const maybeTypeRef = this.typeBuilder.lookupTypeRefs(classes);
        if (maybeTypeRef !== undefined) {
            this.typeBuilder.addAttributes(maybeTypeRef, typeAttributes);
            return maybeTypeRef;
        }

        const actualClasses: ClassType[] = classes.map(c => assertIsClass(c.deref()[0]));

        let ref: TypeRef;
        ref = this.typeBuilder.getUniqueClassType(typeAttributes, this._makeClassesFixed, undefined, forwardingRef);

        const properties = getCliqueProperties(actualClasses, (names, types) => {
            assert(types.size > 0, "Property has no type");
            return this._unifyTypes(types.map(t => t.typeRef).toArray(), names);
        });

        this.typeBuilder.setClassProperties(ref, properties);

        return ref;
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

export function unifyTypes(
    types: Set<Type>,
    typeAttributes: TypeAttributes,
    typeBuilder: TypeBuilder & TypeLookerUp,
    makeEnums: boolean,
    makeClassesFixed: boolean,
    conflateNumbers: boolean,
    forwardingRef?: TypeRef
): TypeRef {
    if (types.isEmpty()) {
        return panic("Cannot unify empty set of types");
    } else if (types.count() === 1) {
        const first = defined(types.first());
        if (!(first instanceof UnionType)) {
            return typeBuilder.lookupTypeRef(first.typeRef);
        }
    }

    const maybeTypeRef = typeBuilder.lookupTypeRefs(types.toArray().map(t => t.typeRef));
    if (maybeTypeRef !== undefined) {
        return maybeTypeRef;
    }

    const unionBuilder = new UnifyUnionBuilder(
        typeBuilder,
        makeEnums,
        makeClassesFixed,
        conflateNumbers,
        (trefs, names) =>
            unifyTypes(
                Set(trefs.map(tref => tref.deref()[0])),
                names,
                typeBuilder,
                makeEnums,
                makeClassesFixed,
                conflateNumbers
            )
    );

    types.forEach(t => addTypeToUnionAccumulator(unionBuilder, t));

    return unionBuilder.buildUnion(false, typeAttributes, forwardingRef);
}
