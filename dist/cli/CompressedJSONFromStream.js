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
const CompressedJSON_1 = require("../quicktype-core/input/CompressedJSON");
const { Parser } = require("stream-json");
const methodMap = {
    startObject: "pushObjectContext",
    endObject: "finishObject",
    startArray: "pushArrayContext",
    endArray: "finishArray",
    startNumber: "handleStartNumber",
    numberChunk: "handleNumberChunk",
    endNumber: "handleEndNumber",
    keyValue: "setPropertyKey",
    stringValue: "commitString",
    nullValue: "commitNull",
    trueValue: "handleTrueValue",
    falseValue: "handleFalseValue"
};
class CompressedJSONFromStream extends CompressedJSON_1.CompressedJSON {
    constructor() {
        super(...arguments);
        this.handleStartNumber = () => {
            this.pushContext();
            this.context.currentNumberIsDouble = false;
        };
        this.handleNumberChunk = (s) => {
            const ctx = this.context;
            if (!ctx.currentNumberIsDouble && /[\.e]/i.test(s)) {
                ctx.currentNumberIsDouble = true;
            }
        };
    }
    parse(readStream) {
        return __awaiter(this, void 0, void 0, function* () {
            const combo = new Parser({ packKeys: true, packStrings: true });
            combo.on("data", (item) => {
                if (typeof methodMap[item.name] === "string") {
                    this[methodMap[item.name]](item.value);
                }
            });
            const promise = new Promise((resolve, reject) => {
                combo.on("end", () => {
                    resolve(this.finish());
                });
                combo.on("error", (err) => {
                    reject(err);
                });
            });
            readStream.setEncoding("utf8");
            readStream.pipe(combo);
            readStream.resume();
            return promise;
        });
    }
    handleEndNumber() {
        const isDouble = this.context.currentNumberIsDouble;
        this.popContext();
        this.commitNumber(isDouble);
    }
    handleTrueValue() {
        this.commitBoolean(true);
    }
    handleFalseValue() {
        this.commitBoolean(false);
    }
}
exports.CompressedJSONFromStream = CompressedJSONFromStream;
