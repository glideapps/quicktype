"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const TypeUtils_1 = require("./TypeUtils");
const TypeGraph_1 = require("./TypeGraph");
const TypeAttributes_1 = require("./attributes/TypeAttributes");
const Support_1 = require("./support/Support");
const TypeBuilder_1 = require("./TypeBuilder");
class TypeReconstituter {
    constructor(_typeBuilder, _makeClassUnique, _typeAttributes, _forwardingRef, _register) {
        this._typeBuilder = _typeBuilder;
        this._makeClassUnique = _makeClassUnique;
        this._typeAttributes = _typeAttributes;
        this._forwardingRef = _forwardingRef;
        this._register = _register;
        this._wasUsed = false;
        this._typeRef = undefined;
    }
    builderForNewType() {
        Support_1.assert(!this._wasUsed, "TypeReconstituter used more than once");
        this._wasUsed = true;
        return this._typeBuilder;
    }
    builderForSetting() {
        Support_1.assert(this._wasUsed && this._typeRef !== undefined, "Can't set type members before constructing a type");
        return this._typeBuilder;
    }
    getResult() {
        if (this._typeRef === undefined) {
            return Support_1.panic("Type was not reconstituted");
        }
        return this._typeRef;
    }
    // FIXME: Do registration automatically.
    register(tref) {
        Support_1.assert(this._typeRef === undefined, "Cannot register a type twice");
        this._typeRef = tref;
        this._register(tref);
    }
    registerAndAddAttributes(tref) {
        this._typeBuilder.addAttributes(tref, this._typeAttributes);
        this.register(tref);
    }
    lookup(trefs) {
        Support_1.assert(!this._wasUsed, "Cannot lookup constituents after building type");
        if (TypeGraph_1.isTypeRef(trefs)) {
            return this._typeBuilder.lookupTypeRefs([trefs], undefined, false);
        }
        else {
            const maybeRefs = Array.from(trefs).map(tref => this._typeBuilder.lookupTypeRefs([tref], undefined, false));
            if (maybeRefs.some(tref => tref === undefined))
                return undefined;
            return maybeRefs;
        }
    }
    lookupMap(trefs) {
        const resultValues = this.lookup(trefs.values());
        if (resultValues === undefined)
            return undefined;
        Support_1.assert(resultValues.length === trefs.size, "Didn't get back the correct number of types");
        const result = new Map();
        let i = 0;
        for (const k of trefs.keys()) {
            result.set(k, resultValues[i]);
            i += 1;
        }
        return result;
    }
    reconstitute(trefs) {
        Support_1.assert(this._wasUsed, "Cannot reconstitute constituents before building type");
        if (TypeGraph_1.isTypeRef(trefs)) {
            return this._typeBuilder.reconstituteTypeRef(trefs);
        }
        else {
            return Array.from(trefs).map(tref => this._typeBuilder.reconstituteTypeRef(tref));
        }
    }
    reconstituteMap(trefs) {
        return collection_utils_1.mapMap(trefs, tref => this._typeBuilder.reconstituteTypeRef(tref));
    }
    getPrimitiveType(kind) {
        this.register(this.builderForNewType().getPrimitiveType(kind, this._typeAttributes, this._forwardingRef));
    }
    getEnumType(cases) {
        this.register(this.builderForNewType().getEnumType(this._typeAttributes, cases, this._forwardingRef));
    }
    getUniqueMapType() {
        this.registerAndAddAttributes(this.builderForNewType().getUniqueMapType(this._forwardingRef));
    }
    getMapType(values) {
        this.register(this.builderForNewType().getMapType(this._typeAttributes, values, this._forwardingRef));
    }
    getUniqueArrayType() {
        this.registerAndAddAttributes(this.builderForNewType().getUniqueArrayType(this._forwardingRef));
    }
    getArrayType(items) {
        this.register(this.builderForNewType().getArrayType(this._typeAttributes, items, this._forwardingRef));
    }
    setArrayItems(items) {
        this.builderForSetting().setArrayItems(this.getResult(), items);
    }
    makeClassProperty(tref, isOptional) {
        return this._typeBuilder.makeClassProperty(tref, isOptional);
    }
    getObjectType(properties, additionalProperties) {
        this.register(this.builderForNewType().getUniqueObjectType(this._typeAttributes, properties, additionalProperties, this._forwardingRef));
    }
    getUniqueObjectType(properties, additionalProperties) {
        this.register(this.builderForNewType().getUniqueObjectType(this._typeAttributes, properties, additionalProperties, this._forwardingRef));
    }
    getClassType(properties) {
        if (this._makeClassUnique) {
            this.getUniqueClassType(false, properties);
            return;
        }
        this.register(this.builderForNewType().getClassType(this._typeAttributes, properties, this._forwardingRef));
    }
    getUniqueClassType(isFixed, properties) {
        this.register(this.builderForNewType().getUniqueClassType(this._typeAttributes, isFixed, properties, this._forwardingRef));
    }
    setObjectProperties(properties, additionalProperties) {
        this.builderForSetting().setObjectProperties(this.getResult(), properties, additionalProperties);
    }
    getUnionType(members) {
        this.register(this.builderForNewType().getUnionType(this._typeAttributes, members, this._forwardingRef));
    }
    getUniqueUnionType() {
        this.register(this.builderForNewType().getUniqueUnionType(this._typeAttributes, undefined, this._forwardingRef));
    }
    getIntersectionType(members) {
        this.register(this.builderForNewType().getIntersectionType(this._typeAttributes, members, this._forwardingRef));
    }
    getUniqueIntersectionType(members) {
        this.register(this.builderForNewType().getUniqueIntersectionType(this._typeAttributes, members, this._forwardingRef));
    }
    setSetOperationMembers(members) {
        this.builderForSetting().setSetOperationMembers(this.getResult(), members);
    }
}
exports.TypeReconstituter = TypeReconstituter;
class BaseGraphRewriteBuilder extends TypeBuilder_1.TypeBuilder {
    constructor(originalGraph, stringTypeMapping, alphabetizeProperties, graphHasProvenanceAttributes, debugPrint) {
        super(originalGraph.serial + 1, stringTypeMapping, alphabetizeProperties, false, false, graphHasProvenanceAttributes);
        this.originalGraph = originalGraph;
        this.debugPrint = debugPrint;
        this.reconstitutedTypes = new Map();
        this._lostTypeAttributes = false;
        this._printIndent = 0;
    }
    withForwardingRef(maybeForwardingRef, typeCreator) {
        if (maybeForwardingRef !== undefined) {
            return typeCreator(maybeForwardingRef);
        }
        const forwardingRef = this.reserveTypeRef();
        const actualRef = typeCreator(forwardingRef);
        Support_1.assert(actualRef === forwardingRef, "Type creator didn't return its forwarding ref");
        return actualRef;
    }
    reconstituteType(t, attributes, forwardingRef) {
        return this.reconstituteTypeRef(t.typeRef, attributes, forwardingRef);
    }
    reconstituteTypeRef(originalRef, attributes, maybeForwardingRef) {
        const maybeRef = this.lookupTypeRefs([originalRef], maybeForwardingRef);
        if (maybeRef !== undefined) {
            if (attributes !== undefined) {
                this.addAttributes(maybeRef, attributes);
            }
            return maybeRef;
        }
        return this.forceReconstituteTypeRef(originalRef, attributes, maybeForwardingRef);
    }
    reconstituteTypeAttributes(attributes) {
        return collection_utils_1.mapMap(attributes, (v, a) => a.reconstitute(this, v));
    }
    assertTypeRefsToReconstitute(typeRefs, forwardingRef) {
        Support_1.assert(typeRefs.length > 0, "Must have at least one type to reconstitute");
        for (const originalRef of typeRefs) {
            TypeGraph_1.assertTypeRefGraph(originalRef, this.originalGraph);
        }
        if (forwardingRef !== undefined) {
            TypeGraph_1.assertTypeRefGraph(forwardingRef, this.typeGraph);
        }
    }
    changeDebugPrintIndent(delta) {
        this._printIndent += delta;
    }
    get debugPrintIndentation() {
        return Support_1.indentationString(this._printIndent);
    }
    finish() {
        for (const [name, t] of this.originalGraph.topLevels) {
            this.addTopLevel(name, this.reconstituteType(t));
        }
        return super.finish();
    }
    setLostTypeAttributes() {
        this._lostTypeAttributes = true;
    }
    get lostTypeAttributes() {
        return this._lostTypeAttributes;
    }
}
exports.BaseGraphRewriteBuilder = BaseGraphRewriteBuilder;
class GraphRemapBuilder extends BaseGraphRewriteBuilder {
    constructor(originalGraph, stringTypeMapping, alphabetizeProperties, graphHasProvenanceAttributes, _map, debugPrintRemapping) {
        super(originalGraph, stringTypeMapping, alphabetizeProperties, graphHasProvenanceAttributes, debugPrintRemapping);
        this._map = _map;
        this._attributeSources = new Map();
        for (const [source, target] of _map) {
            let maybeSources = this._attributeSources.get(target);
            if (maybeSources === undefined) {
                maybeSources = [target];
                this._attributeSources.set(target, maybeSources);
            }
            maybeSources.push(source);
        }
    }
    makeIdentity(_maker) {
        return undefined;
    }
    getMapTarget(tref) {
        const maybeType = this._map.get(TypeGraph_1.derefTypeRef(tref, this.originalGraph));
        if (maybeType === undefined)
            return tref;
        Support_1.assert(this._map.get(maybeType) === undefined, "We have a type that's remapped to a remapped type");
        return maybeType.typeRef;
    }
    addForwardingIntersection(_forwardingRef, _tref) {
        return Support_1.panic("We can't add forwarding intersections when we're removing forwarding intersections");
    }
    lookupTypeRefs(typeRefs, forwardingRef) {
        Support_1.assert(forwardingRef === undefined, "We can't have a forwarding ref when we remap");
        this.assertTypeRefsToReconstitute(typeRefs, forwardingRef);
        const first = this.reconstitutedTypes.get(TypeGraph_1.typeRefIndex(this.getMapTarget(typeRefs[0])));
        if (first === undefined)
            return undefined;
        for (let i = 1; i < typeRefs.length; i++) {
            const other = this.reconstitutedTypes.get(TypeGraph_1.typeRefIndex(this.getMapTarget(typeRefs[i])));
            if (first !== other)
                return undefined;
        }
        return first;
    }
    forceReconstituteTypeRef(originalRef, attributes, maybeForwardingRef) {
        originalRef = this.getMapTarget(originalRef);
        const index = TypeGraph_1.typeRefIndex(originalRef);
        Support_1.assert(this.reconstitutedTypes.get(index) === undefined, "Type has already been reconstituted");
        Support_1.assert(maybeForwardingRef === undefined, "We can't have a forwarding ref when we remap");
        return this.withForwardingRef(undefined, forwardingRef => {
            this.reconstitutedTypes.set(index, forwardingRef);
            if (this.debugPrint) {
                console.log(`${this.debugPrintIndentation}reconstituting ${index} as ${TypeGraph_1.typeRefIndex(forwardingRef)}`);
                this.changeDebugPrintIndent(1);
            }
            const [originalType, originalAttributes] = TypeGraph_1.typeAndAttributesForTypeRef(originalRef, this.originalGraph);
            const attributeSources = this._attributeSources.get(originalType);
            if (attributes === undefined) {
                attributes = TypeAttributes_1.emptyTypeAttributes;
            }
            if (attributeSources === undefined) {
                attributes = TypeAttributes_1.combineTypeAttributes("union", attributes, this.reconstituteTypeAttributes(originalAttributes));
            }
            else {
                attributes = TypeAttributes_1.combineTypeAttributes("union", attributes, this.reconstituteTypeAttributes(TypeUtils_1.combineTypeAttributesOfTypes("union", attributeSources)));
            }
            const newAttributes = attributes;
            const reconstituter = new TypeReconstituter(this, this.canonicalOrder, newAttributes, forwardingRef, tref => {
                Support_1.assert(tref === forwardingRef, "Reconstituted type as a different ref");
                if (this.debugPrint) {
                    this.changeDebugPrintIndent(-1);
                    console.log(`${this.debugPrintIndentation}reconstituted ${index} as ${TypeGraph_1.typeRefIndex(tref)}`);
                }
            });
            originalType.reconstitute(reconstituter, this.canonicalOrder);
            return reconstituter.getResult();
        });
    }
}
exports.GraphRemapBuilder = GraphRemapBuilder;
class GraphRewriteBuilder extends BaseGraphRewriteBuilder {
    constructor(originalGraph, stringTypeMapping, alphabetizeProperties, graphHasProvenanceAttributes, setsToReplace, debugPrintReconstitution, _replacer) {
        super(originalGraph, stringTypeMapping, alphabetizeProperties, graphHasProvenanceAttributes, debugPrintReconstitution);
        this._replacer = _replacer;
        this._reconstitutedUnions = new collection_utils_1.EqualityMap();
        this._setsToReplaceByMember = new Map();
        for (const types of setsToReplace) {
            const set = new Set(types);
            for (const t of set) {
                const index = t.index;
                Support_1.assert(!this._setsToReplaceByMember.has(index), "A type is member of more than one set to be replaced");
                this._setsToReplaceByMember.set(index, set);
            }
        }
    }
    registerUnion(typeRefs, reconstituted) {
        const set = new Set(typeRefs);
        Support_1.assert(!this._reconstitutedUnions.has(set), "Cannot register reconstituted set twice");
        this._reconstitutedUnions.set(set, reconstituted);
    }
    replaceSet(typesToReplace, maybeForwardingRef) {
        return this.withForwardingRef(maybeForwardingRef, forwardingRef => {
            if (this.debugPrint) {
                console.log(`${this.debugPrintIndentation}replacing set ${Array.from(typesToReplace)
                    .map(t => t.index.toString())
                    .join(",")} as ${TypeGraph_1.typeRefIndex(forwardingRef)}`);
                this.changeDebugPrintIndent(1);
            }
            for (const t of typesToReplace) {
                const originalRef = t.typeRef;
                const index = TypeGraph_1.typeRefIndex(originalRef);
                this.reconstitutedTypes.set(index, forwardingRef);
                this._setsToReplaceByMember.delete(index);
            }
            const result = this._replacer(typesToReplace, this, forwardingRef);
            Support_1.assert(result === forwardingRef, "The forwarding ref got lost when replacing");
            if (this.debugPrint) {
                this.changeDebugPrintIndent(-1);
                console.log(`${this.debugPrintIndentation}replaced set ${Array.from(typesToReplace)
                    .map(t => t.index.toString())
                    .join(",")} as ${TypeGraph_1.typeRefIndex(forwardingRef)}`);
            }
            return result;
        });
    }
    forceReconstituteTypeRef(originalRef, attributes, maybeForwardingRef) {
        const [originalType, originalAttributes] = TypeGraph_1.typeAndAttributesForTypeRef(originalRef, this.originalGraph);
        const index = TypeGraph_1.typeRefIndex(originalRef);
        if (this.debugPrint) {
            console.log(`${this.debugPrintIndentation}reconstituting ${index}`);
            this.changeDebugPrintIndent(1);
        }
        if (attributes === undefined) {
            attributes = this.reconstituteTypeAttributes(originalAttributes);
        }
        else {
            attributes = TypeAttributes_1.combineTypeAttributes("union", attributes, this.reconstituteTypeAttributes(originalAttributes));
        }
        const reconstituter = new TypeReconstituter(this, this.canonicalOrder, attributes, maybeForwardingRef, tref => {
            if (this.debugPrint) {
                this.changeDebugPrintIndent(-1);
                console.log(`${this.debugPrintIndentation}reconstituted ${index} as ${TypeGraph_1.typeRefIndex(tref)}`);
            }
            if (maybeForwardingRef !== undefined) {
                Support_1.assert(tref === maybeForwardingRef, "We didn't pass the forwarding ref");
            }
            const alreadyReconstitutedType = this.reconstitutedTypes.get(index);
            if (alreadyReconstitutedType === undefined) {
                this.reconstitutedTypes.set(index, tref);
            }
            else {
                Support_1.assert(tref === alreadyReconstitutedType, "We reconstituted a type twice differently");
            }
        });
        originalType.reconstitute(reconstituter, this.canonicalOrder);
        return reconstituter.getResult();
    }
    /*
    reconstituteTypeUnmodified(originalType: Type): TypeRef {
        const reconstituter = new TypeReconstituter(
            this,
            this.alphabetizeProperties,
            emptyTypeAttributes,
            undefined,
            () => {}
        );
        originalType.reconstitute(reconstituter);
        return reconstituter.getResult();
    }
    */
    // If the union of these type refs have been, or are supposed to be, reconstituted to
    // one target type, return it.  Otherwise return undefined.
    lookupTypeRefs(typeRefs, forwardingRef, replaceSet = true) {
        this.assertTypeRefsToReconstitute(typeRefs, forwardingRef);
        // Check whether we have already reconstituted them.  That means ensuring
        // that they all have the same target type.
        let maybeRef = this.reconstitutedTypes.get(TypeGraph_1.typeRefIndex(typeRefs[0]));
        if (maybeRef !== undefined && maybeRef !== forwardingRef) {
            let allEqual = true;
            for (let i = 1; i < typeRefs.length; i++) {
                if (this.reconstitutedTypes.get(TypeGraph_1.typeRefIndex(typeRefs[i])) !== maybeRef) {
                    allEqual = false;
                    break;
                }
            }
            if (allEqual) {
                return this.forwardIfNecessary(forwardingRef, maybeRef);
            }
        }
        // Has this been reconstituted as a set?
        maybeRef = this._reconstitutedUnions.get(new Set(typeRefs));
        if (maybeRef !== undefined && maybeRef !== forwardingRef) {
            return this.forwardIfNecessary(forwardingRef, maybeRef);
        }
        // Is this set requested to be replaced?  If not, we're out of options.
        const maybeSet = this._setsToReplaceByMember.get(TypeGraph_1.typeRefIndex(typeRefs[0]));
        if (maybeSet === undefined) {
            return undefined;
        }
        for (let i = 1; i < typeRefs.length; i++) {
            if (this._setsToReplaceByMember.get(TypeGraph_1.typeRefIndex(typeRefs[i])) !== maybeSet) {
                return undefined;
            }
        }
        // Yes, this set is requested to be replaced, so do it.
        if (!replaceSet)
            return undefined;
        return this.replaceSet(maybeSet, forwardingRef);
    }
}
exports.GraphRewriteBuilder = GraphRewriteBuilder;
