import * as ts from "typescript";
import { PartialArgs, CompilerOptions, generateSchema } from "@mark.probst/typescript-json-schema";

import { panic, inflateBase64, defined, JSONSchemaSourceData, messageError } from "../quicktype-core";

import { encodedDefaultTypeScriptLibrary } from "./EncodedDefaultTypeScriptLibrary";

const settings: PartialArgs = {
    required: true,
    titles: true,
    topRef: true
};

const compilerOptions: ts.CompilerOptions = {
    noEmit: true,
    emitDecoratorMetadata: true,
    experimentalDecorators: true,
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.CommonJS,
    strictNullChecks: true,
    typeRoots: []
};

const libFileName = "lib.d.ts";
let libSource: string | undefined = undefined;

function getLibSource(): string {
    if (libSource === undefined) {
        libSource = inflateBase64(encodedDefaultTypeScriptLibrary);
    }
    return libSource;
}

class CompilerHost implements ts.CompilerHost {
    constructor(_options: ts.CompilerOptions, private readonly _sources: { [fileName: string]: string }) {}

    fileExists(fileName: string): boolean {
        if (fileName === libFileName) return true;
        return Object.prototype.hasOwnProperty.call(this._sources, fileName);
    }

    readFile(fileName: string): string | undefined {
        if (fileName === libFileName) {
            return getLibSource();
        }
        return this._sources[fileName];
    }

    getSourceFile(
        fileName: string,
        languageVersion: ts.ScriptTarget,
        _onError?: (message: string) => void,
        _shouldCreateNewSourceFile?: boolean
    ): ts.SourceFile | undefined {
        const sourceText = this.readFile(fileName);
        return sourceText !== undefined ? ts.createSourceFile(fileName, sourceText, languageVersion) : undefined;
    }

    getDefaultLibFileName(_options: CompilerOptions): string {
        return libFileName;
    }

    writeFile(fileName: string): void {
        return panic(`writeFile should not be called by the TypeScript compiler.  Filename ${fileName}`);
    }

    getCurrentDirectory(): string {
        return ".";
    }

    getDirectories(_path: string): string[] {
        return [];
    }

    getCanonicalFileName(fileName: string): string {
        if (this.useCaseSensitiveFileNames()) {
            return fileName.toLowerCase();
        }
        return fileName;
    }

    useCaseSensitiveFileNames(): boolean {
        return false;
    }

    getNewLine(): string {
        return "\n";
    }
}

// FIXME: We're stringifying and then parsing this schema again.  Just pass around
// the schema directly.
export function schemaForTypeScriptSources(sourceFileNames: string[]): JSONSchemaSourceData;
export function schemaForTypeScriptSources(sources: { [fileName: string]: string }): JSONSchemaSourceData;
export function schemaForTypeScriptSources(sources: string[] | { [fileName: string]: string }): JSONSchemaSourceData {
    let fileNames: string[];
    let host: ts.CompilerHost;

    if (Array.isArray(sources)) {
        fileNames = sources;
        host = ts.createCompilerHost(compilerOptions);
    } else {
        fileNames = Object.getOwnPropertyNames(sources);
        host = new CompilerHost(compilerOptions, sources);
    }

    const program = ts.createProgram(fileNames, compilerOptions, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const error = diagnostics.find(d => d.category === ts.DiagnosticCategory.Error);
    if (error !== undefined) {
        return messageError("TypeScriptCompilerError", {
            message: ts.flattenDiagnosticMessageText(error.messageText, "\n")
        });
    }

    const schema = generateSchema(program, "*", settings);
    const uris: string[] = [];
    let topLevelName: string | undefined = undefined;
    if (schema !== null && typeof schema === "object" && typeof schema.definitions === "object") {
        for (const name of Object.getOwnPropertyNames(schema.definitions)) {
            const definition = schema.definitions[name];
            if (
                definition === null ||
                Array.isArray(definition) ||
                typeof definition !== "object" ||
                typeof definition.description !== "string"
            ) {
                continue;
            }

            const description = definition.description as string;
            const matches = description.match(/#TopLevel/);
            if (matches === null) {
                continue;
            }

            const index = defined(matches.index);
            definition.description = description.slice(0, index) + description.slice(index + matches[0].length);

            uris.push(`#/definitions/${name}`);

            if (topLevelName === undefined) {
                if (typeof definition.title === "string") {
                    topLevelName = definition.title;
                } else {
                    topLevelName = name;
                }
            } else {
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
