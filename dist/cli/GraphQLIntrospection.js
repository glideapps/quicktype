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
const quicktype_core_1 = require("../quicktype-core");
const graphql_1 = require("graphql");
const fetch = require("node-fetch");
// https://github.com/apollographql/apollo-codegen/blob/master/src/downloadSchema.ts
const defaultHeaders = {
    Accept: "application/json",
    "Content-Type": "application/json"
};
const headerRegExp = /^([^:]+):\s*(.*)$/;
function introspectServer(url, method, headerStrings) {
    return __awaiter(this, void 0, void 0, function* () {
        const headers = {};
        for (const name of Object.getOwnPropertyNames(defaultHeaders)) {
            headers[name] = defaultHeaders[name];
        }
        for (const str of headerStrings) {
            const matches = str.match(headerRegExp);
            if (matches === null) {
                return quicktype_core_1.panic(`Not a valid HTTP header: "${str}"`);
            }
            headers[matches[1]] = matches[2];
        }
        let result;
        try {
            const response = yield fetch(url, {
                method,
                headers: headers,
                body: JSON.stringify({ query: graphql_1.introspectionQuery })
            });
            result = yield response.json();
        }
        catch (error) {
            return quicktype_core_1.panic(`Error while fetching introspection query result: ${error.message}`);
        }
        if (result.errors) {
            return quicktype_core_1.panic(`Errors in introspection query result: ${JSON.stringify(result.errors)}`);
        }
        const schemaData = result;
        if (!schemaData.data) {
            return quicktype_core_1.panic(`No introspection query result data found, server responded with: ${JSON.stringify(result)}`);
        }
        return JSON.stringify(schemaData, null, 2);
    });
}
exports.introspectServer = introspectServer;
