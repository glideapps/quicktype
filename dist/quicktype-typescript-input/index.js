"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const typescript_json_schema_1 = require("@mark.probst/typescript-json-schema");
const quicktype_core_1 = require("../quicktype-core");
const EncodedDefaultTypeScriptLibrary_1 = require("./EncodedDefaultTypeScriptLibrary");
const settings = {
    required: true,
    titles: true,
    topRef: true
};
const compilerOptions = {
    noEmit: true,
    emitDecoratorMetadata: true,
    experimentalDecorators: true,
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.CommonJS,
    strictNullChecks: true,
    typeRoots: []
};
const libFileName = "lib.d.ts";
let libSource = undefined;
function getLibSource() {
    if (libSource === undefined) {
        libSource = quicktype_core_1.inflateBase64(EncodedDefaultTypeScriptLibrary_1.encodedDefaultTypeScriptLibrary);
    }
    return libSource;
}
class CompilerHost {
    constructor(_options, _sources) {
        this._sources = _sources;
    }
    fileExists(fileName) {
        if (fileName === libFileName)
            return true;
        return Object.prototype.hasOwnProperty.call(this._sources, fileName);
    }
    readFile(fileName) {
        if (fileName === libFileName) {
            return getLibSource();
        }
        return this._sources[fileName];
    }
    getSourceFile(fileName, languageVersion, _onError, _shouldCreateNewSourceFile) {
        const sourceText = this.readFile(fileName);
        return sourceText !== undefined ? ts.createSourceFile(fileName, sourceText, languageVersion) : undefined;
    }
    getDefaultLibFileName(_options) {
        return libFileName;
    }
    writeFile(fileName) {
        return quicktype_core_1.panic(`writeFile should not be called by the TypeScript compiler.  Filename ${fileName}`);
    }
    getCurrentDirectory() {
        return ".";
    }
    getDirectories(_path) {
        return [];
    }
    getCanonicalFileName(fileName) {
        if (this.useCaseSensitiveFileNames()) {
            return fileName.toLowerCase();
        }
        return fileName;
    }
    useCaseSensitiveFileNames() {
        return false;
    }
    getNewLine() {
        return "\n";
    }
}
function schemaForTypeScriptSources(sources) {
    let fileNames;
    let host;
    if (Array.isArray(sources)) {
        fileNames = sources;
        host = ts.createCompilerHost(compilerOptions);
    }
    else {
        fileNames = Object.getOwnPropertyNames(sources);
        host = new CompilerHost(compilerOptions, sources);
    }
    const program = ts.createProgram(fileNames, compilerOptions, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const error = diagnostics.find(d => d.category === ts.DiagnosticCategory.Error);
    if (error !== undefined) {
        return quicktype_core_1.messageError("TypeScriptCompilerError", {
            message: ts.flattenDiagnosticMessageText(error.messageText, "\n")
        });
    }
    const schema = typescript_json_schema_1.generateSchema(program, "*", settings);
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
            const index = quicktype_core_1.defined(matches.index);
            definition.description = description.substr(0, index) + description.substr(index + matches[0].length);
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
