"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Type_1 = require("./Type");
const TypeUtils_1 = require("./TypeUtils");
const UnionBuilder_1 = require("./UnionBuilder");
const Support_1 = require("./support/Support");
const TypeAttributes_1 = require("./attributes/TypeAttributes");
const TypeGraph_1 = require("./TypeGraph");
function getCliqueProperties(clique, builder, makePropertyType) {
    let lostTypeAttributes = false;
    let propertyNames = new Set();
    for (const o of clique) {
        collection_utils_1.setUnionInto(propertyNames, o.getProperties().keys());
    }
    let properties = Array.from(propertyNames).map(name => [name, new Set(), false]);
    let additionalProperties = undefined;
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
            }
            else {
                if (maybeProperty.isOptional) {
                    isOptional = true;
                }
                types.add(maybeProperty.type);
            }
            properties[i][2] = isOptional;
        }
    }
    const unifiedAdditionalProperties = additionalProperties === undefined ? undefined : makePropertyType(additionalProperties);
    const unifiedPropertiesArray = properties.map(([name, types, isOptional]) => {
        return [name, builder.makeClassProperty(makePropertyType(types), isOptional)];
    });
    const unifiedProperties = new Map(unifiedPropertiesArray);
    return [unifiedProperties, unifiedAdditionalProperties, lostTypeAttributes];
}
function countProperties(clique) {
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
class UnifyUnionBuilder extends UnionBuilder_1.UnionBuilder {
    constructor(typeBuilder, _makeObjectTypes, _makeClassesFixed, _unifyTypes) {
        super(typeBuilder);
        this._makeObjectTypes = _makeObjectTypes;
        this._makeClassesFixed = _makeClassesFixed;
        this._unifyTypes = _unifyTypes;
    }
    makeObject(objectRefs, typeAttributes, forwardingRef) {
        const maybeTypeRef = this.typeBuilder.lookupTypeRefs(objectRefs, forwardingRef);
        if (maybeTypeRef !== undefined) {
            Support_1.assert(forwardingRef === undefined || maybeTypeRef === forwardingRef, "The forwarding ref must be consumed");
            this.typeBuilder.addAttributes(maybeTypeRef, typeAttributes);
            return maybeTypeRef;
        }
        if (objectRefs.length === 1) {
            return this.typeBuilder.reconstituteTypeRef(objectRefs[0], typeAttributes, forwardingRef);
        }
        const objectTypes = objectRefs.map(r => TypeUtils_1.assertIsObject(TypeGraph_1.derefTypeRef(r, this.typeBuilder)));
        const { hasProperties, hasAdditionalProperties, hasNonAnyAdditionalProperties } = countProperties(objectTypes);
        if (!this._makeObjectTypes && (hasNonAnyAdditionalProperties || (!hasProperties && hasAdditionalProperties))) {
            const propertyTypes = new Set();
            for (const o of objectTypes) {
                collection_utils_1.setUnionInto(propertyTypes, Array.from(o.getProperties().values()).map(cp => cp.typeRef));
            }
            const additionalPropertyTypes = new Set(objectTypes
                .filter(o => o.getAdditionalProperties() !== undefined)
                .map(o => Support_1.defined(o.getAdditionalProperties()).typeRef));
            collection_utils_1.setUnionInto(propertyTypes, additionalPropertyTypes);
            return this.typeBuilder.getMapType(typeAttributes, this._unifyTypes(Array.from(propertyTypes)));
        }
        else {
            const [properties, additionalProperties, lostTypeAttributes] = getCliqueProperties(objectTypes, this.typeBuilder, types => {
                Support_1.assert(types.size > 0, "Property has no type");
                return this._unifyTypes(Array.from(types).map(t => t.typeRef));
            });
            if (lostTypeAttributes) {
                this.typeBuilder.setLostTypeAttributes();
            }
            if (this._makeObjectTypes) {
                return this.typeBuilder.getUniqueObjectType(typeAttributes, properties, additionalProperties, forwardingRef);
            }
            else {
                Support_1.assert(additionalProperties === undefined, "We have additional properties but want to make a class");
                return this.typeBuilder.getUniqueClassType(typeAttributes, this._makeClassesFixed, properties, forwardingRef);
            }
        }
    }
    makeArray(arrays, typeAttributes, forwardingRef) {
        const ref = this.typeBuilder.getArrayType(typeAttributes, this._unifyTypes(arrays), forwardingRef);
        return ref;
    }
}
exports.UnifyUnionBuilder = UnifyUnionBuilder;
function unionBuilderForUnification(typeBuilder, makeObjectTypes, makeClassesFixed, conflateNumbers) {
    return new UnifyUnionBuilder(typeBuilder, makeObjectTypes, makeClassesFixed, trefs => unifyTypes(new Set(trefs.map(tref => TypeGraph_1.derefTypeRef(tref, typeBuilder))), TypeAttributes_1.emptyTypeAttributes, typeBuilder, unionBuilderForUnification(typeBuilder, makeObjectTypes, makeClassesFixed, conflateNumbers), conflateNumbers));
}
exports.unionBuilderForUnification = unionBuilderForUnification;
// typeAttributes must not be reconstituted yet.
// FIXME: The UnionBuilder might end up not being used.
function unifyTypes(types, typeAttributes, typeBuilder, unionBuilder, conflateNumbers, maybeForwardingRef) {
    typeAttributes = typeBuilder.reconstituteTypeAttributes(typeAttributes);
    if (types.size === 0) {
        return Support_1.panic("Cannot unify empty set of types");
    }
    else if (types.size === 1) {
        const first = Support_1.defined(collection_utils_1.iterableFirst(types));
        if (!(first instanceof Type_1.UnionType)) {
            return typeBuilder.reconstituteTypeRef(first.typeRef, typeAttributes, maybeForwardingRef);
        }
    }
    const typeRefs = Array.from(types).map(t => t.typeRef);
    const maybeTypeRef = typeBuilder.lookupTypeRefs(typeRefs, maybeForwardingRef);
    if (maybeTypeRef !== undefined) {
        typeBuilder.addAttributes(maybeTypeRef, typeAttributes);
        return maybeTypeRef;
    }
    const accumulator = new UnionBuilder_1.TypeRefUnionAccumulator(conflateNumbers);
    const nestedAttributes = typeBuilder.reconstituteTypeAttributes(accumulator.addTypes(types));
    typeAttributes = TypeAttributes_1.combineTypeAttributes("union", typeAttributes, nestedAttributes);
    return typeBuilder.withForwardingRef(maybeForwardingRef, forwardingRef => {
        typeBuilder.registerUnion(typeRefs, forwardingRef);
        return unionBuilder.buildUnion(accumulator, false, typeAttributes, forwardingRef);
    });
}
exports.unifyTypes = unifyTypes;
