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
const Support_1 = require("../support/Support");
class JSONSchemaStore {
    constructor() {
        this._schemas = new Map();
    }
    add(address, schema) {
        Support_1.assert(!this._schemas.has(address), "Cannot set a schema for an address twice");
        this._schemas.set(address, schema);
    }
    get(address, debugPrint) {
        return __awaiter(this, void 0, void 0, function* () {
            let schema = this._schemas.get(address);
            if (schema !== undefined) {
                return schema;
            }
            if (debugPrint) {
                console.log(`trying to fetch ${address}`);
            }
            try {
                schema = yield this.fetch(address);
            }
            catch (_a) { }
            if (schema === undefined) {
                if (debugPrint) {
                    console.log(`couldn't fetch ${address}`);
                }
                return undefined;
            }
            if (debugPrint) {
                console.log(`successully fetched ${address}`);
            }
            this.add(address, schema);
            return schema;
        });
    }
}
exports.JSONSchemaStore = JSONSchemaStore;
