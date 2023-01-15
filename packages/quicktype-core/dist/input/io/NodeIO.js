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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readFromFileOrURL = exports.readableFromFileOrURL = void 0;
const fs = __importStar(require("fs"));
const browser_or_node_1 = require("browser-or-node");
const get_stream_1 = require("./get-stream");
const ts_necessities_1 = require("@glideapps/ts-necessities");
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
                return (0, index_1.panic)(`Could not parse HTTP header "${httpHeader}".`);
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
            if (isURL(fileOrURL)) {
                const response = yield fetch(fileOrURL, {
                    headers: parseHeaders(httpHeaders)
                });
                return response.body;
            }
            else if (browser_or_node_1.isNode) {
                if (fileOrURL === "-") {
                    // Cast node readable to isomorphic readable from readable-stream
                    return process.stdin;
                }
                const filePath = fs.lstatSync(fileOrURL).isSymbolicLink() ? fs.readlinkSync(fileOrURL) : fileOrURL;
                if (fs.existsSync(filePath)) {
                    // Cast node readable to isomorphic readable from readable-stream
                    return fs.createReadStream(filePath, "utf8");
                }
            }
        }
        catch (e) {
            return (0, index_1.messageError)("MiscReadError", { fileOrURL, message: (0, ts_necessities_1.exceptionToString)(e) });
        }
        return (0, index_1.messageError)("DriverInputFileDoesNotExist", { filename: fileOrURL });
    });
}
exports.readableFromFileOrURL = readableFromFileOrURL;
function readFromFileOrURL(fileOrURL, httpHeaders) {
    return __awaiter(this, void 0, void 0, function* () {
        const readable = yield readableFromFileOrURL(fileOrURL, httpHeaders);
        try {
            return yield (0, get_stream_1.getStream)(readable);
        }
        catch (e) {
            return (0, index_1.messageError)("MiscReadError", { fileOrURL, message: (0, ts_necessities_1.exceptionToString)(e) });
        }
    });
}
exports.readFromFileOrURL = readFromFileOrURL;
