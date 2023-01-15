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
exports.makeNamesTypeAttributes = exports.singularizeTypeNames = exports.modifyTypeNames = exports.namesTypeAttributeKind = exports.TooManyTypeNames = exports.RegularTypeNames = exports.TypeNames = exports.tooManyNamesThreshold = exports.initTypeNames = void 0;
const pluralize = __importStar(require("pluralize"));
const collection_utils_1 = require("collection-utils");
const Support_1 = require("../support/Support");
const TypeAttributes_1 = require("./TypeAttributes");
const Strings_1 = require("../support/Strings");
const Chance_1 = require("../support/Chance");
let chance;
let usedRandomNames;
function initTypeNames() {
    chance = new Chance_1.Chance(31415);
    usedRandomNames = new Set();
}
exports.initTypeNames = initTypeNames;
initTypeNames();
function makeRandomName() {
    for (;;) {
        const name = `${chance.city()} ${chance.animal()}`;
        if (usedRandomNames.has(name))
            continue;
        usedRandomNames.add(name);
        return name;
    }
}
// FIXME: In the case of overlapping prefixes and suffixes we will
// produce a name that includes the overlap twice.  For example, for
// the names "aaa" and "aaaa" we have the common prefix "aaa" and the
// common suffix "aaa", so we will produce the combined name "aaaaaa".
function combineNames(names) {
    let originalFirst = (0, collection_utils_1.iterableFirst)(names);
    if (originalFirst === undefined) {
        return (0, Support_1.panic)("Named type has no names");
    }
    if (names.size === 1) {
        return originalFirst;
    }
    const namesSet = (0, collection_utils_1.setMap)(names, s => (0, Strings_1.splitIntoWords)(s)
        .map(w => w.word.toLowerCase())
        .join("_"));
    const first = (0, Support_1.defined)((0, collection_utils_1.iterableFirst)(namesSet));
    if (namesSet.size === 1) {
        return first;
    }
    let prefixLength = first.length;
    let suffixLength = first.length;
    for (const n of (0, collection_utils_1.iterableSkip)(namesSet, 1)) {
        prefixLength = Math.min(prefixLength, n.length);
        for (let i = 0; i < prefixLength; i++) {
            if (first[i] !== n[i]) {
                prefixLength = i;
                break;
            }
        }
        suffixLength = Math.min(suffixLength, n.length);
        for (let i = 0; i < suffixLength; i++) {
            if (first[first.length - i - 1] !== n[n.length - i - 1]) {
                suffixLength = i;
                break;
            }
        }
    }
    const prefix = prefixLength > 2 ? first.slice(0, prefixLength) : "";
    const suffix = suffixLength > 2 ? first.slice(first.length - suffixLength) : "";
    const combined = prefix + suffix;
    if (combined.length > 2) {
        return combined;
    }
    return first;
}
exports.tooManyNamesThreshold = 1000;
class TypeNames {
    static makeWithDistance(names, alternativeNames, distance) {
        if (names.size >= exports.tooManyNamesThreshold) {
            return new TooManyTypeNames(distance);
        }
        if (alternativeNames === undefined || alternativeNames.size > exports.tooManyNamesThreshold) {
            alternativeNames = undefined;
        }
        return new RegularTypeNames(names, alternativeNames, distance);
    }
    static make(names, alternativeNames, areInferred) {
        return TypeNames.makeWithDistance(names, alternativeNames, areInferred ? 1 : 0);
    }
    constructor(distance) {
        this.distance = distance;
    }
    get areInferred() {
        return this.distance > 0;
    }
}
exports.TypeNames = TypeNames;
class RegularTypeNames extends TypeNames {
    constructor(names, _alternativeNames, distance) {
        super(distance);
        this.names = names;
        this._alternativeNames = _alternativeNames;
    }
    add(namesArray, startIndex = 0) {
        let newNames = new Set(this.names);
        let newDistance = this.distance;
        let newAlternativeNames = (0, collection_utils_1.definedMap)(this._alternativeNames, s => new Set(s));
        for (let i = startIndex; i < namesArray.length; i++) {
            const other = namesArray[i];
            if (other instanceof RegularTypeNames && other._alternativeNames !== undefined) {
                if (newAlternativeNames === undefined) {
                    newAlternativeNames = new Set();
                }
                (0, collection_utils_1.setUnionInto)(newAlternativeNames, other._alternativeNames);
            }
            if (other.distance > newDistance)
                continue;
            if (!(other instanceof RegularTypeNames)) {
                (0, Support_1.assert)(other instanceof TooManyTypeNames, "Unknown TypeNames instance");
                // The other one is at most our distance, so let it sort it out
                return other.add(namesArray, i + 1);
            }
            if (other.distance < newDistance) {
                // The other one is closer, so take its names
                newNames = new Set(other.names);
                newDistance = other.distance;
                newAlternativeNames = (0, collection_utils_1.definedMap)(other._alternativeNames, s => new Set(s));
            }
            else {
                // Same distance, merge them
                (0, Support_1.assert)(other.distance === newDistance, "This should be the only case left");
                (0, collection_utils_1.setUnionInto)(newNames, other.names);
            }
        }
        return TypeNames.makeWithDistance(newNames, newAlternativeNames, newDistance);
    }
    clearInferred() {
        const newNames = this.areInferred ? new Set() : this.names;
        return TypeNames.makeWithDistance(newNames, new Set(), this.distance);
    }
    get combinedName() {
        return combineNames(this.names);
    }
    get proposedNames() {
        const set = new Set([this.combinedName]);
        if (this._alternativeNames === undefined) {
            return set;
        }
        (0, collection_utils_1.setUnionInto)(set, this._alternativeNames);
        return set;
    }
    makeInferred() {
        return TypeNames.makeWithDistance(this.names, this._alternativeNames, this.distance + 1);
    }
    singularize() {
        return TypeNames.makeWithDistance((0, collection_utils_1.setMap)(this.names, pluralize.singular), (0, collection_utils_1.definedMap)(this._alternativeNames, an => (0, collection_utils_1.setMap)(an, pluralize.singular)), this.distance + 1);
    }
    toString() {
        const inferred = this.areInferred ? `distance ${this.distance}` : "given";
        const names = `${inferred} ${Array.from(this.names).join(",")}`;
        if (this._alternativeNames === undefined) {
            return names;
        }
        return `${names} (${Array.from(this._alternativeNames).join(",")})`;
    }
}
exports.RegularTypeNames = RegularTypeNames;
class TooManyTypeNames extends TypeNames {
    constructor(distance, name) {
        super(distance);
        if (name === undefined) {
            name = makeRandomName();
        }
        this.names = new Set([name]);
    }
    get combinedName() {
        return (0, Support_1.defined)((0, collection_utils_1.iterableFirst)(this.names));
    }
    get proposedNames() {
        return this.names;
    }
    add(namesArray, startIndex = 0) {
        if (!this.areInferred)
            return this;
        for (let i = startIndex; i < namesArray.length; i++) {
            const other = namesArray[i];
            if (other.distance < this.distance) {
                return other.add(namesArray, i + 1);
            }
        }
        return this;
    }
    clearInferred() {
        if (!this.areInferred) {
            return this;
        }
        return TypeNames.makeWithDistance(new Set(), new Set(), this.distance);
    }
    makeInferred() {
        return new TooManyTypeNames(this.distance + 1, (0, collection_utils_1.iterableFirst)(this.names));
    }
    singularize() {
        return this;
    }
    toString() {
        return `too many ${this.combinedName}`;
    }
}
exports.TooManyTypeNames = TooManyTypeNames;
class TypeNamesTypeAttributeKind extends TypeAttributes_1.TypeAttributeKind {
    constructor() {
        super("names");
    }
    combine(namesArray) {
        (0, Support_1.assert)(namesArray.length > 0, "Can't combine zero type names");
        return namesArray[0].add(namesArray, 1);
    }
    makeInferred(tn) {
        return tn.makeInferred();
    }
    increaseDistance(tn) {
        return tn.makeInferred();
    }
    stringify(tn) {
        return tn.toString();
    }
}
exports.namesTypeAttributeKind = new TypeNamesTypeAttributeKind();
function modifyTypeNames(attributes, modifier) {
    return exports.namesTypeAttributeKind.modifyInAttributes(attributes, modifier);
}
exports.modifyTypeNames = modifyTypeNames;
function singularizeTypeNames(attributes) {
    return modifyTypeNames(attributes, maybeNames => {
        if (maybeNames === undefined)
            return undefined;
        return maybeNames.singularize();
    });
}
exports.singularizeTypeNames = singularizeTypeNames;
function makeNamesTypeAttributes(nameOrNames, areNamesInferred) {
    let typeNames;
    if (typeof nameOrNames === "string") {
        typeNames = TypeNames.make(new Set([nameOrNames]), new Set(), (0, Support_1.defined)(areNamesInferred));
    }
    else {
        typeNames = nameOrNames;
    }
    return exports.namesTypeAttributeKind.makeAttributes(typeNames);
}
exports.makeNamesTypeAttributes = makeNamesTypeAttributes;
