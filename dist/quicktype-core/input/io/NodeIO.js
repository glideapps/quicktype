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
const fs = require("fs");
const browser_or_node_1 = require("browser-or-node");
const get_stream_1 = require("./get-stream");
const index_1 = require("../../index");
// The typings for this module are screwy
const isURL = require("is-url");
const fetch = require("isomorphic-fetch");
function parseHeaders(httpHeaders) {
    if (!Array.isArray(httpHeaders)) {
        return {};
    }
    return httpHeaders.reduce(function (result, httpHeader) {
        if (httpHeader !== undefined && httpHeader.length > 0) {
            const split = httpHeader.indexOf(":");
            if (split < 0) {
                return index_1.panic(`Could not parse HTTP header "${httpHeader}".`);
            }
            const key = httpHeader.slice(0, split).trim();
            const value = httpHeader.slice(split + 1).trim();
            result[key] = value;
        }
        return result;
    }, {});
}
function readableFromFileOrURL(fileOrURL, httpHeaders) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (browser_or_node_1.isNode && fileOrURL === "-") {
                // Cast node readable to isomorphic readable from readable-stream
                return process.stdin;
            }
            else if (isURL(fileOrURL)) {
                const response = yield fetch(fileOrURL, {
                    headers: parseHeaders(httpHeaders)
                });
                return response.body;
            }
            else if (browser_or_node_1.isNode && fs.existsSync(fileOrURL)) {
                // Cast node readable to isomorphic readable from readable-stream
                return fs.createReadStream(fileOrURL, "utf8");
            }
        }
        catch (e) {
            const message = typeof e.message === "string" ? e.message : "Unknown error";
            return index_1.messageError("MiscReadError", { fileOrURL, message });
        }
        return index_1.messageError("DriverInputFileDoesNotExist", { filename: fileOrURL });
    });
}
exports.readableFromFileOrURL = readableFromFileOrURL;
function readFromFileOrURL(fileOrURL, httpHeaders) {
    return __awaiter(this, void 0, void 0, function* () {
        const readable = yield readableFromFileOrURL(fileOrURL, httpHeaders);
        try {
            return yield get_stream_1.getStream(readable);
        }
        catch (e) {
            const message = typeof e.message === "string" ? e.message : "Unknown error";
            return index_1.messageError("MiscReadError", { fileOrURL, message });
        }
    });
}
exports.readFromFileOrURL = readFromFileOrURL;
