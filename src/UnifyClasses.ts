"use strict";

import { Set, OrderedMap, OrderedSet } from "immutable";

import { ClassType, Type, nonNullTypeCases, matchTypeExhaustive, assertIsClass } from "./Type";
import { TypeRef, UnionBuilder, TypeBuilder, TypeLookerUp } from "./TypeBuilder";
import { TypeNames, makeTypeNames, typeNamesUnion } from "./TypeNames";
import { panic, assert, defined } from "./Support";

function getCliqueProperties(
    clique: ClassType[],
    makePropertyType: (names: TypeNames, types: OrderedSet<Type>, isNullable: boolean) => TypeRef
): OrderedMap<string, TypeRef> {
    let properties = OrderedMap<string, [OrderedSet<Type>, number, boolean]>();
    for (const c of clique) {
        c.properties.forEach((t, name) => {
            let p = properties.get(name);
            if (p === undefined) {
                p = [OrderedSet(), 0, false];
                properties = properties.set(name, p);
            }
            p[1] += 1;
            p[0] = p[0].union(nonNullTypeCases(t));
            if (t.isNullable) {
                p[2] = true;
            }
        });
    }
    return properties.map(([types, count, haveNullable], name) => {
        assert(
            !types.some(t => t.isNullable || t.kind === "any"),
            "Nullable types are not allowed in non-nullable properties"
        );
        const isNullable = haveNullable || count < clique.length;
        const allNames = types.filter(t => t.hasNames).map(t => t.getNames());
        const typeNames = allNames.isEmpty() ? makeTypeNames(name, true) : typeNamesUnion(allNames);
        return makePropertyType(typeNames, types, isNullable);
    });
}

class UnifyUnionBuilder extends UnionBuilder<TypeBuilder & TypeLookerUp, TypeRef, TypeRef, TypeRef> {
    constructor(
        typeBuilder: TypeBuilder & TypeLookerUp,
        typeNames: TypeNames,
        private readonly _makeEnums: boolean,
        private readonly _makeClassesFixed: boolean,
        private readonly _unifyTypes: (typesToUnify: TypeRef[], typeNames: TypeNames) => TypeRef
    ) {
        super(typeBuilder, typeNames);
    }

    protected makeEnum(enumCases: string[], counts: { [name: string]: number }): TypeRef {
        if (this._makeEnums) {
            return this.typeBuilder.getEnumType(this.typeNames, OrderedSet(enumCases));
        } else {
            return this.typeBuilder.getStringType(this.typeNames, OrderedMap(counts));
        }
    }

    protected makeClass(classes: TypeRef[], maps: TypeRef[]): TypeRef {
        if (classes.length > 0 && maps.length > 0) {
            return panic("Cannot handle a class type that's also a map");
        }
        if (maps.length > 0) {
            return this.typeBuilder.getMapType(this._unifyTypes(maps, this.typeNames));
        }
        if (classes.length === 1) {
            return this.typeBuilder.lookupTypeRef(classes[0]);
        }
        const maybeTypeRef = this.typeBuilder.lookupTypeRefs(classes);
        if (maybeTypeRef !== undefined) {
            return maybeTypeRef;
        }

        const actualClasses: ClassType[] = classes.map(c => assertIsClass(c.deref()[0]));

        const properties = getCliqueProperties(actualClasses, (names, types, isNullable) => {
            if (types.size === 0) {
                assert(isNullable, "Property has no type");
                return this.typeBuilder.getPrimitiveType("null");
            }
            const tref = this._unifyTypes(types.map(t => t.typeRef).toArray(), names);
            if (isNullable) {
                return this.typeBuilder.makeNullable(tref, names);
            }
            return tref;
        });
        if (this._makeClassesFixed) {
            return this.typeBuilder.getUniqueClassType(this.typeNames, this._makeClassesFixed, properties);
        } else {
            return this.typeBuilder.getClassType(this.typeNames, properties);
        }
    }

    protected makeArray(arrays: TypeRef[]): TypeRef {
        return this.typeBuilder.getArrayType(this._unifyTypes(arrays, this.typeNames.singularize()));
    }
}

export function unifyTypes(
    types: Set<Type>,
    typeNames: TypeNames,
    typeBuilder: TypeBuilder & TypeLookerUp,
    makeEnums: boolean,
    makeClassesFixed: boolean
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

    const unionBuilder = new UnifyUnionBuilder(typeBuilder, typeNames, makeEnums, makeClassesFixed, (trefs, names) =>
        unifyTypes(Set(trefs.map(tref => tref.deref()[0])), names, typeBuilder, makeEnums, makeClassesFixed)
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
