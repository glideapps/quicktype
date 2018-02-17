"use strict";

import { Set, OrderedMap, OrderedSet, Map } from "immutable";

import { ClassType, Type, matchTypeExhaustive, assertIsClass, ClassProperty, allTypeCases } from "./Type";
import { TypeRef, UnionBuilder, TypeBuilder, TypeLookerUp } from "./TypeBuilder";
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
        typeAttributes: TypeAttributes,
        private readonly _makeEnums: boolean,
        private readonly _makeClassesFixed: boolean,
        conflateNumbers: boolean,
        forwardingRef: TypeRef | undefined,
        private readonly _unifyTypes: (typesToUnify: TypeRef[], typeAttributes: TypeAttributes) => TypeRef
    ) {
        super(typeBuilder, typeAttributes, conflateNumbers, forwardingRef);
    }

    protected makeEnum(enumCases: string[], counts: { [name: string]: number }, typeAttributes: TypeAttributes, forwardingRef: TypeRef | undefined): TypeRef {
        if (this._makeEnums) {
            return this.typeBuilder.getEnumType(typeAttributes, OrderedSet(enumCases), forwardingRef);
        } else {
            return this.typeBuilder.getStringType(typeAttributes, OrderedMap(counts), forwardingRef);
        }
    }

    protected makeClass(classes: TypeRef[], maps: TypeRef[], typeAttributes: TypeAttributes, forwardingRef: TypeRef | undefined): TypeRef {
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
        ref = this.typeBuilder.getUniqueClassType(
            typeAttributes,
            this._makeClassesFixed,
            undefined,
            forwardingRef
        );

        const properties = getCliqueProperties(actualClasses, (names, types) => {
            assert(types.size > 0, "Property has no type");
            return this._unifyTypes(types.map(t => t.typeRef).toArray(), names);
        });

        this.typeBuilder.setClassProperties(ref, properties);

        return ref;
    }

    protected makeArray(arrays: TypeRef[], typeAttributes: TypeAttributes, forwardingRef: TypeRef | undefined): TypeRef {
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
        return typeBuilder.lookupTypeRef(defined(types.first()).typeRef);
    }

    const maybeTypeRef = typeBuilder.lookupTypeRefs(types.toArray().map(t => t.typeRef));
    if (maybeTypeRef !== undefined) {
        return maybeTypeRef;
    }

    const unionBuilder = new UnifyUnionBuilder(
        typeBuilder,
        typeAttributes,
        makeEnums,
        makeClassesFixed,
        conflateNumbers,
        forwardingRef,
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

    const addType = (t: Type): void => {
        matchTypeExhaustive(
            t,
            _noneType => {
                return;
            },
            _anyType => unionBuilder.addAny(),
            _nullType => unionBuilder.addNull(),
            _boolType => unionBuilder.addBool(),
            _integerType => unionBuilder.addInteger(),
            _doubleType => unionBuilder.addDouble(),
            stringType => {
                const enumCases = stringType.enumCases;
                if (enumCases === undefined) {
                    unionBuilder.addStringType("string");
                } else {
                    unionBuilder.addEnumCases(enumCases);
                }
            },
            arrayType => unionBuilder.addArray(arrayType.items.typeRef),
            classType => unionBuilder.addClass(classType.typeRef),
            mapType => unionBuilder.addMap(mapType.values.typeRef),
            // FIXME: We're not carrying counts, so this is not correct if we do enum
            // inference.  JSON Schema input uses this case, however, without enum
            // inference, which is fine, but still a bit ugly.
            enumType => enumType.cases.forEach(s => unionBuilder.addEnumCase(s)),
            unionType => unionType.members.forEach(addType),
            _dateType => unionBuilder.addStringType("date"),
            _timeType => unionBuilder.addStringType("time"),
            _dateTimeType => unionBuilder.addStringType("date-time")
        );
    };

    types.forEach(addType);

    return unionBuilder.buildUnion(false);
}
