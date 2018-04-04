import * as ts from "typescript";
import { PartialArgs, CompilerOptions, generateSchema } from "typescript-json-schema";

import { panic, inflateBase64 } from "./Support";
import { encodedDefaultTypeScriptLibrary } from "./EncodedDefaultTypeScriptLibrary";
import { ErrorMessage, messageError } from "./Messages";

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
        return Object.prototype.hasOwnProperty.apply(this._sources, fileName);
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

    writeFile(
        fileName: string,
        _data: string,
        _writeByteOrderMark: boolean,
        _onError: ((message: string) => void) | undefined,
        _sourceFiles: ReadonlyArray<ts.SourceFile>
    ): void {
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

export function schemaForTypeScriptSources(sourceFileNames: string[]): string;
export function schemaForTypeScriptSources(sources: { [fileName: string]: string }): string;
export function schemaForTypeScriptSources(sources: string[] | { [fileName: string]: string }): string {
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
        return messageError(ErrorMessage.TypeScriptCompilerError, {
            message: ts.flattenDiagnosticMessageText(error.messageText, "\n")
        });
    }

    const schema = generateSchema(program, "*", settings);
    return JSON.stringify(schema);
}
