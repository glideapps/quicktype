"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Support_1 = require("../support/Support");
const Type_1 = require("../Type");
const StringTypes_1 = require("../attributes/StringTypes");
var Tag;
(function (Tag) {
    Tag[Tag["Null"] = 0] = "Null";
    Tag[Tag["False"] = 1] = "False";
    Tag[Tag["True"] = 2] = "True";
    Tag[Tag["Integer"] = 3] = "Integer";
    Tag[Tag["Double"] = 4] = "Double";
    Tag[Tag["InternedString"] = 5] = "InternedString";
    Tag[Tag["UninternedString"] = 6] = "UninternedString";
    Tag[Tag["Object"] = 7] = "Object";
    Tag[Tag["Array"] = 8] = "Array";
    Tag[Tag["StringFormat"] = 9] = "StringFormat";
    Tag[Tag["TransformedString"] = 10] = "TransformedString";
})(Tag = exports.Tag || (exports.Tag = {}));
const TAG_BITS = 4;
const TAG_MASK = (1 << TAG_BITS) - 1;
function makeValue(t, index) {
    return t | (index << TAG_BITS);
}
exports.makeValue = makeValue;
function getIndex(v, tag) {
    Support_1.assert(valueTag(v) === tag, "Trying to get index for value with invalid tag");
    return v >> TAG_BITS;
}
function valueTag(v) {
    return v & TAG_MASK;
}
exports.valueTag = valueTag;
class CompressedJSON {
    constructor(dateTimeRecognizer, handleRefs) {
        this.dateTimeRecognizer = dateTimeRecognizer;
        this.handleRefs = handleRefs;
        this._contextStack = [];
        this._strings = [];
        this._stringIndexes = {};
        this._objects = [];
        this._arrays = [];
        this.getObjectForValue = (v) => {
            return this._objects[getIndex(v, Tag.Object)];
        };
        this.getArrayForValue = (v) => {
            return this._arrays[getIndex(v, Tag.Array)];
        };
        this.internArray = (arr) => {
            const index = this._arrays.length;
            this._arrays.push(arr);
            return makeValue(Tag.Array, index);
        };
    }
    parseSync(_input) {
        return Support_1.panic("parseSync not implemented in CompressedJSON");
    }
    getStringForValue(v) {
        const tag = valueTag(v);
        Support_1.assert(tag === Tag.InternedString || tag === Tag.TransformedString);
        return this._strings[getIndex(v, tag)];
    }
    getStringFormatTypeKind(v) {
        const kind = this._strings[getIndex(v, Tag.StringFormat)];
        if (!Type_1.isPrimitiveStringTypeKind(kind) || kind === "string") {
            return Support_1.panic("Not a transformed string type kind");
        }
        return kind;
    }
    get context() {
        return Support_1.defined(this._ctx);
    }
    internString(s) {
        if (Object.prototype.hasOwnProperty.call(this._stringIndexes, s)) {
            return this._stringIndexes[s];
        }
        const index = this._strings.length;
        this._strings.push(s);
        this._stringIndexes[s] = index;
        return index;
    }
    makeString(s) {
        const value = makeValue(Tag.InternedString, this.internString(s));
        Support_1.assert(typeof value === "number", `Interned string value is not a number: ${value}`);
        return value;
    }
    internObject(obj) {
        const index = this._objects.length;
        this._objects.push(obj);
        return makeValue(Tag.Object, index);
    }
    get isExpectingRef() {
        return this._ctx !== undefined && this._ctx.currentKey === "$ref";
    }
    commitValue(value) {
        Support_1.assert(typeof value === "number", `CompressedJSON value is not a number: ${value}`);
        if (this._ctx === undefined) {
            Support_1.assert(this._rootValue === undefined, "Committing value but nowhere to commit to - root value still there.");
            this._rootValue = value;
        }
        else if (this._ctx.currentObject !== undefined) {
            if (this._ctx.currentKey === undefined) {
                return Support_1.panic("Must have key and can't have string when committing");
            }
            this._ctx.currentObject.push(this.makeString(this._ctx.currentKey), value);
            this._ctx.currentKey = undefined;
        }
        else if (this._ctx.currentArray !== undefined) {
            this._ctx.currentArray.push(value);
        }
        else {
            return Support_1.panic("Committing value but nowhere to commit to");
        }
    }
    commitNull() {
        this.commitValue(makeValue(Tag.Null, 0));
    }
    commitBoolean(v) {
        this.commitValue(makeValue(v ? Tag.True : Tag.False, 0));
    }
    commitNumber(isDouble) {
        const numberTag = isDouble ? Tag.Double : Tag.Integer;
        this.commitValue(makeValue(numberTag, 0));
    }
    commitString(s) {
        let value = undefined;
        if (this.handleRefs && this.isExpectingRef) {
            value = this.makeString(s);
        }
        else {
            const format = StringTypes_1.inferTransformedStringTypeKindForString(s, this.dateTimeRecognizer);
            if (format !== undefined) {
                if (Support_1.defined(Type_1.transformedStringTypeTargetTypeKindsMap.get(format)).attributesProducer !== undefined) {
                    value = makeValue(Tag.TransformedString, this.internString(s));
                }
                else {
                    value = makeValue(Tag.StringFormat, this.internString(format));
                }
            }
            else if (s.length <= 64) {
                value = this.makeString(s);
            }
            else {
                value = makeValue(Tag.UninternedString, 0);
            }
        }
        this.commitValue(value);
    }
    finish() {
        const value = this._rootValue;
        if (value === undefined) {
            return Support_1.panic("Finished without root document");
        }
        Support_1.assert(this._ctx === undefined && this._contextStack.length === 0, "Finished with contexts present");
        this._rootValue = undefined;
        return value;
    }
    pushContext() {
        if (this._ctx !== undefined) {
            this._contextStack.push(this._ctx);
        }
        this._ctx = {
            currentObject: undefined,
            currentArray: undefined,
            currentKey: undefined,
            currentNumberIsDouble: false
        };
    }
    pushObjectContext() {
        this.pushContext();
        Support_1.defined(this._ctx).currentObject = [];
    }
    setPropertyKey(key) {
        const ctx = this.context;
        ctx.currentKey = key;
    }
    finishObject() {
        const obj = this.context.currentObject;
        if (obj === undefined) {
            return Support_1.panic("Object ended but not started");
        }
        this.popContext();
        this.commitValue(this.internObject(obj));
    }
    pushArrayContext() {
        this.pushContext();
        Support_1.defined(this._ctx).currentArray = [];
    }
    finishArray() {
        const arr = this.context.currentArray;
        if (arr === undefined) {
            return Support_1.panic("Array ended but not started");
        }
        this.popContext();
        this.commitValue(this.internArray(arr));
    }
    popContext() {
        Support_1.assert(this._ctx !== undefined, "Popping context when there isn't one");
        this._ctx = this._contextStack.pop();
    }
    equals(other) {
        return this === other;
    }
    hashCode() {
        let hashAccumulator = collection_utils_1.hashCodeInit;
        for (const s of this._strings) {
            hashAccumulator = collection_utils_1.addHashCode(hashAccumulator, collection_utils_1.hashString(s));
        }
        for (const s of Object.getOwnPropertyNames(this._stringIndexes).sort()) {
            hashAccumulator = collection_utils_1.addHashCode(hashAccumulator, collection_utils_1.hashString(s));
            hashAccumulator = collection_utils_1.addHashCode(hashAccumulator, this._stringIndexes[s]);
        }
        for (const o of this._objects) {
            for (const v of o) {
                hashAccumulator = collection_utils_1.addHashCode(hashAccumulator, v);
            }
        }
        for (const o of this._arrays) {
            for (const v of o) {
                hashAccumulator = collection_utils_1.addHashCode(hashAccumulator, v);
            }
        }
        return hashAccumulator;
    }
}
exports.CompressedJSON = CompressedJSON;
class CompressedJSONFromString extends CompressedJSON {
    parse(input) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.parseSync(input);
        });
    }
    parseSync(input) {
        const json = JSON.parse(input);
        this.process(json);
        return this.finish();
    }
    process(json) {
        if (json === null) {
            this.commitNull();
        }
        else if (typeof json === "boolean") {
            this.commitBoolean(json);
        }
        else if (typeof json === "string") {
            this.commitString(json);
        }
        else if (typeof json === "number") {
            const isDouble = json !== Math.floor(json) || json < Number.MIN_SAFE_INTEGER || json > Number.MAX_SAFE_INTEGER;
            this.commitNumber(isDouble);
        }
        else if (Array.isArray(json)) {
            this.pushArrayContext();
            for (const v of json) {
                this.process(v);
            }
            this.finishArray();
        }
        else if (typeof json === "object") {
            this.pushObjectContext();
            for (const key of Object.getOwnPropertyNames(json)) {
                this.setPropertyKey(key);
                this.process(json[key]);
            }
            this.finishObject();
        }
        else {
            return Support_1.panic("Invalid JSON object");
        }
    }
}
exports.CompressedJSONFromString = CompressedJSONFromString;
