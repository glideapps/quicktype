"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.gatherNames = void 0;
const pluralize = __importStar(require("pluralize"));
const collection_utils_1 = require("collection-utils");
const Type_1 = require("./Type");
const TypeUtils_1 = require("./TypeUtils");
const TypeNames_1 = require("./attributes/TypeNames");
const Support_1 = require("./support/Support");
const Transformers_1 = require("./Transformers");
class UniqueQueue {
    constructor() {
        this._present = new Set();
        this._queue = [];
        this._front = 0;
    }
    get size() {
        return this._queue.length - this._front;
    }
    get isEmpty() {
        return this.size <= 0;
    }
    push(v) {
        if (this._present.has(v))
            return;
        this._queue.push(v);
        this._present.add(v);
    }
    unshift() {
        (0, Support_1.assert)(!this.isEmpty, "Trying to unshift from an empty queue");
        const v = this._queue[this._front];
        if (v === undefined) {
            return (0, Support_1.panic)("Value should have been present in queue");
        }
        this._queue[this._front] = undefined;
        this._front += 1;
        this._present.delete(v);
        if (this._front > this.size) {
            this._queue = this._queue.slice(this._front);
            this._front = 0;
        }
        return v;
    }
}
// `gatherNames` infers names from given names and property names.
//
// 1. Propagate type and property names down to children.  Let's say
//    we start with JSON like this, and we name the top-level `TopLevel`:
//
//    {
//      "foos": [ [ { "bar": 123 } ] ]
//    }
//
//    We use a work-list algorithm to first add the name `TopLevel` to
//    the outermost class type.  Then we propagate the property name
//    `foos` to the outer array, which in turn propagates its singular
//    `foo` to the inner array type.  That tries to singularize `foo`,
//    but it's already singular, so `foo` is added as a name for the
//    inner class.  We also then add `bar` to the name of the integer
//    type.
//
// 2. Add "ancestor" alternatives and some "direct" alternatives.
//    Direct alternatives are those that don't contain any ancestor
//    names, whereas ancestor alternatives do. What we do here is add
//    names of the form `TopLevel_foo` and `TopLevel_foo_class` as
//    ancestor alternatives to the inner class, and `foo_element` as
//    a direct alternative, the latter because it's an element in an
//    array.
//
// 3. Add more direct alternatives to the type names.  The reason we're
//    doing this separately from step 2 is because step 2 only requires
//    iterating over the types, wheras this step iterates over
//    ancestor/descendant relationships.  In this case we would add
//    `TopLevel_class`, and `foo_class` to the outer and inner classes,
//    respectively.  We do similar stuff for all the other types.
//
// 4. For each type, set its inferred names to what we gathered in
//    step 1, and its alternatives to a union of its direct and ancestor
//    alternatives, gathered in steps 2 and 3.
function gatherNames(graph, destructive, debugPrint) {
    function setNames(t, tn) {
        graph.attributeStore.set(TypeNames_1.namesTypeAttributeKind, t, tn);
    }
    if (destructive) {
        for (const t of graph.allTypesUnordered()) {
            if (t.hasNames) {
                setNames(t, t.getNames().clearInferred());
            }
        }
    }
    const queue = new UniqueQueue();
    // null means there are too many
    const namesForType = new Map();
    function addNames(t, names) {
        // Always use the type's given names if it has some
        if (t.hasNames) {
            const originalNames = t.getNames();
            if (!originalNames.areInferred) {
                names = originalNames.names;
            }
        }
        const oldNames = namesForType.get(t);
        if (oldNames === null)
            return;
        let newNames;
        if (oldNames === undefined) {
            newNames = names;
        }
        else if (names === null) {
            newNames = null;
        }
        else {
            newNames = (0, collection_utils_1.setUnion)(oldNames, names);
        }
        if (newNames !== null && newNames.size >= TypeNames_1.tooManyNamesThreshold) {
            newNames = null;
        }
        namesForType.set(t, newNames);
        const transformation = (0, Transformers_1.transformationForType)(t);
        if (transformation !== undefined) {
            addNames(transformation.targetType, names);
        }
        if (oldNames !== undefined && newNames !== null) {
            if (oldNames.size === newNames.size) {
                return;
            }
        }
        else if (oldNames === newNames) {
            return;
        }
        queue.push(t);
    }
    for (const [name, t] of graph.topLevels) {
        addNames(t, new Set([name]));
    }
    while (!queue.isEmpty) {
        const t = queue.unshift();
        const names = (0, Support_1.defined)(namesForType.get(t));
        if (t instanceof Type_1.ObjectType) {
            const properties = t.getSortedProperties();
            for (const [propertyName, property] of properties) {
                addNames(property.type, new Set([propertyName]));
            }
            const values = t.getAdditionalProperties();
            if (values !== undefined) {
                addNames(values, names === null ? null : (0, collection_utils_1.setMap)(names, pluralize.singular));
            }
        }
        else {
            (0, TypeUtils_1.matchCompoundType)(t, arrayType => {
                addNames(arrayType.items, names === null ? null : (0, collection_utils_1.setMap)(names, pluralize.singular));
            }, _classType => (0, Support_1.panic)("We handled this above"), _mapType => (0, Support_1.panic)("We handled this above"), _objectType => (0, Support_1.panic)("We handled this above"), unionType => {
                const members = (0, collection_utils_1.setSortBy)(unionType.members, member => member.kind);
                for (const memberType of members) {
                    addNames(memberType, names);
                }
            });
        }
    }
    if (debugPrint) {
        for (const t of graph.allTypesUnordered()) {
            const names = namesForType.get(t);
            if (names === undefined)
                return;
            const index = t.index;
            console.log(`${index}: ${names === null ? "*** too many ***" : Array.from(names).join(" ")}`);
        }
    }
    // null means there are too many
    const directAlternativesForType = new Map();
    const ancestorAlternativesForType = new Map();
    const pairsProcessed = new Map();
    function addAlternatives(existing, alternatives) {
        if (alternatives.length === 0) {
            return existing;
        }
        if (existing === undefined) {
            existing = new Set();
        }
        existing = (0, collection_utils_1.setUnion)(existing, alternatives);
        if (existing.size < TypeNames_1.tooManyNamesThreshold) {
            return existing;
        }
        return null;
    }
    function processType(ancestor, t, alternativeSuffix) {
        const names = (0, Support_1.defined)(namesForType.get(t));
        let processedEntry = pairsProcessed.get(ancestor);
        if (processedEntry === undefined)
            processedEntry = new Set();
        if (processedEntry.has(t))
            return;
        processedEntry.add(t);
        pairsProcessed.set(ancestor, processedEntry);
        const transformation = (0, Transformers_1.transformationForType)(t);
        if (transformation !== undefined) {
            processType(ancestor, transformation.targetType, alternativeSuffix);
        }
        let ancestorAlternatives = ancestorAlternativesForType.get(t);
        let directAlternatives = directAlternativesForType.get(t);
        if (names === null) {
            ancestorAlternatives = null;
            directAlternatives = null;
        }
        else {
            if (ancestor !== undefined && ancestorAlternatives !== null) {
                const ancestorNames = namesForType.get(ancestor);
                if (ancestorNames === null) {
                    ancestorAlternatives = null;
                }
                else if (ancestorNames !== undefined) {
                    const alternatives = [];
                    for (const name of names) {
                        alternatives.push(...Array.from(ancestorNames).map(an => `${an}_${name}`));
                        // FIXME: add alternatives with the suffix here, too?
                        alternatives.push(...Array.from(ancestorNames).map(an => `${an}_${name}_${t.kind}`));
                        // FIXME: add alternatives with the suffix here, too?
                    }
                    ancestorAlternatives = addAlternatives(ancestorAlternatives, alternatives);
                }
            }
            if (alternativeSuffix !== undefined && directAlternatives !== null) {
                const alternatives = [];
                for (const name of names) {
                    // FIXME: we should only add these for names we couldn't singularize
                    alternatives.push(`${name}_${alternativeSuffix}`);
                }
                directAlternatives = addAlternatives(directAlternatives, alternatives);
            }
        }
        if (ancestorAlternatives !== undefined) {
            ancestorAlternativesForType.set(t, ancestorAlternatives);
        }
        if (directAlternatives !== undefined) {
            directAlternativesForType.set(t, directAlternatives);
        }
        if (t instanceof Type_1.ObjectType) {
            const properties = t.getSortedProperties();
            for (const [, property] of properties) {
                processType(t, property.type, undefined);
            }
            const values = t.getAdditionalProperties();
            if (values !== undefined) {
                processType(properties.size === 0 ? ancestor : t, values, "value");
            }
        }
        else {
            (0, TypeUtils_1.matchCompoundType)(t, arrayType => {
                processType(ancestor, arrayType.items, "element");
            }, _classType => (0, Support_1.panic)("We handled this above"), _mapType => (0, Support_1.panic)("We handled this above"), _objectType => (0, Support_1.panic)("We handled this above"), unionType => {
                const members = (0, collection_utils_1.setSortBy)(unionType.members, member => member.kind);
                const unionHasGivenName = unionType.hasNames && !unionType.getNames().areInferred;
                const unionIsAncestor = unionHasGivenName || (0, TypeUtils_1.nullableFromUnion)(unionType) === null;
                const ancestorForMembers = unionIsAncestor ? unionType : ancestor;
                for (const memberType of members) {
                    processType(ancestorForMembers, memberType, undefined);
                }
            });
        }
    }
    for (const [, t] of graph.topLevels) {
        processType(undefined, t, undefined);
    }
    for (const t of graph.allTypesUnordered()) {
        const names = namesForType.get(t);
        if (names === undefined)
            continue;
        if (names === null) {
            directAlternativesForType.set(t, null);
            continue;
        }
        let alternatives = directAlternativesForType.get(t);
        if (alternatives === null)
            continue;
        if (alternatives === undefined) {
            alternatives = new Set();
        }
        alternatives = (0, collection_utils_1.setUnion)(alternatives, (0, collection_utils_1.setMap)(names, name => `${name}_${t.kind}`));
        directAlternativesForType.set(t, alternatives);
    }
    for (const t of graph.allTypesUnordered()) {
        const names = namesForType.get(t);
        if (names === undefined)
            continue;
        let typeNames;
        if (names === null) {
            typeNames = new TypeNames_1.TooManyTypeNames(1);
        }
        else {
            const ancestorAlternatives = ancestorAlternativesForType.get(t);
            const directAlternatives = directAlternativesForType.get(t);
            let alternatives;
            if (ancestorAlternatives === null && directAlternatives === null) {
                alternatives = undefined;
            }
            else {
                if (directAlternatives !== null && directAlternatives !== undefined) {
                    alternatives = directAlternatives;
                }
                else {
                    alternatives = new Set();
                }
                if (ancestorAlternatives !== null && ancestorAlternatives !== undefined) {
                    alternatives = (0, collection_utils_1.setUnion)(alternatives, ancestorAlternatives);
                }
            }
            typeNames = TypeNames_1.TypeNames.makeWithDistance(names, alternatives, destructive ? 1 : 10);
        }
        setNames(t, t.hasNames ? t.getNames().add([typeNames]) : typeNames);
    }
}
exports.gatherNames = gatherNames;
