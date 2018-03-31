import { PartialArgs, CompilerOptions, getProgramFromFiles, generateSchema } from "typescript-json-schema";

const settings: PartialArgs = {
    required: true,
    titles: true,
    topRef: true
};

const compilerOptions: CompilerOptions = {
    strictNullChecks: true,
    typeRoots: []
};

export function schemaForTypeScriptSources(sources: string[]): string {
    const program = getProgramFromFiles(sources, compilerOptions);
    const schema = generateSchema(program, "*", settings);
    return JSON.stringify(schema);
}
