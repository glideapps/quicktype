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
const CompressedJSON_1 = require("./CompressedJSON");
const Support_1 = require("../support/Support");
const Messages_1 = require("../Messages");
const TypeNames_1 = require("../attributes/TypeNames");
const Description_1 = require("../attributes/Description");
const Inference_1 = require("./Inference");
const All_1 = require("../language/All");
function messageParseError(name, description, e) {
    return Messages_1.messageError("MiscJSONParseError", {
        description: collection_utils_1.withDefault(description, "input"),
        address: name,
        message: Support_1.errorMessage(e)
    });
}
class JSONInput {
    /* tslint:disable:no-unused-variable */
    constructor(_compressedJSON) {
        this._compressedJSON = _compressedJSON;
        this.kind = "json";
        this.needIR = true;
        this.needSchemaProcessing = false;
        this._topLevels = new Map();
    }
    addSample(topLevelName, sample) {
        let topLevel = this._topLevels.get(topLevelName);
        if (topLevel === undefined) {
            topLevel = { samples: [], description: undefined };
            this._topLevels.set(topLevelName, topLevel);
        }
        topLevel.samples.push(sample);
    }
    setDescription(topLevelName, description) {
        let topLevel = this._topLevels.get(topLevelName);
        if (topLevel === undefined) {
            return Support_1.panic("Trying to set description for a top-level that doesn't exist");
        }
        topLevel.description = description;
    }
    addSamples(name, values, description) {
        for (const value of values) {
            this.addSample(name, value);
            if (description !== undefined) {
                this.setDescription(name, description);
            }
        }
    }
    addSource(source) {
        return __awaiter(this, void 0, void 0, function* () {
            const { name, samples, description } = source;
            try {
                const values = yield collection_utils_1.arrayMapSync(samples, (s) => __awaiter(this, void 0, void 0, function* () { return yield this._compressedJSON.parse(s); }));
                this.addSamples(name, values, description);
            }
            catch (e) {
                return messageParseError(name, description, e);
            }
        });
    }
    addSourceSync(source) {
        const { name, samples, description } = source;
        try {
            const values = samples.map(s => this._compressedJSON.parseSync(s));
            this.addSamples(name, values, description);
        }
        catch (e) {
            return messageParseError(name, description, e);
        }
    }
    singleStringSchemaSource() {
        return undefined;
    }
    addTypes(ctx, typeBuilder, inferMaps, inferEnums, fixedTopLevels) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.addTypesSync(ctx, typeBuilder, inferMaps, inferEnums, fixedTopLevels);
        });
    }
    addTypesSync(_ctx, typeBuilder, inferMaps, inferEnums, fixedTopLevels) {
        const inference = new Inference_1.TypeInference(this._compressedJSON, typeBuilder, inferMaps, inferEnums);
        for (const [name, { samples, description }] of this._topLevels) {
            const tref = inference.inferTopLevelType(TypeNames_1.makeNamesTypeAttributes(name, false), samples, fixedTopLevels);
            typeBuilder.addTopLevel(name, tref);
            if (description !== undefined) {
                const attributes = Description_1.descriptionTypeAttributeKind.makeAttributes(new Set([description]));
                typeBuilder.addAttributes(tref, attributes);
            }
        }
    }
}
exports.JSONInput = JSONInput;
function jsonInputForTargetLanguage(targetLanguage, languages, handleJSONRefs = false) {
    if (typeof targetLanguage === "string") {
        targetLanguage = Support_1.defined(All_1.languageNamed(targetLanguage, languages));
    }
    const compressedJSON = new CompressedJSON_1.CompressedJSONFromString(targetLanguage.dateTimeRecognizer, handleJSONRefs);
    return new JSONInput(compressedJSON);
}
exports.jsonInputForTargetLanguage = jsonInputForTargetLanguage;
class InputData {
    constructor() {
        // FIXME: Make into a Map, indexed by kind.
        this._inputs = new Set();
    }
    addInput(input) {
        this._inputs = this._inputs.add(input);
    }
    getOrAddInput(kind, makeInput) {
        let input = collection_utils_1.iterableFind(this._inputs, i => i.kind === kind);
        if (input === undefined) {
            input = makeInput();
            this.addInput(input);
        }
        return input;
    }
    addSource(kind, source, makeInput) {
        return __awaiter(this, void 0, void 0, function* () {
            const input = this.getOrAddInput(kind, makeInput);
            yield input.addSource(source);
        });
    }
    addSourceSync(kind, source, makeInput) {
        const input = this.getOrAddInput(kind, makeInput);
        input.addSourceSync(source);
    }
    addTypes(ctx, typeBuilder, inferMaps, inferEnums, fixedTopLevels) {
        return __awaiter(this, void 0, void 0, function* () {
            for (const input of this._inputs) {
                yield input.addTypes(ctx, typeBuilder, inferMaps, inferEnums, fixedTopLevels);
            }
        });
    }
    addTypesSync(ctx, typeBuilder, inferMaps, inferEnums, fixedTopLevels) {
        for (const input of this._inputs) {
            input.addTypesSync(ctx, typeBuilder, inferMaps, inferEnums, fixedTopLevels);
        }
    }
    get needIR() {
        return collection_utils_1.iterableSome(this._inputs, i => i.needIR);
    }
    get needSchemaProcessing() {
        return collection_utils_1.iterableSome(this._inputs, i => i.needSchemaProcessing);
    }
    singleStringSchemaSource() {
        const schemaStrings = collection_utils_1.setFilterMap(this._inputs, i => i.singleStringSchemaSource());
        if (schemaStrings.size > 1) {
            return Support_1.panic("We have more than one input with a string schema source");
        }
        return collection_utils_1.iterableFirst(schemaStrings);
    }
}
exports.InputData = InputData;
