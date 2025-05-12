import { type PartialArgs, generateSchema } from "@mark.probst/typescript-json-schema";
import { type JSONSchemaSourceData, defined, messageError } from "quicktype-core";
import * as ts from "typescript";

const settings: PartialArgs = {
    required: true,
    titles: true,
    topRef: true,
    noExtraProps: true
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

    const schema = generateSchema(program, "*", settings);
    const uris: string[] = [];
    let topLevelName = "";

    // if there is a type that is `export default`, swap the corresponding ref
    if (schema?.definitions?.default) {
        const defaultDefinition = schema?.definitions?.default;
        const matchingDefaultName = Object.entries(schema?.definitions ?? {}).find(
            ([_name, definition]) => (definition as Record<string, unknown>).$ref === "#/definitions/default"
        )?.[0];

        if (matchingDefaultName) {
            topLevelName = matchingDefaultName;
            (defaultDefinition as Record<string, unknown>).title = topLevelName;

            schema.definitions[matchingDefaultName] = defaultDefinition;
            schema.definitions.default = { $ref: `#/definitions/${matchingDefaultName}` };
        }
    }

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
            const matches = /#TopLevel/.exec(description);
            if (matches === null) {
                continue;
            }

            const index = defined(matches.index);
            definition.description = description.slice(0, index) + description.slice(index + matches[0].length);

            uris.push(`#/definitions/${name}`);

            if (!topLevelName) {
                if (typeof definition.title === "string") {
                    topLevelName = definition.title;
                } else {
                    topLevelName = name;
                }
            }
        }
    }

    if (uris.length === 0) {
        uris.push("#/definitions/");
    }

    return { schema: JSON.stringify(schema), name: topLevelName, uris, isConverted: true };
}
