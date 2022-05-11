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
const JSONSchemaStore_1 = require("./JSONSchemaStore");
const __1 = require("..");
const NodeIO_1 = require("./io/NodeIO");
class FetchingJSONSchemaStore extends JSONSchemaStore_1.JSONSchemaStore {
    constructor(_httpHeaders) {
        super();
        this._httpHeaders = _httpHeaders;
    }
    fetch(address) {
        return __awaiter(this, void 0, void 0, function* () {
            // console.log(`Fetching ${address}`);
            return __1.parseJSON(yield NodeIO_1.readFromFileOrURL(address, this._httpHeaders), "JSON Schema", address);
        });
    }
}
exports.FetchingJSONSchemaStore = FetchingJSONSchemaStore;
