"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnionType = exports.IntersectionType = exports.SetOperationType = exports.intersectionTypeIdentity = exports.unionTypeIdentity = exports.setOperationTypeIdentity = exports.setOperationCasesEqual = exports.EnumType = exports.enumTypeIdentity = exports.MapType = exports.ClassType = exports.ObjectType = exports.mapTypeIdentify = exports.classTypeIdentity = exports.ClassProperty = exports.GenericClassProperty = exports.ArrayType = exports.arrayTypeIdentity = exports.PrimitiveType = exports.primitiveTypeIdentity = exports.Type = exports.TypeIdentity = exports.isPrimitiveTypeKind = exports.isNumberTypeKind = exports.targetTypeKindForTransformedStringTypeKind = exports.isPrimitiveStringTypeKind = exports.transformedStringTypeKinds = exports.transformedStringTypeTargetTypeKindsMap = void 0;
const collection_utils_1 = require("collection-utils");
const Support_1 = require("./support/Support");
const TypeNames_1 = require("./attributes/TypeNames");
const Messages_1 = require("./Messages");
const TypeGraph_1 = require("./TypeGraph");
const URIAttributes_1 = require("./attributes/URIAttributes");
/**
 * All the transformed string type kinds and the JSON Schema formats and
 * primitive type kinds they map to.  Not all transformed string types map to
 * primitive types.  Date-time types, for example, stand on their own, but
 * stringified integers map to integers.
 */
const transformedStringTypeTargetTypeKinds = {
    date: { jsonSchema: "date", primitive: undefined },
    time: { jsonSchema: "time", primitive: undefined },
    "date-time": { jsonSchema: "date-time", primitive: undefined },
    uuid: { jsonSchema: "uuid", primitive: undefined },
    uri: { jsonSchema: "uri", primitive: undefined, attributesProducer: URIAttributes_1.uriInferenceAttributesProducer },
    "integer-string": { jsonSchema: "integer", primitive: "integer" },
    "bool-string": { jsonSchema: "boolean", primitive: "bool" }
};
exports.transformedStringTypeTargetTypeKindsMap = (0, collection_utils_1.mapFromObject)(transformedStringTypeTargetTypeKinds);
exports.transformedStringTypeKinds = new Set(Object.getOwnPropertyNames(transformedStringTypeTargetTypeKinds));
function isPrimitiveStringTypeKind(kind) {
    return kind === "string" || (0, collection_utils_1.hasOwnProperty)(transformedStringTypeTargetTypeKinds, kind);
}
exports.isPrimitiveStringTypeKind = isPrimitiveStringTypeKind;
function targetTypeKindForTransformedStringTypeKind(kind) {
    const target = exports.transformedStringTypeTargetTypeKindsMap.get(kind);
    if (target === undefined)
        return undefined;
    return target.primitive;
}
exports.targetTypeKindForTransformedStringTypeKind = targetTypeKindForTransformedStringTypeKind;
function isNumberTypeKind(kind) {
    return kind === "integer" || kind === "double";
}
exports.isNumberTypeKind = isNumberTypeKind;
function isPrimitiveTypeKind(kind) {
    if (isPrimitiveStringTypeKind(kind))
        return true;
    if (isNumberTypeKind(kind))
        return true;
    return kind === "none" || kind === "any" || kind === "null" || kind === "bool";
}
exports.isPrimitiveTypeKind = isPrimitiveTypeKind;
function triviallyStructurallyCompatible(x, y) {
    if (x.index === y.index)
        return true;
    if (x.kind === "none" || y.kind === "none")
        return true;
    return false;
}
class TypeIdentity {
    constructor(_kind, _components) {
        this._kind = _kind;
        this._components = _components;
        let h = collection_utils_1.hashCodeInit;
        h = (0, collection_utils_1.addHashCode)(h, (0, collection_utils_1.hashCodeOf)(this._kind));
        for (const c of _components) {
            h = (0, collection_utils_1.addHashCode)(h, (0, collection_utils_1.hashCodeOf)(c));
        }
        this._hashCode = h;
    }
    equals(other) {
        if (!(other instanceof TypeIdentity))
            return false;
        if (this._kind !== other._kind)
            return false;
        const n = this._components.length;
        (0, Support_1.assert)(n === other._components.length, "Components of a type kind's identity must have the same length");
        for (let i = 0; i < n; i++) {
            if (!(0, collection_utils_1.areEqual)(this._components[i], other._components[i]))
                return false;
        }
        return true;
    }
    hashCode() {
        return this._hashCode;
    }
}
exports.TypeIdentity = TypeIdentity;
class Type {
    constructor(typeRef, graph) {
        this.typeRef = typeRef;
        this.graph = graph;
    }
    get index() {
        return (0, TypeGraph_1.typeRefIndex)(this.typeRef);
    }
    getChildren() {
        let result = this.getNonAttributeChildren();
        for (const [k, v] of this.getAttributes()) {
            if (k.children === undefined)
                continue;
            (0, collection_utils_1.setUnionInto)(result, k.children(v));
        }
        return result;
    }
    getAttributes() {
        return (0, TypeGraph_1.attributesForTypeRef)(this.typeRef, this.graph);
    }
    get hasNames() {
        return TypeNames_1.namesTypeAttributeKind.tryGetInAttributes(this.getAttributes()) !== undefined;
    }
    getNames() {
        return (0, Support_1.defined)(TypeNames_1.namesTypeAttributeKind.tryGetInAttributes(this.getAttributes()));
    }
    getCombinedName() {
        return this.getNames().combinedName;
    }
    get debugPrintKind() {
        return this.kind;
    }
    equals(other) {
        if (!(other instanceof Type))
            return false;
        return this.typeRef === other.typeRef;
    }
    hashCode() {
        return (0, collection_utils_1.hashCodeOf)(this.typeRef);
    }
    structurallyCompatible(other, conflateNumbers = false) {
        function kindsCompatible(kind1, kind2) {
            if (kind1 === kind2)
                return true;
            if (!conflateNumbers)
                return false;
            if (kind1 === "integer")
                return kind2 === "double";
            if (kind1 === "double")
                return kind2 === "integer";
            return false;
        }
        if (triviallyStructurallyCompatible(this, other))
            return true;
        if (!kindsCompatible(this.kind, other.kind))
            return false;
        const workList = [[this, other]];
        // This contains a set of pairs which are the type pairs
        // we have already determined to be equal.  We can't just
        // do comparison recursively because types can have cycles.
        const done = [];
        let failed;
        const queue = (x, y) => {
            if (triviallyStructurallyCompatible(x, y))
                return true;
            if (!kindsCompatible(x.kind, y.kind)) {
                failed = true;
                return false;
            }
            workList.push([x, y]);
            return true;
        };
        while (workList.length > 0) {
            let [a, b] = (0, Support_1.defined)(workList.pop());
            if (a.index > b.index) {
                [a, b] = [b, a];
            }
            if (!a.isPrimitive()) {
                let ai = a.index;
                let bi = b.index;
                let found = false;
                for (const [dai, dbi] of done) {
                    if (dai === ai && dbi === bi) {
                        found = true;
                        break;
                    }
                }
                if (found)
                    continue;
                done.push([ai, bi]);
            }
            failed = false;
            if (!a.structuralEqualityStep(b, conflateNumbers, queue))
                return false;
            if (failed)
                return false;
        }
        return true;
    }
    getParentTypes() {
        return this.graph.getParentsOfType(this);
    }
    getAncestorsNotInSet(set) {
        const workList = [this];
        const processed = new Set();
        const ancestors = new Set();
        for (;;) {
            const t = workList.pop();
            if (t === undefined)
                break;
            const parents = t.getParentTypes();
            console.log(`${parents.size} parents`);
            for (const p of parents) {
                if (processed.has(p))
                    continue;
                processed.add(p);
                if (set.has(p.typeRef)) {
                    console.log(`adding ${p.kind}`);
                    workList.push(p);
                }
                else {
                    console.log(`found ${p.kind}`);
                    ancestors.add(p);
                }
            }
        }
        return ancestors;
    }
}
exports.Type = Type;
function hasUniqueIdentityAttributes(attributes) {
    return (0, collection_utils_1.mapSome)(attributes, (v, ta) => ta.requiresUniqueIdentity(v));
}
function identityAttributes(attributes) {
    return (0, collection_utils_1.mapFilter)(attributes, (_, kind) => kind.inIdentity);
}
function primitiveTypeIdentity(kind, attributes) {
    if (hasUniqueIdentityAttributes(attributes))
        return undefined;
    return new TypeIdentity(kind, [identityAttributes(attributes)]);
}
exports.primitiveTypeIdentity = primitiveTypeIdentity;
class PrimitiveType extends Type {
    constructor(typeRef, graph, kind) {
        super(typeRef, graph);
        this.kind = kind;
    }
    get isNullable() {
        return this.kind === "null" || this.kind === "any" || this.kind === "none";
    }
    isPrimitive() {
        return true;
    }
    getNonAttributeChildren() {
        return new Set();
    }
    get identity() {
        return primitiveTypeIdentity(this.kind, this.getAttributes());
    }
    reconstitute(builder) {
        builder.getPrimitiveType(this.kind);
    }
    structuralEqualityStep(_other, _conflateNumbers, _queue) {
        return true;
    }
}
exports.PrimitiveType = PrimitiveType;
function arrayTypeIdentity(attributes, itemsRef) {
    if (hasUniqueIdentityAttributes(attributes))
        return undefined;
    return new TypeIdentity("array", [identityAttributes(attributes), itemsRef]);
}
exports.arrayTypeIdentity = arrayTypeIdentity;
class ArrayType extends Type {
    constructor(typeRef, graph, _itemsRef) {
        super(typeRef, graph);
        this._itemsRef = _itemsRef;
        this.kind = "array";
    }
    setItems(itemsRef) {
        if (this._itemsRef !== undefined) {
            return (0, Support_1.panic)("Can only set array items once");
        }
        this._itemsRef = itemsRef;
    }
    getItemsRef() {
        if (this._itemsRef === undefined) {
            return (0, Support_1.panic)("Array items accessed before they were set");
        }
        return this._itemsRef;
    }
    get items() {
        return (0, TypeGraph_1.derefTypeRef)(this.getItemsRef(), this.graph);
    }
    getNonAttributeChildren() {
        return new Set([this.items]);
    }
    get isNullable() {
        return false;
    }
    isPrimitive() {
        return false;
    }
    get identity() {
        return arrayTypeIdentity(this.getAttributes(), this.getItemsRef());
    }
    reconstitute(builder) {
        const itemsRef = this.getItemsRef();
        const maybeItems = builder.lookup(itemsRef);
        if (maybeItems === undefined) {
            builder.getUniqueArrayType();
            builder.setArrayItems(builder.reconstitute(this.getItemsRef()));
        }
        else {
            builder.getArrayType(maybeItems);
        }
    }
    structuralEqualityStep(other, _conflateNumbers, queue) {
        return queue(this.items, other.items);
    }
}
exports.ArrayType = ArrayType;
class GenericClassProperty {
    constructor(typeData, isOptional) {
        this.typeData = typeData;
        this.isOptional = isOptional;
    }
    equals(other) {
        if (!(other instanceof GenericClassProperty)) {
            return false;
        }
        return (0, collection_utils_1.areEqual)(this.typeData, other.typeData) && this.isOptional === other.isOptional;
    }
    hashCode() {
        return (0, collection_utils_1.hashCodeOf)(this.typeData) + (this.isOptional ? 17 : 23);
    }
}
exports.GenericClassProperty = GenericClassProperty;
class ClassProperty extends GenericClassProperty {
    constructor(typeRef, graph, isOptional) {
        super(typeRef, isOptional);
        this.graph = graph;
    }
    get typeRef() {
        return this.typeData;
    }
    get type() {
        return (0, TypeGraph_1.derefTypeRef)(this.typeRef, this.graph);
    }
}
exports.ClassProperty = ClassProperty;
function objectTypeIdentify(kind, attributes, properties, additionalPropertiesRef) {
    if (hasUniqueIdentityAttributes(attributes))
        return undefined;
    return new TypeIdentity(kind, [identityAttributes(attributes), properties, additionalPropertiesRef]);
}
function classTypeIdentity(attributes, properties) {
    return objectTypeIdentify("class", attributes, properties, undefined);
}
exports.classTypeIdentity = classTypeIdentity;
function mapTypeIdentify(attributes, additionalPropertiesRef) {
    return objectTypeIdentify("map", attributes, new Map(), additionalPropertiesRef);
}
exports.mapTypeIdentify = mapTypeIdentify;
class ObjectType extends Type {
    constructor(typeRef, graph, kind, isFixed, _properties, _additionalPropertiesRef) {
        super(typeRef, graph);
        this.kind = kind;
        this.isFixed = isFixed;
        this._properties = _properties;
        this._additionalPropertiesRef = _additionalPropertiesRef;
        if (kind === "map") {
            if (_properties !== undefined) {
                (0, Support_1.assert)(_properties.size === 0);
            }
            (0, Support_1.assert)(!isFixed);
        }
        else if (kind === "class") {
            (0, Support_1.assert)(_additionalPropertiesRef === undefined);
        }
        else {
            (0, Support_1.assert)(isFixed);
        }
    }
    setProperties(properties, additionalPropertiesRef) {
        (0, Support_1.assert)(this._properties === undefined, "Tried to set object properties twice");
        if (this instanceof MapType) {
            (0, Support_1.assert)(properties.size === 0, "Cannot set properties on map type");
        }
        if (this instanceof ClassType) {
            (0, Support_1.assert)(additionalPropertiesRef === undefined, "Cannot set additional properties of class type");
        }
        this._properties = properties;
        this._additionalPropertiesRef = additionalPropertiesRef;
    }
    getProperties() {
        return (0, Support_1.defined)(this._properties);
    }
    getSortedProperties() {
        return (0, collection_utils_1.mapSortByKey)(this.getProperties());
    }
    getAdditionalPropertiesRef() {
        (0, Support_1.assert)(this._properties !== undefined, "Properties are not set yet");
        return this._additionalPropertiesRef;
    }
    getAdditionalProperties() {
        const tref = this.getAdditionalPropertiesRef();
        if (tref === undefined)
            return undefined;
        return (0, TypeGraph_1.derefTypeRef)(tref, this.graph);
    }
    getNonAttributeChildren() {
        const types = (0, collection_utils_1.mapSortToArray)(this.getProperties(), (_, k) => k).map(([_, p]) => p.type);
        const additionalProperties = this.getAdditionalProperties();
        if (additionalProperties !== undefined) {
            types.push(additionalProperties);
        }
        return new Set(types);
    }
    get isNullable() {
        return false;
    }
    isPrimitive() {
        return false;
    }
    get identity() {
        if (this.isFixed)
            return undefined;
        return objectTypeIdentify(this.kind, this.getAttributes(), this.getProperties(), this.getAdditionalPropertiesRef());
    }
    reconstitute(builder, canonicalOrder) {
        const sortedProperties = this.getSortedProperties();
        const propertiesInNewOrder = canonicalOrder ? sortedProperties : this.getProperties();
        const maybePropertyTypes = builder.lookupMap((0, collection_utils_1.mapMap)(sortedProperties, cp => cp.typeRef));
        const maybeAdditionalProperties = (0, collection_utils_1.definedMap)(this._additionalPropertiesRef, r => builder.lookup(r));
        if (maybePropertyTypes !== undefined &&
            (maybeAdditionalProperties !== undefined || this._additionalPropertiesRef === undefined)) {
            const properties = (0, collection_utils_1.mapMap)(propertiesInNewOrder, (cp, n) => builder.makeClassProperty((0, Support_1.defined)(maybePropertyTypes.get(n)), cp.isOptional));
            switch (this.kind) {
                case "object":
                    (0, Support_1.assert)(this.isFixed);
                    builder.getObjectType(properties, maybeAdditionalProperties);
                    break;
                case "map":
                    builder.getMapType((0, Support_1.defined)(maybeAdditionalProperties));
                    break;
                case "class":
                    if (this.isFixed) {
                        builder.getUniqueClassType(true, properties);
                    }
                    else {
                        builder.getClassType(properties);
                    }
                    break;
                default:
                    return (0, Support_1.panic)(`Invalid object type kind ${this.kind}`);
            }
        }
        else {
            switch (this.kind) {
                case "object":
                    (0, Support_1.assert)(this.isFixed);
                    builder.getUniqueObjectType(undefined, undefined);
                    break;
                case "map":
                    builder.getUniqueMapType();
                    break;
                case "class":
                    builder.getUniqueClassType(this.isFixed, undefined);
                    break;
                default:
                    return (0, Support_1.panic)(`Invalid object type kind ${this.kind}`);
            }
            const reconstitutedTypes = (0, collection_utils_1.mapMap)(sortedProperties, cp => builder.reconstitute(cp.typeRef));
            const properties = (0, collection_utils_1.mapMap)(propertiesInNewOrder, (cp, n) => builder.makeClassProperty((0, Support_1.defined)(reconstitutedTypes.get(n)), cp.isOptional));
            const additionalProperties = (0, collection_utils_1.definedMap)(this._additionalPropertiesRef, r => builder.reconstitute(r));
            builder.setObjectProperties(properties, additionalProperties);
        }
    }
    structuralEqualityStep(other, _conflateNumbers, queue) {
        const pa = this.getProperties();
        const pb = other.getProperties();
        if (pa.size !== pb.size)
            return false;
        let failed = false;
        for (const [name, cpa] of pa) {
            const cpb = pb.get(name);
            if (cpb === undefined || cpa.isOptional !== cpb.isOptional || !queue(cpa.type, cpb.type)) {
                failed = true;
                return false;
            }
        }
        if (failed)
            return false;
        const thisAdditionalProperties = this.getAdditionalProperties();
        const otherAdditionalProperties = other.getAdditionalProperties();
        if ((thisAdditionalProperties === undefined) !== (otherAdditionalProperties === undefined))
            return false;
        if (thisAdditionalProperties === undefined || otherAdditionalProperties === undefined)
            return true;
        return queue(thisAdditionalProperties, otherAdditionalProperties);
    }
}
exports.ObjectType = ObjectType;
class ClassType extends ObjectType {
    constructor(typeRef, graph, isFixed, properties) {
        super(typeRef, graph, "class", isFixed, properties, undefined);
    }
}
exports.ClassType = ClassType;
class MapType extends ObjectType {
    constructor(typeRef, graph, valuesRef) {
        super(typeRef, graph, "map", false, (0, collection_utils_1.definedMap)(valuesRef, () => new Map()), valuesRef);
    }
    // FIXME: Remove and use `getAdditionalProperties()` instead.
    get values() {
        return (0, Support_1.defined)(this.getAdditionalProperties());
    }
}
exports.MapType = MapType;
function enumTypeIdentity(attributes, cases) {
    if (hasUniqueIdentityAttributes(attributes))
        return undefined;
    return new TypeIdentity("enum", [identityAttributes(attributes), cases]);
}
exports.enumTypeIdentity = enumTypeIdentity;
class EnumType extends Type {
    constructor(typeRef, graph, cases) {
        super(typeRef, graph);
        this.cases = cases;
        this.kind = "enum";
    }
    get isNullable() {
        return false;
    }
    isPrimitive() {
        return false;
    }
    get identity() {
        return enumTypeIdentity(this.getAttributes(), this.cases);
    }
    getNonAttributeChildren() {
        return new Set();
    }
    reconstitute(builder) {
        builder.getEnumType(this.cases);
    }
    structuralEqualityStep(other, _conflateNumbers, _queue) {
        return (0, collection_utils_1.areEqual)(this.cases, other.cases);
    }
}
exports.EnumType = EnumType;
function setOperationCasesEqual(typesA, typesB, conflateNumbers, membersEqual) {
    const ma = (0, collection_utils_1.toReadonlySet)(typesA);
    const mb = (0, collection_utils_1.toReadonlySet)(typesB);
    if (ma.size !== mb.size)
        return false;
    return (0, collection_utils_1.iterableEvery)(ma, ta => {
        const tb = (0, collection_utils_1.iterableFind)(mb, t => t.kind === ta.kind);
        if (tb !== undefined) {
            if (membersEqual(ta, tb))
                return true;
        }
        if (conflateNumbers) {
            if (ta.kind === "integer" && (0, collection_utils_1.iterableSome)(mb, t => t.kind === "double"))
                return true;
            if (ta.kind === "double" && (0, collection_utils_1.iterableSome)(mb, t => t.kind === "integer"))
                return true;
        }
        return false;
    });
}
exports.setOperationCasesEqual = setOperationCasesEqual;
function setOperationTypeIdentity(kind, attributes, memberRefs) {
    if (hasUniqueIdentityAttributes(attributes))
        return undefined;
    return new TypeIdentity(kind, [identityAttributes(attributes), memberRefs]);
}
exports.setOperationTypeIdentity = setOperationTypeIdentity;
function unionTypeIdentity(attributes, memberRefs) {
    return setOperationTypeIdentity("union", attributes, memberRefs);
}
exports.unionTypeIdentity = unionTypeIdentity;
function intersectionTypeIdentity(attributes, memberRefs) {
    return setOperationTypeIdentity("intersection", attributes, memberRefs);
}
exports.intersectionTypeIdentity = intersectionTypeIdentity;
class SetOperationType extends Type {
    constructor(typeRef, graph, kind, _memberRefs) {
        super(typeRef, graph);
        this.kind = kind;
        this._memberRefs = _memberRefs;
    }
    setMembers(memberRefs) {
        if (this._memberRefs !== undefined) {
            return (0, Support_1.panic)("Can only set map members once");
        }
        this._memberRefs = memberRefs;
    }
    getMemberRefs() {
        if (this._memberRefs === undefined) {
            return (0, Support_1.panic)("Map members accessed before they were set");
        }
        return this._memberRefs;
    }
    get members() {
        return (0, collection_utils_1.setMap)(this.getMemberRefs(), tref => (0, TypeGraph_1.derefTypeRef)(tref, this.graph));
    }
    get sortedMembers() {
        return this.getNonAttributeChildren();
    }
    getNonAttributeChildren() {
        // FIXME: We're assuming no two members of the same kind.
        return (0, collection_utils_1.setSortBy)(this.members, t => t.kind);
    }
    isPrimitive() {
        return false;
    }
    get identity() {
        return setOperationTypeIdentity(this.kind, this.getAttributes(), this.getMemberRefs());
    }
    reconstituteSetOperation(builder, canonicalOrder, getType) {
        const sortedMemberRefs = (0, collection_utils_1.mapMap)(this.sortedMembers.entries(), t => t.typeRef);
        const membersInOrder = canonicalOrder ? this.sortedMembers : this.members;
        const maybeMembers = builder.lookupMap(sortedMemberRefs);
        if (maybeMembers === undefined) {
            getType(undefined);
            const reconstituted = builder.reconstituteMap(sortedMemberRefs);
            builder.setSetOperationMembers((0, collection_utils_1.setMap)(membersInOrder, t => (0, Support_1.defined)(reconstituted.get(t))));
        }
        else {
            getType((0, collection_utils_1.setMap)(membersInOrder, t => (0, Support_1.defined)(maybeMembers.get(t))));
        }
    }
    structuralEqualityStep(other, conflateNumbers, queue) {
        return setOperationCasesEqual(this.members, other.members, conflateNumbers, queue);
    }
}
exports.SetOperationType = SetOperationType;
class IntersectionType extends SetOperationType {
    constructor(typeRef, graph, memberRefs) {
        super(typeRef, graph, "intersection", memberRefs);
    }
    get isNullable() {
        return (0, Support_1.panic)("isNullable not implemented for IntersectionType");
    }
    reconstitute(builder, canonicalOrder) {
        this.reconstituteSetOperation(builder, canonicalOrder, members => {
            if (members === undefined) {
                builder.getUniqueIntersectionType();
            }
            else {
                builder.getIntersectionType(members);
            }
        });
    }
}
exports.IntersectionType = IntersectionType;
class UnionType extends SetOperationType {
    constructor(typeRef, graph, memberRefs) {
        super(typeRef, graph, "union", memberRefs);
        if (memberRefs !== undefined) {
            (0, Messages_1.messageAssert)(memberRefs.size > 0, "IRNoEmptyUnions", {});
        }
    }
    setMembers(memberRefs) {
        (0, Messages_1.messageAssert)(memberRefs.size > 0, "IRNoEmptyUnions", {});
        super.setMembers(memberRefs);
    }
    get stringTypeMembers() {
        return (0, collection_utils_1.setFilter)(this.members, t => isPrimitiveStringTypeKind(t.kind) || t.kind === "enum");
    }
    findMember(kind) {
        return (0, collection_utils_1.iterableFind)(this.members, t => t.kind === kind);
    }
    get isNullable() {
        return this.findMember("null") !== undefined;
    }
    get isCanonical() {
        const members = this.members;
        if (members.size <= 1)
            return false;
        const kinds = (0, collection_utils_1.setMap)(members, t => t.kind);
        if (kinds.size < members.size)
            return false;
        if (kinds.has("union") || kinds.has("intersection"))
            return false;
        if (kinds.has("none") || kinds.has("any"))
            return false;
        if (kinds.has("string") && kinds.has("enum"))
            return false;
        let numObjectTypes = 0;
        if (kinds.has("class"))
            numObjectTypes += 1;
        if (kinds.has("map"))
            numObjectTypes += 1;
        if (kinds.has("object"))
            numObjectTypes += 1;
        if (numObjectTypes > 1)
            return false;
        return true;
    }
    reconstitute(builder, canonicalOrder) {
        this.reconstituteSetOperation(builder, canonicalOrder, members => {
            if (members === undefined) {
                builder.getUniqueUnionType();
            }
            else {
                builder.getUnionType(members);
            }
        });
    }
}
exports.UnionType = UnionType;
