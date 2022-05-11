"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const UnionBuilder_1 = require("../UnionBuilder");
const Type_1 = require("../Type");
const TypeUtils_1 = require("../TypeUtils");
const Support_1 = require("../support/Support");
const TypeAttributes_1 = require("../attributes/TypeAttributes");
function canResolve(t) {
    const members = TypeUtils_1.setOperationMembersRecursively(t, undefined)[0];
    if (members.size <= 1)
        return true;
    return collection_utils_1.iterableEvery(members, m => !(m instanceof Type_1.UnionType) || m.isCanonical);
}
function attributesForTypes(types) {
    return collection_utils_1.mapMapEntries(types.entries(), t => [t.kind, t.getAttributes()]);
}
class IntersectionAccumulator {
    constructor() {
        this._primitiveAttributes = new Map();
        this._arrayAttributes = TypeAttributes_1.emptyTypeAttributes;
        // We start out with all object types allowed, which means
        // _additionalPropertyTypes is empty - no restrictions - and
        // _classProperties is empty - no defined properties so far.
        //
        // If _additionalPropertyTypes is undefined, no additional
        // properties are allowed anymore.  If _classProperties is
        // undefined, no object types are allowed, in which case
        // _additionalPropertyTypes must also be undefined;
        this._objectProperties = new Map();
        this._objectAttributes = TypeAttributes_1.emptyTypeAttributes;
        this._additionalPropertyTypes = new Set();
        this._lostTypeAttributes = false;
    }
    updatePrimitiveTypes(members) {
        const types = collection_utils_1.setFilter(members, t => Type_1.isPrimitiveTypeKind(t.kind));
        const attributes = attributesForTypes(types);
        collection_utils_1.mapMergeWithInto(this._primitiveAttributes, (a, b) => TypeAttributes_1.combineTypeAttributes("intersect", a, b), attributes);
        const kinds = collection_utils_1.setMap(types, t => t.kind);
        if (this._primitiveTypes === undefined) {
            this._primitiveTypes = new Set(kinds);
            return;
        }
        const haveNumber = collection_utils_1.iterableFind(this._primitiveTypes, Type_1.isNumberTypeKind) !== undefined &&
            collection_utils_1.iterableFind(kinds, Type_1.isNumberTypeKind) !== undefined;
        this._primitiveTypes = collection_utils_1.setIntersect(this._primitiveTypes, kinds);
        if (haveNumber && collection_utils_1.iterableFind(this._primitiveTypes, Type_1.isNumberTypeKind) === undefined) {
            // One set has integer, the other has double.  The intersection
            // of that is integer.
            this._primitiveTypes = this._primitiveTypes.add("integer");
        }
    }
    updateArrayItemTypes(members) {
        const maybeArray = collection_utils_1.iterableFind(members, t => t instanceof Type_1.ArrayType);
        if (maybeArray === undefined) {
            this._arrayItemTypes = false;
            return;
        }
        this._arrayAttributes = TypeAttributes_1.combineTypeAttributes("intersect", this._arrayAttributes, maybeArray.getAttributes());
        if (this._arrayItemTypes === undefined) {
            this._arrayItemTypes = new Set();
        }
        else if (this._arrayItemTypes !== false) {
            this._arrayItemTypes.add(maybeArray.items);
        }
    }
    updateObjectProperties(members) {
        const maybeObject = collection_utils_1.iterableFind(members, t => t instanceof Type_1.ObjectType);
        if (maybeObject === undefined) {
            this._objectProperties = undefined;
            this._additionalPropertyTypes = undefined;
            return;
        }
        this._objectAttributes = TypeAttributes_1.combineTypeAttributes("intersect", this._objectAttributes, maybeObject.getAttributes());
        const objectAdditionalProperties = maybeObject.getAdditionalProperties();
        if (this._objectProperties === undefined) {
            Support_1.assert(this._additionalPropertyTypes === undefined);
            return;
        }
        const allPropertyNames = collection_utils_1.setUnionInto(new Set(this._objectProperties.keys()), maybeObject.getProperties().keys());
        for (const name of allPropertyNames) {
            const existing = Support_1.defined(this._objectProperties).get(name);
            const newProperty = maybeObject.getProperties().get(name);
            if (existing !== undefined && newProperty !== undefined) {
                const cp = new Type_1.GenericClassProperty(existing.typeData.add(newProperty.type), existing.isOptional && newProperty.isOptional);
                Support_1.defined(this._objectProperties).set(name, cp);
            }
            else if (existing !== undefined && objectAdditionalProperties !== undefined) {
                const cp = new Type_1.GenericClassProperty(existing.typeData.add(objectAdditionalProperties), existing.isOptional);
                Support_1.defined(this._objectProperties).set(name, cp);
            }
            else if (existing !== undefined) {
                Support_1.defined(this._objectProperties).delete(name);
            }
            else if (newProperty !== undefined && this._additionalPropertyTypes !== undefined) {
                // FIXME: This is potentially slow
                const types = new Set(this._additionalPropertyTypes).add(newProperty.type);
                Support_1.defined(this._objectProperties).set(name, new Type_1.GenericClassProperty(types, newProperty.isOptional));
            }
            else if (newProperty !== undefined) {
                Support_1.defined(this._objectProperties).delete(name);
            }
            else {
                return Support_1.mustNotHappen();
            }
        }
        if (this._additionalPropertyTypes !== undefined && objectAdditionalProperties !== undefined) {
            this._additionalPropertyTypes.add(objectAdditionalProperties);
        }
        else if (this._additionalPropertyTypes !== undefined || objectAdditionalProperties !== undefined) {
            this._additionalPropertyTypes = undefined;
            this._lostTypeAttributes = true;
        }
    }
    addUnionSet(members) {
        this.updatePrimitiveTypes(members);
        this.updateArrayItemTypes(members);
        this.updateObjectProperties(members);
    }
    addType(t) {
        let attributes = t.getAttributes();
        TypeUtils_1.matchTypeExhaustive(t, _noneType => {
            return Support_1.panic("There shouldn't be a none type");
        }, _anyType => {
            return Support_1.panic("The any type should have been filtered out in setOperationMembersRecursively");
        }, nullType => this.addUnionSet([nullType]), boolType => this.addUnionSet([boolType]), integerType => this.addUnionSet([integerType]), doubleType => this.addUnionSet([doubleType]), stringType => this.addUnionSet([stringType]), arrayType => this.addUnionSet([arrayType]), _classType => Support_1.panic("We should never see class types in intersections"), _mapType => Support_1.panic("We should never see map types in intersections"), objectType => this.addUnionSet([objectType]), _enumType => Support_1.panic("We should never see enum types in intersections"), unionType => {
            attributes = TypeAttributes_1.combineTypeAttributes("intersect", [attributes].concat(Array.from(unionType.members).map(m => m.getAttributes())));
            this.addUnionSet(unionType.members);
        }, transformedStringType => this.addUnionSet([transformedStringType]));
        return TypeAttributes_1.makeTypeAttributesInferred(attributes);
    }
    get arrayData() {
        if (this._arrayItemTypes === undefined || this._arrayItemTypes === false) {
            return Support_1.panic("This should not be called if the type can't be an array");
        }
        return this._arrayItemTypes;
    }
    get objectData() {
        if (this._objectProperties === undefined) {
            Support_1.assert(this._additionalPropertyTypes === undefined);
            return undefined;
        }
        return [this._objectProperties, this._additionalPropertyTypes];
    }
    get enumCases() {
        return Support_1.panic("We don't support enums in intersections");
    }
    getMemberKinds() {
        const kinds = collection_utils_1.mapMap(Support_1.defined(this._primitiveTypes).entries(), k => Support_1.defined(this._primitiveAttributes.get(k)));
        const maybeDoubleAttributes = this._primitiveAttributes.get("double");
        // If double was eliminated, add its attributes to integer
        if (maybeDoubleAttributes !== undefined && !kinds.has("double") && kinds.has("integer")) {
            // FIXME: How can this ever happen???  Where do we "eliminate" double?
            collection_utils_1.mapUpdateInto(kinds, "integer", a => {
                return TypeAttributes_1.combineTypeAttributes("intersect", Support_1.defined(a), maybeDoubleAttributes);
            });
        }
        if (this._arrayItemTypes !== undefined && this._arrayItemTypes !== false) {
            kinds.set("array", this._arrayAttributes);
        }
        else if (this._arrayAttributes.size > 0) {
            this._lostTypeAttributes = true;
        }
        if (this._objectProperties !== undefined) {
            kinds.set("object", this._objectAttributes);
        }
        else if (this._objectAttributes.size > 0) {
            this._lostTypeAttributes = true;
        }
        return kinds;
    }
    get lostTypeAttributes() {
        return this._lostTypeAttributes;
    }
}
class IntersectionUnionBuilder extends UnionBuilder_1.UnionBuilder {
    constructor() {
        super(...arguments);
        this._createdNewIntersections = false;
    }
    makeIntersection(members, attributes) {
        const reconstitutedMembers = collection_utils_1.setMap(members, t => this.typeBuilder.reconstituteTypeRef(t.typeRef));
        const first = Support_1.defined(collection_utils_1.iterableFirst(reconstitutedMembers));
        if (reconstitutedMembers.size === 1) {
            this.typeBuilder.addAttributes(first, attributes);
            return first;
        }
        this._createdNewIntersections = true;
        return this.typeBuilder.getUniqueIntersectionType(attributes, reconstitutedMembers);
    }
    get createdNewIntersections() {
        return this._createdNewIntersections;
    }
    makeObject(maybeData, typeAttributes, forwardingRef) {
        if (maybeData === undefined) {
            return Support_1.panic("Either properties or additional properties must be given to make an object type");
        }
        const [propertyTypes, maybeAdditionalProperties] = maybeData;
        const properties = collection_utils_1.mapMap(propertyTypes, cp => this.typeBuilder.makeClassProperty(this.makeIntersection(cp.typeData, TypeAttributes_1.emptyTypeAttributes), cp.isOptional));
        const additionalProperties = maybeAdditionalProperties === undefined
            ? undefined
            : this.makeIntersection(maybeAdditionalProperties, TypeAttributes_1.emptyTypeAttributes);
        return this.typeBuilder.getUniqueObjectType(typeAttributes, properties, additionalProperties, forwardingRef);
    }
    makeArray(arrays, typeAttributes, forwardingRef) {
        // FIXME: attributes
        const itemsType = this.makeIntersection(arrays, TypeAttributes_1.emptyTypeAttributes);
        const tref = this.typeBuilder.getArrayType(typeAttributes, itemsType, forwardingRef);
        return tref;
    }
}
function resolveIntersections(graph, stringTypeMapping, debugPrintReconstitution) {
    let needsRepeat = false;
    function replace(types, builder, forwardingRef) {
        const intersections = collection_utils_1.setFilter(types, t => t instanceof Type_1.IntersectionType);
        const [members, intersectionAttributes] = TypeUtils_1.setOperationMembersRecursively(Array.from(intersections), "intersect");
        if (members.size === 0) {
            const t = builder.getPrimitiveType("any", intersectionAttributes, forwardingRef);
            return t;
        }
        if (members.size === 1) {
            return builder.reconstituteType(Support_1.defined(collection_utils_1.iterableFirst(members)), intersectionAttributes, forwardingRef);
        }
        const accumulator = new IntersectionAccumulator();
        const extraAttributes = TypeAttributes_1.makeTypeAttributesInferred(TypeAttributes_1.combineTypeAttributes("intersect", Array.from(members).map(t => accumulator.addType(t))));
        const attributes = TypeAttributes_1.combineTypeAttributes("intersect", intersectionAttributes, extraAttributes);
        const unionBuilder = new IntersectionUnionBuilder(builder);
        const tref = unionBuilder.buildUnion(accumulator, true, attributes, forwardingRef);
        if (unionBuilder.createdNewIntersections) {
            needsRepeat = true;
        }
        return tref;
    }
    // FIXME: We need to handle intersections that resolve to the same set of types.
    // See for example the intersections-nested.schema example.
    const allIntersections = collection_utils_1.setFilter(graph.allTypesUnordered(), t => t instanceof Type_1.IntersectionType);
    const resolvableIntersections = collection_utils_1.setFilter(allIntersections, canResolve);
    const groups = TypeUtils_1.makeGroupsToFlatten(resolvableIntersections, undefined);
    graph = graph.rewrite("resolve intersections", stringTypeMapping, false, groups, debugPrintReconstitution, replace);
    // console.log(`resolved ${resolvableIntersections.size} of ${intersections.size} intersections`);
    return [graph, !needsRepeat && allIntersections.size === resolvableIntersections.size];
}
exports.resolveIntersections = resolveIntersections;
