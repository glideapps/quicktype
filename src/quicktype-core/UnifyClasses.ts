import { Type, ClassProperty, UnionType, ObjectType } from "./Type";
import { assertIsObject } from "./TypeUtils";
import { TypeBuilder } from "./TypeBuilder";
import { TypeLookerUp, GraphRewriteBuilder, BaseGraphRewriteBuilder } from "./GraphRewriting";
import { UnionBuilder, TypeRefUnionAccumulator } from "./UnionBuilder";
import { panic, assert, defined } from "./support/Support";
import { TypeAttributes, combineTypeAttributes, emptyTypeAttributes } from "./TypeAttributes";
import { iterableFirst, setUnionInto } from "./support/Containers";
import { TypeRef, derefTypeRef } from "./TypeGraph";

function getCliqueProperties(
    clique: ObjectType[],
    builder: TypeBuilder,
    makePropertyType: (types: ReadonlySet<Type>) => TypeRef
): [ReadonlyMap<string, ClassProperty>, TypeRef | undefined, boolean] {
    let lostTypeAttributes = false;
    let propertyNames = new Set<string>();
    for (const o of clique) {
        setUnionInto(propertyNames, o.getProperties().keys());
    }

    let properties = Array.from(propertyNames).map(name => [name, new Set(), false] as [string, Set<Type>, boolean]);
    let additionalProperties: Set<Type> | undefined = undefined;
    for (const o of clique) {
        let additional = o.getAdditionalProperties();
        if (additional !== undefined) {
            if (additionalProperties === undefined) {
                additionalProperties = new Set();
            }
            if (additional !== undefined) {
                additionalProperties.add(additional);
            }
        }

        for (let i = 0; i < properties.length; i++) {
            let [name, types, isOptional] = properties[i];
            const maybeProperty = o.getProperties().get(name);
            if (maybeProperty === undefined) {
                isOptional = true;
                if (additional !== undefined && additional.kind !== "any") {
                    types.add(additional);
                }
            } else {
                if (maybeProperty.isOptional) {
                    isOptional = true;
                }
                types.add(maybeProperty.type);
            }

            properties[i][2] = isOptional;
        }
    }

    const unifiedAdditionalProperties =
        additionalProperties === undefined ? undefined : makePropertyType(additionalProperties);

    const unifiedPropertiesArray = properties.map(([name, types, isOptional]) => {
        return [name, builder.makeClassProperty(makePropertyType(types), isOptional)] as [string, ClassProperty];
    });
    const unifiedProperties = new Map(unifiedPropertiesArray);

    return [unifiedProperties, unifiedAdditionalProperties, lostTypeAttributes];
}

function countProperties(
    clique: ObjectType[]
): { hasProperties: boolean; hasAdditionalProperties: boolean; hasNonAnyAdditionalProperties: boolean } {
    let hasProperties = false;
    let hasAdditionalProperties = false;
    let hasNonAnyAdditionalProperties = false;
    for (const o of clique) {
        if (o.getProperties().size > 0) {
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

export class UnifyUnionBuilder extends UnionBuilder<BaseGraphRewriteBuilder, TypeRef[], TypeRef[]> {
    constructor(
        typeBuilder: BaseGraphRewriteBuilder,
        private readonly _makeObjectTypes: boolean,
        private readonly _makeClassesFixed: boolean,
        private readonly _unifyTypes: (typesToUnify: TypeRef[]) => TypeRef
    ) {
        super(typeBuilder);
    }

    protected makeObject(
        objectRefs: TypeRef[],
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        const maybeTypeRef = this.typeBuilder.lookupTypeRefs(objectRefs, forwardingRef);
        if (maybeTypeRef !== undefined) {
            assert(
                forwardingRef === undefined || maybeTypeRef === forwardingRef,
                "The forwarding ref must be consumed"
            );
            this.typeBuilder.addAttributes(maybeTypeRef, typeAttributes);
            return maybeTypeRef;
        }

        const objectTypes = objectRefs.map(r => assertIsObject(derefTypeRef(r, this.typeBuilder)));
        const { hasProperties, hasAdditionalProperties, hasNonAnyAdditionalProperties } = countProperties(objectTypes);

        if (!this._makeObjectTypes && (hasNonAnyAdditionalProperties || (!hasProperties && hasAdditionalProperties))) {
            const propertyTypes = new Set<TypeRef>();
            for (const o of objectTypes) {
                setUnionInto(propertyTypes, Array.from(o.getProperties().values()).map(cp => cp.typeRef));
            }
            const additionalPropertyTypes = new Set(
                objectTypes
                    .filter(o => o.getAdditionalProperties() !== undefined)
                    .map(o => defined(o.getAdditionalProperties()).typeRef)
            );
            setUnionInto(propertyTypes, additionalPropertyTypes);
            return this.typeBuilder.getMapType(typeAttributes, this._unifyTypes(Array.from(propertyTypes)));
        } else {
            const [properties, additionalProperties, lostTypeAttributes] = getCliqueProperties(
                objectTypes,
                this.typeBuilder,
                types => {
                    assert(types.size > 0, "Property has no type");
                    return this._unifyTypes(Array.from(types).map(t => t.typeRef));
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
        const ref = this.typeBuilder.getArrayType(this._unifyTypes(arrays), forwardingRef);
        this.typeBuilder.addAttributes(ref, typeAttributes);
        return ref;
    }
}

export function unionBuilderForUnification<T extends Type>(
    typeBuilder: GraphRewriteBuilder<T>,
    makeObjectTypes: boolean,
    makeClassesFixed: boolean,
    conflateNumbers: boolean
): UnionBuilder<TypeBuilder & TypeLookerUp, TypeRef[], TypeRef[]> {
    return new UnifyUnionBuilder(typeBuilder, makeObjectTypes, makeClassesFixed, trefs =>
        unifyTypes(
            new Set(trefs.map(tref => derefTypeRef(tref, typeBuilder))),
            emptyTypeAttributes,
            typeBuilder,
            unionBuilderForUnification(typeBuilder, makeObjectTypes, makeClassesFixed, conflateNumbers),
            conflateNumbers
        )
    );
}

// FIXME: The UnionBuilder might end up not being used.
export function unifyTypes<T extends Type>(
    types: ReadonlySet<Type>,
    typeAttributes: TypeAttributes,
    typeBuilder: GraphRewriteBuilder<T>,
    unionBuilder: UnionBuilder<TypeBuilder & TypeLookerUp, TypeRef[], TypeRef[]>,
    conflateNumbers: boolean,
    maybeForwardingRef?: TypeRef
): TypeRef {
    if (types.size === 0) {
        return panic("Cannot unify empty set of types");
    } else if (types.size === 1) {
        const first = defined(iterableFirst(types));
        if (!(first instanceof UnionType)) {
            return typeBuilder.reconstituteTypeRef(first.typeRef, typeAttributes, maybeForwardingRef);
        }
    }

    const typeRefs = Array.from(types).map(t => t.typeRef);
    const maybeTypeRef = typeBuilder.lookupTypeRefs(typeRefs, maybeForwardingRef);
    if (maybeTypeRef !== undefined) {
        typeBuilder.addAttributes(maybeTypeRef, typeAttributes);
        return maybeTypeRef;
    }

    const accumulator = new TypeRefUnionAccumulator(conflateNumbers);
    const nestedAttributes = accumulator.addTypes(types);
    typeAttributes = combineTypeAttributes("union", typeAttributes, nestedAttributes);

    return typeBuilder.withForwardingRef(maybeForwardingRef, forwardingRef => {
        typeBuilder.registerUnion(typeRefs, forwardingRef);
        return unionBuilder.buildUnion(accumulator, false, typeAttributes, forwardingRef);
    });
}
