"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Type_1 = require("./Type");
const TypeGraph_1 = require("./TypeGraph");
const TypeAttributes_1 = require("./attributes/TypeAttributes");
const Support_1 = require("./support/Support");
const StringTypes_1 = require("./attributes/StringTypes");
// FIXME: Don't infer provenance.  All original types should be present in
// non-inferred form in the final graph.
class ProvenanceTypeAttributeKind extends TypeAttributes_1.TypeAttributeKind {
    constructor() {
        super("provenance");
    }
    appliesToTypeKind(_kind) {
        return true;
    }
    combine(arr) {
        return collection_utils_1.setUnionManyInto(new Set(), arr);
    }
    makeInferred(p) {
        return p;
    }
    stringify(p) {
        return Array.from(p)
            .sort()
            .map(i => i.toString())
            .join(",");
    }
}
exports.provenanceTypeAttributeKind = new ProvenanceTypeAttributeKind();
function stringTypeMappingGet(stm, kind) {
    const mapped = stm.get(kind);
    if (mapped === undefined)
        return "string";
    return mapped;
}
exports.stringTypeMappingGet = stringTypeMappingGet;
let noStringTypeMapping;
function getNoStringTypeMapping() {
    if (noStringTypeMapping === undefined) {
        noStringTypeMapping = new Map(Array.from(Type_1.transformedStringTypeKinds).map(k => [k, k]));
    }
    return noStringTypeMapping;
}
exports.getNoStringTypeMapping = getNoStringTypeMapping;
class TypeBuilder {
    constructor(typeGraphSerial, _stringTypeMapping, canonicalOrder, _allPropertiesOptional, _addProvenanceAttributes, inheritsProvenanceAttributes) {
        this._stringTypeMapping = _stringTypeMapping;
        this.canonicalOrder = canonicalOrder;
        this._allPropertiesOptional = _allPropertiesOptional;
        this._addProvenanceAttributes = _addProvenanceAttributes;
        this.topLevels = new Map();
        this.types = [];
        this.typeAttributes = [];
        this._addedForwardingIntersection = false;
        this._typeForIdentity = new collection_utils_1.EqualityMap();
        Support_1.assert(!_addProvenanceAttributes || !inheritsProvenanceAttributes, "We can't both inherit as well as add provenance");
        this.typeGraph = new TypeGraph_1.TypeGraph(this, typeGraphSerial, _addProvenanceAttributes || inheritsProvenanceAttributes);
    }
    addTopLevel(name, tref) {
        // assert(t.typeGraph === this.typeGraph, "Adding top-level to wrong type graph");
        Support_1.assert(!this.topLevels.has(name), "Trying to add top-level with existing name");
        Support_1.assert(this.types[TypeGraph_1.typeRefIndex(tref)] !== undefined, "Trying to add a top-level type that doesn't exist (yet?)");
        this.topLevels.set(name, tref);
    }
    reserveTypeRef() {
        const index = this.types.length;
        // console.log(`reserving ${index}`);
        this.types.push(undefined);
        const tref = TypeGraph_1.makeTypeRef(this.typeGraph, index);
        const attributes = this._addProvenanceAttributes
            ? exports.provenanceTypeAttributeKind.makeAttributes(new Set([index]))
            : TypeAttributes_1.emptyTypeAttributes;
        this.typeAttributes.push(attributes);
        return tref;
    }
    assertTypeRefGraph(tref) {
        if (tref === undefined)
            return;
        TypeGraph_1.assertTypeRefGraph(tref, this.typeGraph);
    }
    assertTypeRefSetGraph(trefs) {
        if (trefs === undefined)
            return;
        trefs.forEach(tref => this.assertTypeRefGraph(tref));
    }
    filterTypeAttributes(t, attributes) {
        const filtered = collection_utils_1.mapFilter(attributes, (_, k) => k.appliesToTypeKind(t.kind));
        if (attributes.size !== filtered.size) {
            this.setLostTypeAttributes();
        }
        return filtered;
    }
    commitType(tref, t) {
        this.assertTypeRefGraph(tref);
        const index = TypeGraph_1.typeRefIndex(tref);
        // const name = names !== undefined ? ` ${names.combinedName}` : "";
        // console.log(`committing ${t.kind}${name} to ${index}`);
        Support_1.assert(this.types[index] === undefined, "A type index was committed twice");
        this.types[index] = t;
        this.typeAttributes[index] = this.filterTypeAttributes(t, this.typeAttributes[index]);
    }
    addType(forwardingRef, creator, attributes) {
        if (forwardingRef !== undefined) {
            this.assertTypeRefGraph(forwardingRef);
            Support_1.assert(this.types[TypeGraph_1.typeRefIndex(forwardingRef)] === undefined);
        }
        const tref = forwardingRef !== undefined ? forwardingRef : this.reserveTypeRef();
        if (attributes !== undefined) {
            const index = TypeGraph_1.typeRefIndex(tref);
            this.typeAttributes[index] = TypeAttributes_1.combineTypeAttributes("union", this.typeAttributes[index], attributes);
        }
        const t = creator(tref);
        this.commitType(tref, t);
        return tref;
    }
    typeAtIndex(index) {
        const maybeType = this.types[index];
        if (maybeType === undefined) {
            return Support_1.panic("Trying to deref an undefined type in a type builder");
        }
        return maybeType;
    }
    atIndex(index) {
        const t = this.typeAtIndex(index);
        const attribtues = this.typeAttributes[index];
        return [t, attribtues];
    }
    addAttributes(tref, attributes) {
        this.assertTypeRefGraph(tref);
        const index = TypeGraph_1.typeRefIndex(tref);
        const existingAttributes = this.typeAttributes[index];
        Support_1.assert(collection_utils_1.iterableEvery(attributes, ([k, v]) => {
            if (!k.inIdentity)
                return true;
            const existing = existingAttributes.get(k);
            if (existing === undefined)
                return false;
            return collection_utils_1.areEqual(existing, v);
        }), "Can't add different identity type attributes to an existing type");
        const maybeType = this.types[index];
        if (maybeType !== undefined) {
            attributes = this.filterTypeAttributes(maybeType, attributes);
        }
        const nonIdentityAttributes = collection_utils_1.mapFilter(attributes, (_, k) => !k.inIdentity);
        this.typeAttributes[index] = TypeAttributes_1.combineTypeAttributes("union", existingAttributes, nonIdentityAttributes);
    }
    finish() {
        this.typeGraph.freeze(this.topLevels, this.types.map(Support_1.defined), this.typeAttributes);
        return this.typeGraph;
    }
    addForwardingIntersection(forwardingRef, tref) {
        this.assertTypeRefGraph(tref);
        this._addedForwardingIntersection = true;
        return this.addType(forwardingRef, tr => new Type_1.IntersectionType(tr, this.typeGraph, new Set([tref])), undefined);
    }
    forwardIfNecessary(forwardingRef, tref) {
        if (tref === undefined)
            return undefined;
        if (forwardingRef === undefined)
            return tref;
        return this.addForwardingIntersection(forwardingRef, tref);
    }
    get didAddForwardingIntersection() {
        return this._addedForwardingIntersection;
    }
    registerTypeForIdentity(identity, tref) {
        if (identity === undefined)
            return;
        this._typeForIdentity.set(identity, tref);
    }
    makeIdentity(maker) {
        return maker();
    }
    getOrAddType(identityMaker, creator, attributes, forwardingRef) {
        const identity = this.makeIdentity(identityMaker);
        let maybeTypeRef;
        if (identity === undefined) {
            maybeTypeRef = undefined;
        }
        else {
            maybeTypeRef = this._typeForIdentity.get(identity);
        }
        if (maybeTypeRef !== undefined) {
            const result = this.forwardIfNecessary(forwardingRef, maybeTypeRef);
            if (attributes !== undefined) {
                // We only add the attributes that are not in the identity, since
                // we found the type based on its identity, i.e. all the identity
                // attributes must be in there already, and we have a check that
                // asserts that no identity attributes are added later.
                this.addAttributes(result, collection_utils_1.mapFilter(attributes, (_, k) => !k.inIdentity));
            }
            return result;
        }
        const tref = this.addType(forwardingRef, creator, attributes);
        this.registerTypeForIdentity(identity, tref);
        return tref;
    }
    registerType(t) {
        this.registerTypeForIdentity(t.identity, t.typeRef);
    }
    getPrimitiveType(kind, maybeAttributes, forwardingRef) {
        const attributes = collection_utils_1.withDefault(maybeAttributes, TypeAttributes_1.emptyTypeAttributes);
        // FIXME: Why do date/time types need a StringTypes attribute?
        // FIXME: Remove this from here and put it into flattenStrings
        let stringTypes = kind === "string" ? undefined : StringTypes_1.StringTypes.unrestricted;
        if (Type_1.isPrimitiveStringTypeKind(kind) && kind !== "string") {
            kind = stringTypeMappingGet(this._stringTypeMapping, kind);
        }
        if (kind === "string") {
            return this.getStringType(attributes, stringTypes, forwardingRef);
        }
        return this.getOrAddType(() => Type_1.primitiveTypeIdentity(kind, attributes), tr => new Type_1.PrimitiveType(tr, this.typeGraph, kind), attributes, forwardingRef);
    }
    getStringType(attributes, stringTypes, forwardingRef) {
        const existingStringTypes = collection_utils_1.mapFind(attributes, (_, k) => k === StringTypes_1.stringTypesTypeAttributeKind);
        Support_1.assert((stringTypes === undefined) !== (existingStringTypes === undefined), "Must instantiate string type with one enum case attribute");
        if (existingStringTypes === undefined) {
            attributes = TypeAttributes_1.combineTypeAttributes("union", attributes, StringTypes_1.stringTypesTypeAttributeKind.makeAttributes(Support_1.defined(stringTypes)));
        }
        return this.getOrAddType(() => Type_1.primitiveTypeIdentity("string", attributes), tr => new Type_1.PrimitiveType(tr, this.typeGraph, "string"), attributes, forwardingRef);
    }
    getEnumType(attributes, cases, forwardingRef) {
        return this.getOrAddType(() => Type_1.enumTypeIdentity(attributes, cases), tr => new Type_1.EnumType(tr, this.typeGraph, cases), attributes, forwardingRef);
    }
    makeClassProperty(tref, isOptional) {
        return new Type_1.ClassProperty(tref, this.typeGraph, isOptional);
    }
    getUniqueObjectType(attributes, properties, additionalProperties, forwardingRef) {
        this.assertTypeRefGraph(additionalProperties);
        properties = collection_utils_1.definedMap(properties, p => this.modifyPropertiesIfNecessary(p));
        return this.addType(forwardingRef, tref => new Type_1.ObjectType(tref, this.typeGraph, "object", true, properties, additionalProperties), attributes);
    }
    getUniqueMapType(forwardingRef) {
        return this.addType(forwardingRef, tr => new Type_1.MapType(tr, this.typeGraph, undefined), undefined);
    }
    getMapType(attributes, values, forwardingRef) {
        this.assertTypeRefGraph(values);
        return this.getOrAddType(() => Type_1.mapTypeIdentify(attributes, values), tr => new Type_1.MapType(tr, this.typeGraph, values), attributes, forwardingRef);
    }
    setObjectProperties(ref, properties, additionalProperties) {
        this.assertTypeRefGraph(additionalProperties);
        const type = TypeGraph_1.derefTypeRef(ref, this.typeGraph);
        if (!(type instanceof Type_1.ObjectType)) {
            return Support_1.panic("Tried to set properties of non-object type");
        }
        type.setProperties(this.modifyPropertiesIfNecessary(properties), additionalProperties);
        this.registerType(type);
    }
    getUniqueArrayType(forwardingRef) {
        return this.addType(forwardingRef, tr => new Type_1.ArrayType(tr, this.typeGraph, undefined), undefined);
    }
    getArrayType(attributes, items, forwardingRef) {
        this.assertTypeRefGraph(items);
        return this.getOrAddType(() => Type_1.arrayTypeIdentity(attributes, items), tr => new Type_1.ArrayType(tr, this.typeGraph, items), attributes, forwardingRef);
    }
    setArrayItems(ref, items) {
        this.assertTypeRefGraph(items);
        const type = TypeGraph_1.derefTypeRef(ref, this.typeGraph);
        if (!(type instanceof Type_1.ArrayType)) {
            return Support_1.panic("Tried to set items of non-array type");
        }
        type.setItems(items);
        this.registerType(type);
    }
    modifyPropertiesIfNecessary(properties) {
        properties.forEach(p => this.assertTypeRefGraph(p.typeRef));
        if (this.canonicalOrder) {
            properties = collection_utils_1.mapSortByKey(properties);
        }
        if (this._allPropertiesOptional) {
            properties = collection_utils_1.mapMap(properties, cp => this.makeClassProperty(cp.typeRef, true));
        }
        return properties;
    }
    getClassType(attributes, properties, forwardingRef) {
        properties = this.modifyPropertiesIfNecessary(properties);
        return this.getOrAddType(() => Type_1.classTypeIdentity(attributes, properties), tr => new Type_1.ClassType(tr, this.typeGraph, false, properties), attributes, forwardingRef);
    }
    // FIXME: Maybe just distinguish between this and `getClassType`
    // via a flag?  That would make `ClassType.map` simpler.
    getUniqueClassType(attributes, isFixed, properties, forwardingRef) {
        properties = collection_utils_1.definedMap(properties, p => this.modifyPropertiesIfNecessary(p));
        return this.addType(forwardingRef, tref => new Type_1.ClassType(tref, this.typeGraph, isFixed, properties), attributes);
    }
    getUnionType(attributes, members, forwardingRef) {
        this.assertTypeRefSetGraph(members);
        return this.getOrAddType(() => Type_1.unionTypeIdentity(attributes, members), tr => new Type_1.UnionType(tr, this.typeGraph, members), attributes, forwardingRef);
    }
    // FIXME: why do we sometimes call this with defined members???
    getUniqueUnionType(attributes, members, forwardingRef) {
        this.assertTypeRefSetGraph(members);
        return this.addType(forwardingRef, tref => new Type_1.UnionType(tref, this.typeGraph, members), attributes);
    }
    getIntersectionType(attributes, members, forwardingRef) {
        this.assertTypeRefSetGraph(members);
        return this.getOrAddType(() => Type_1.intersectionTypeIdentity(attributes, members), tr => new Type_1.IntersectionType(tr, this.typeGraph, members), attributes, forwardingRef);
    }
    // FIXME: why do we sometimes call this with defined members???
    getUniqueIntersectionType(attributes, members, forwardingRef) {
        this.assertTypeRefSetGraph(members);
        return this.addType(forwardingRef, tref => new Type_1.IntersectionType(tref, this.typeGraph, members), attributes);
    }
    setSetOperationMembers(ref, members) {
        this.assertTypeRefSetGraph(members);
        const type = TypeGraph_1.derefTypeRef(ref, this.typeGraph);
        if (!(type instanceof Type_1.UnionType || type instanceof Type_1.IntersectionType)) {
            return Support_1.panic("Tried to set members of non-set-operation type");
        }
        type.setMembers(members);
        this.registerType(type);
    }
    setLostTypeAttributes() {
        return;
    }
}
exports.TypeBuilder = TypeBuilder;
