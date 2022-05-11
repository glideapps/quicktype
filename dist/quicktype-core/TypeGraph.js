"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Type_1 = require("./Type");
const TypeUtils_1 = require("./TypeUtils");
const Support_1 = require("./support/Support");
const TypeBuilder_1 = require("./TypeBuilder");
const GraphRewriting_1 = require("./GraphRewriting");
const TypeNames_1 = require("./attributes/TypeNames");
const Graph_1 = require("./Graph");
const TypeAttributes_1 = require("./attributes/TypeAttributes");
const Messages_1 = require("./Messages");
const indexBits = 26;
const indexMask = (1 << indexBits) - 1;
const serialBits = 31 - indexBits;
const serialMask = (1 << serialBits) - 1;
function isTypeRef(x) {
    return typeof x === "number";
}
exports.isTypeRef = isTypeRef;
function makeTypeRef(graph, index) {
    Support_1.assert(index <= indexMask, "Too many types in graph");
    return ((graph.serial & serialMask) << indexBits) | index;
}
exports.makeTypeRef = makeTypeRef;
function typeRefIndex(tref) {
    return tref & indexMask;
}
exports.typeRefIndex = typeRefIndex;
function assertTypeRefGraph(tref, graph) {
    Support_1.assert(((tref >> indexBits) & serialMask) === (graph.serial & serialMask), "Mixing the wrong type reference and graph");
}
exports.assertTypeRefGraph = assertTypeRefGraph;
function getGraph(graphOrBuilder) {
    if (graphOrBuilder instanceof TypeGraph)
        return graphOrBuilder;
    return graphOrBuilder.originalGraph;
}
function derefTypeRef(tref, graphOrBuilder) {
    const graph = getGraph(graphOrBuilder);
    assertTypeRefGraph(tref, graph);
    return graph.typeAtIndex(typeRefIndex(tref));
}
exports.derefTypeRef = derefTypeRef;
function attributesForTypeRef(tref, graphOrBuilder) {
    const graph = getGraph(graphOrBuilder);
    assertTypeRefGraph(tref, graph);
    return graph.atIndex(typeRefIndex(tref))[1];
}
exports.attributesForTypeRef = attributesForTypeRef;
function typeAndAttributesForTypeRef(tref, graphOrBuilder) {
    const graph = getGraph(graphOrBuilder);
    assertTypeRefGraph(tref, graph);
    return graph.atIndex(typeRefIndex(tref));
}
exports.typeAndAttributesForTypeRef = typeAndAttributesForTypeRef;
class TypeAttributeStore {
    constructor(_typeGraph, _values) {
        this._typeGraph = _typeGraph;
        this._values = _values;
        this._topLevelValues = new Map();
    }
    getTypeIndex(t) {
        const tref = t.typeRef;
        assertTypeRefGraph(tref, this._typeGraph);
        return typeRefIndex(tref);
    }
    attributesForType(t) {
        const index = this.getTypeIndex(t);
        const maybeAttributes = this._values[index];
        if (maybeAttributes !== undefined) {
            return maybeAttributes;
        }
        return TypeAttributes_1.emptyTypeAttributes;
    }
    attributesForTopLevel(name) {
        const maybeAttributes = this._topLevelValues.get(name);
        if (maybeAttributes !== undefined) {
            return maybeAttributes;
        }
        return TypeAttributes_1.emptyTypeAttributes;
    }
    setInMap(attributes, kind, value) {
        // FIXME: This is potentially super slow
        return new Map(attributes).set(kind, value);
    }
    set(kind, t, value) {
        const index = this.getTypeIndex(t);
        while (index >= this._values.length) {
            this._values.push(undefined);
        }
        this._values[index] = this.setInMap(this.attributesForType(t), kind, value);
    }
    setForTopLevel(kind, topLevelName, value) {
        this._topLevelValues.set(topLevelName, this.setInMap(this.attributesForTopLevel(topLevelName), kind, value));
    }
    tryGetInMap(attributes, kind) {
        return attributes.get(kind);
    }
    tryGet(kind, t) {
        return this.tryGetInMap(this.attributesForType(t), kind);
    }
    tryGetForTopLevel(kind, topLevelName) {
        return this.tryGetInMap(this.attributesForTopLevel(topLevelName), kind);
    }
}
exports.TypeAttributeStore = TypeAttributeStore;
class TypeAttributeStoreView {
    constructor(_attributeStore, _definition) {
        this._attributeStore = _attributeStore;
        this._definition = _definition;
    }
    set(t, value) {
        this._attributeStore.set(this._definition, t, value);
    }
    setForTopLevel(name, value) {
        this._attributeStore.setForTopLevel(this._definition, name, value);
    }
    tryGet(t) {
        return this._attributeStore.tryGet(this._definition, t);
    }
    get(t) {
        return Support_1.defined(this.tryGet(t));
    }
    tryGetForTopLevel(name) {
        return this._attributeStore.tryGetForTopLevel(this._definition, name);
    }
    getForTopLevel(name) {
        return Support_1.defined(this.tryGetForTopLevel(name));
    }
}
exports.TypeAttributeStoreView = TypeAttributeStoreView;
class TypeGraph {
    constructor(typeBuilder, serial, _haveProvenanceAttributes) {
        this.serial = serial;
        this._haveProvenanceAttributes = _haveProvenanceAttributes;
        this._attributeStore = undefined;
        // FIXME: OrderedMap?  We lose the order in PureScript right now, though,
        // and maybe even earlier in the TypeScript driver.
        this._topLevels = new Map();
        this._parents = undefined;
        this._printOnRewrite = false;
        this._typeBuilder = typeBuilder;
    }
    get isFrozen() {
        return this._typeBuilder === undefined;
    }
    get attributeStore() {
        return Support_1.defined(this._attributeStore);
    }
    freeze(topLevels, types, typeAttributes) {
        Support_1.assert(!this.isFrozen, "Tried to freeze TypeGraph a second time");
        for (const t of types) {
            assertTypeRefGraph(t.typeRef, this);
        }
        this._attributeStore = new TypeAttributeStore(this, typeAttributes);
        // The order of these three statements matters.  If we set _typeBuilder
        // to undefined before we deref the TypeRefs, then we need to set _types
        // before, also, because the deref will call into typeAtIndex, which requires
        // either a _typeBuilder or a _types.
        this._types = types;
        this._typeBuilder = undefined;
        this._topLevels = collection_utils_1.mapMap(topLevels, tref => derefTypeRef(tref, this));
    }
    get topLevels() {
        Support_1.assert(this.isFrozen, "Cannot get top-levels from a non-frozen graph");
        return this._topLevels;
    }
    typeAtIndex(index) {
        if (this._typeBuilder !== undefined) {
            return this._typeBuilder.typeAtIndex(index);
        }
        return Support_1.defined(this._types)[index];
    }
    atIndex(index) {
        if (this._typeBuilder !== undefined) {
            return this._typeBuilder.atIndex(index);
        }
        const t = this.typeAtIndex(index);
        return [t, Support_1.defined(this._attributeStore).attributesForType(t)];
    }
    filterTypes(predicate) {
        const seen = new Set();
        let types = [];
        function addFromType(t) {
            if (seen.has(t))
                return;
            seen.add(t);
            const required = predicate === undefined || predicate(t);
            if (required) {
                types.push(t);
            }
            for (const c of t.getChildren()) {
                addFromType(c);
            }
        }
        for (const [, t] of this.topLevels) {
            addFromType(t);
        }
        return new Set(types);
    }
    allNamedTypes() {
        return this.filterTypes(TypeUtils_1.isNamedType);
    }
    allNamedTypesSeparated() {
        const types = this.allNamedTypes();
        return TypeUtils_1.separateNamedTypes(types);
    }
    allProvenance() {
        Support_1.assert(this._haveProvenanceAttributes);
        const view = new TypeAttributeStoreView(this.attributeStore, TypeBuilder_1.provenanceTypeAttributeKind);
        const sets = Array.from(this.allTypesUnordered()).map(t => {
            const maybeSet = view.tryGet(t);
            if (maybeSet !== undefined)
                return maybeSet;
            return new Set();
        });
        const result = new Set();
        collection_utils_1.setUnionManyInto(result, sets);
        return result;
    }
    setPrintOnRewrite() {
        this._printOnRewrite = true;
    }
    checkLostTypeAttributes(builder, newGraph) {
        if (!this._haveProvenanceAttributes || builder.lostTypeAttributes)
            return;
        const oldProvenance = this.allProvenance();
        const newProvenance = newGraph.allProvenance();
        if (oldProvenance.size !== newProvenance.size) {
            const difference = collection_utils_1.setSubtract(oldProvenance, newProvenance);
            const indexes = Array.from(difference);
            return Messages_1.messageError("IRTypeAttributesNotPropagated", { count: difference.size, indexes });
        }
    }
    printRewrite(title) {
        if (!this._printOnRewrite)
            return;
        console.log(`\n# ${title}`);
    }
    // Each array in `replacementGroups` is a bunch of types to be replaced by a
    // single new type.  `replacer` is a function that takes a group and a
    // TypeBuilder, and builds a new type with that builder that replaces the group.
    // That particular TypeBuilder will have to take as inputs types in the old
    // graph, but return types in the new graph.  Recursive types must be handled
    // carefully.
    rewrite(title, stringTypeMapping, alphabetizeProperties, replacementGroups, debugPrintReconstitution, replacer, force = false) {
        this.printRewrite(title);
        if (!force && replacementGroups.length === 0)
            return this;
        const builder = new GraphRewriting_1.GraphRewriteBuilder(this, stringTypeMapping, alphabetizeProperties, this._haveProvenanceAttributes, replacementGroups, debugPrintReconstitution, replacer);
        const newGraph = builder.finish();
        this.checkLostTypeAttributes(builder, newGraph);
        if (this._printOnRewrite) {
            newGraph.setPrintOnRewrite();
            newGraph.printGraph();
        }
        if (!builder.didAddForwardingIntersection)
            return newGraph;
        return removeIndirectionIntersections(newGraph, stringTypeMapping, debugPrintReconstitution);
    }
    remap(title, stringTypeMapping, alphabetizeProperties, map, debugPrintRemapping, force = false) {
        this.printRewrite(title);
        if (!force && map.size === 0)
            return this;
        const builder = new GraphRewriting_1.GraphRemapBuilder(this, stringTypeMapping, alphabetizeProperties, this._haveProvenanceAttributes, map, debugPrintRemapping);
        const newGraph = builder.finish();
        this.checkLostTypeAttributes(builder, newGraph);
        if (this._printOnRewrite) {
            newGraph.setPrintOnRewrite();
            newGraph.printGraph();
        }
        Support_1.assert(!builder.didAddForwardingIntersection);
        return newGraph;
    }
    garbageCollect(alphabetizeProperties, debugPrintReconstitution) {
        const newGraph = this.remap("GC", TypeBuilder_1.getNoStringTypeMapping(), alphabetizeProperties, new Map(), debugPrintReconstitution, true);
        return newGraph;
    }
    rewriteFixedPoint(alphabetizeProperties, debugPrintReconstitution) {
        let graph = this;
        for (;;) {
            const newGraph = this.rewrite("fixed-point", TypeBuilder_1.getNoStringTypeMapping(), alphabetizeProperties, [], debugPrintReconstitution, Support_1.mustNotHappen, true);
            if (graph.allTypesUnordered().size === newGraph.allTypesUnordered().size) {
                return graph;
            }
            graph = newGraph;
        }
    }
    allTypesUnordered() {
        Support_1.assert(this.isFrozen, "Tried to get all graph types before it was frozen");
        return new Set(Support_1.defined(this._types));
    }
    makeGraph(invertDirection, childrenOfType) {
        return new Graph_1.Graph(Support_1.defined(this._types), invertDirection, childrenOfType);
    }
    getParentsOfType(t) {
        assertTypeRefGraph(t.typeRef, this);
        if (this._parents === undefined) {
            const parents = Support_1.defined(this._types).map(_ => new Set());
            for (const p of this.allTypesUnordered()) {
                for (const c of p.getChildren()) {
                    const index = c.index;
                    parents[index] = parents[index].add(p);
                }
            }
            this._parents = parents;
        }
        return this._parents[t.index];
    }
    printGraph() {
        const types = Support_1.defined(this._types);
        for (let i = 0; i < types.length; i++) {
            const t = types[i];
            const parts = [];
            parts.push(`${t.debugPrintKind}${t.hasNames ? ` ${t.getCombinedName()}` : ""}`);
            const children = t.getChildren();
            if (children.size > 0) {
                parts.push(`children ${Array.from(children)
                    .map(c => c.index)
                    .join(",")}`);
            }
            for (const [kind, value] of t.getAttributes()) {
                const maybeString = kind.stringify(value);
                if (maybeString !== undefined) {
                    parts.push(maybeString);
                }
            }
            console.log(`${i}: ${parts.join(" | ")}`);
        }
    }
}
exports.TypeGraph = TypeGraph;
function noneToAny(graph, stringTypeMapping, debugPrintReconstitution) {
    const noneTypes = collection_utils_1.setFilter(graph.allTypesUnordered(), t => t.kind === "none");
    if (noneTypes.size === 0) {
        return graph;
    }
    Support_1.assert(noneTypes.size === 1, "Cannot have more than one none type");
    return graph.rewrite("none to any", stringTypeMapping, false, [Array.from(noneTypes)], debugPrintReconstitution, (types, builder, forwardingRef) => {
        const attributes = TypeUtils_1.combineTypeAttributesOfTypes("union", types);
        const tref = builder.getPrimitiveType("any", attributes, forwardingRef);
        return tref;
    });
}
exports.noneToAny = noneToAny;
function optionalToNullable(graph, stringTypeMapping, debugPrintReconstitution) {
    function rewriteClass(c, builder, forwardingRef) {
        const properties = collection_utils_1.mapMap(c.getProperties(), (p, name) => {
            const t = p.type;
            let ref;
            if (!p.isOptional || t.isNullable) {
                ref = builder.reconstituteType(t);
            }
            else {
                const nullType = builder.getPrimitiveType("null");
                let members;
                if (t instanceof Type_1.UnionType) {
                    members = collection_utils_1.setMap(t.members, m => builder.reconstituteType(m)).add(nullType);
                }
                else {
                    members = new Set([builder.reconstituteType(t), nullType]);
                }
                const attributes = TypeNames_1.namesTypeAttributeKind.setDefaultInAttributes(t.getAttributes(), () => TypeNames_1.TypeNames.make(new Set([name]), new Set(), true));
                ref = builder.getUnionType(attributes, members);
            }
            return builder.makeClassProperty(ref, false);
        });
        if (c.isFixed) {
            return builder.getUniqueClassType(c.getAttributes(), true, properties, forwardingRef);
        }
        else {
            return builder.getClassType(c.getAttributes(), properties, forwardingRef);
        }
    }
    const classesWithOptional = collection_utils_1.setFilter(graph.allTypesUnordered(), t => t instanceof Type_1.ClassType && collection_utils_1.mapSome(t.getProperties(), p => p.isOptional));
    const replacementGroups = Array.from(classesWithOptional).map(c => [c]);
    if (classesWithOptional.size === 0) {
        return graph;
    }
    return graph.rewrite("optional to nullable", stringTypeMapping, false, replacementGroups, debugPrintReconstitution, (setOfClass, builder, forwardingRef) => {
        Support_1.assert(setOfClass.size === 1);
        const c = Support_1.defined(collection_utils_1.iterableFirst(setOfClass));
        return rewriteClass(c, builder, forwardingRef);
    });
}
exports.optionalToNullable = optionalToNullable;
function removeIndirectionIntersections(graph, stringTypeMapping, debugPrintRemapping) {
    const map = [];
    for (const t of graph.allTypesUnordered()) {
        if (!(t instanceof Type_1.IntersectionType))
            continue;
        const seen = new Set([t]);
        let current = t;
        while (current.members.size === 1) {
            const member = Support_1.defined(collection_utils_1.iterableFirst(current.members));
            if (!(member instanceof Type_1.IntersectionType)) {
                map.push([t, member]);
                break;
            }
            if (seen.has(member)) {
                // FIXME: Technically, this is an any type.
                return Support_1.panic("There's a cycle of intersection types");
            }
            seen.add(member);
            current = member;
        }
    }
    return graph.remap("remove indirection intersections", stringTypeMapping, false, new Map(map), debugPrintRemapping);
}
exports.removeIndirectionIntersections = removeIndirectionIntersections;
