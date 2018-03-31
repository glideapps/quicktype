import * as ts from "typescript";
import { PartialArgs, CompilerOptions, generateSchema } from "typescript-json-schema";

import { panic, inflateBase64 } from "../Support";
import { encodedDefaultTypeScriptLibrary } from "../EncodedDefaultTypeScriptLibrary";

const settings: PartialArgs = {
    required: true,
    titles: true,
    topRef: true
};

const compilerOptions: CompilerOptions = {
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
    constructor(_options: ts.CompilerOptions,
        private readonly _sources: {[fileName: string]: string}) {
    }

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

    getSourceFile(fileName: string, languageVersion: ts.ScriptTarget, _onError?: (message: string) => void, _shouldCreateNewSourceFile?: boolean): ts.SourceFile | undefined {
        const sourceText = this.readFile(fileName);
        return sourceText !== undefined ? ts.createSourceFile(fileName, sourceText, languageVersion) : undefined;
    }

    getDefaultLibFileName(_options: CompilerOptions): string {
        return libFileName;
    }

    writeFile(_fileName: string, _data: string, _writeByteOrderMark: boolean, _onError: ((message: string) => void) | undefined, _sourceFiles: ReadonlyArray<ts.SourceFile>): void {
        return panic("cannot write file");
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

function makeCompilerOptions(jsonCompilerOptions: any, basePath: string = "./"): ts.CompilerOptions {
    const compilerOptions = ts.convertCompilerOptionsFromJson(jsonCompilerOptions, basePath).options;
    const options: ts.CompilerOptions = {
        noEmit: true, emitDecoratorMetadata: true, experimentalDecorators: true, target: ts.ScriptTarget.ES5, module: ts.ModuleKind.CommonJS
    };
    for (const k in compilerOptions) {
        if (compilerOptions.hasOwnProperty(k)) {
            options[k] = compilerOptions[k];
        }
    }
    return options;
}

export function schemaForTypeScriptSources(sourceFileNames: string[]): string;
export function schemaForTypeScriptSources(sources: { [fileName: string]: string }): string;
export function schemaForTypeScriptSources(sources: string[] | { [fileName: string]: string }): string {
    const options = makeCompilerOptions(compilerOptions);

    let fileNames: string[];
    let host: ts.CompilerHost;

    if (Array.isArray(sources)) {
        /*
        const sourceContents: {[fileName: string]: string} = {};
        fileNames = [];

        for (const fileName of sources) {
            const baseName = path.basename(fileName);
            sourceContents[baseName] = defined(ts.sys.readFile(fileName));
            fileNames.push(baseName);
        }

        host = new CompilerHost(options, sourceContents);
        */

        fileNames = sources;
        host = ts.createCompilerHost(options);
    } else {
        fileNames = Object.getOwnPropertyNames(sources);
        host = new CompilerHost(options, sources);
    }

    const program = ts.createProgram(fileNames, options, host);
    const schema = generateSchema(program, "*", settings);
    return JSON.stringify(schema);
}
