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
exports.schemaForTypeScriptSources = void 0;
const ts = __importStar(require("typescript"));
const typescript_json_schema_1 = require("@mark.probst/typescript-json-schema");
const quicktype_core_1 = require("../quicktype-core");
const settings = {
    required: true,
    titles: true,
    topRef: true,
    noExtraProps: true
};
const compilerOptions = {
    noEmit: true,
    emitDecoratorMetadata: true,
    experimentalDecorators: true,
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.CommonJS,
    strictNullChecks: true,
    typeRoots: [],
    rootDir: "."
};
// FIXME: We're stringifying and then parsing this schema again.  Just pass around
// the schema directly.
function schemaForTypeScriptSources(sourceFileNames) {
    const program = ts.createProgram(sourceFileNames, compilerOptions);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const error = diagnostics.find(d => d.category === ts.DiagnosticCategory.Error);
    if (error !== undefined) {
        return (0, quicktype_core_1.messageError)("TypeScriptCompilerError", {
            message: ts.flattenDiagnosticMessageText(error.messageText, "\n")
        });
    }
    const schema = (0, typescript_json_schema_1.generateSchema)(program, "*", settings);
    const uris = [];
    let topLevelName = undefined;
    if (schema !== null && typeof schema === "object" && typeof schema.definitions === "object") {
        for (const name of Object.getOwnPropertyNames(schema.definitions)) {
            const definition = schema.definitions[name];
            if (definition === null ||
                Array.isArray(definition) ||
                typeof definition !== "object" ||
                typeof definition.description !== "string") {
                continue;
            }
            const description = definition.description;
            const matches = description.match(/#TopLevel/);
            if (matches === null) {
                continue;
            }
            const index = (0, quicktype_core_1.defined)(matches.index);
            definition.description = description.slice(0, index) + description.slice(index + matches[0].length);
            uris.push(`#/definitions/${name}`);
            if (topLevelName === undefined) {
                if (typeof definition.title === "string") {
                    topLevelName = definition.title;
                }
                else {
                    topLevelName = name;
                }
            }
            else {
                topLevelName = "";
            }
        }
    }
    if (uris.length === 0) {
        uris.push("#/definitions/");
    }
    if (topLevelName === undefined) {
        topLevelName = "";
    }
    return { schema: JSON.stringify(schema), name: topLevelName, uris, isConverted: true };
}
exports.schemaForTypeScriptSources = schemaForTypeScriptSources;
