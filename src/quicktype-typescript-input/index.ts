import * as ts from "typescript";
import { PartialArgs, generateSchema } from "typescript-json-schema";

import { defined, JSONSchemaSourceData, messageError } from "../quicktype-core";

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
    typeRoots: [],
    rootDir: "."
};

// FIXME: We're stringifying and then parsing this schema again.  Just pass around
// the schema directly.
export function schemaForTypeScriptSources(sourceFileNames: string[]): JSONSchemaSourceData {
    const program = ts.createProgram(sourceFileNames, compilerOptions);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const error = diagnostics.find(d => d.category === ts.DiagnosticCategory.Error);
    if (error !== undefined) {
        return messageError("TypeScriptCompilerError", {
            message: ts.flattenDiagnosticMessageText(error.messageText, "\n")
        });
    }

    // FIXME any
    const schema = generateSchema(program as any /* typescript and typescript-json-schema disagree */, "*", settings);
    
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
