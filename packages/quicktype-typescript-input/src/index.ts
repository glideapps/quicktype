import {
    type JSONSchemaSourceData,
    defined,
    messageError,
} from "quicktype-core";
import {
    type Definition,
    type JsonSchemaGenerator,
    type PartialArgs,
    buildGenerator,
    generateSchema,
    // Use the TypeScript instance that typescript-json-schema is compiled
    // against, so the program we create is guaranteed to be compatible with
    // `generateSchema`.
    ts,
} from "typescript-json-schema";

const settings: PartialArgs = {
    required: true,
    titles: true,
    topRef: true,
    noExtraProps: true,
    propOrder: true,
};

const compilerOptions: ts.CompilerOptions = {
    noEmit: true,
    emitDecoratorMetadata: true,
    experimentalDecorators: true,
    target: ts.ScriptTarget.ES2015,
    // Include the standard library explicitly so built-in types like `Date`
    // and `Map` resolve (https://github.com/glideapps/quicktype/issues/2935).
    // The DOM and scripthost libs were part of the default lib for the ES5
    // target we used previously, so keep them for compatibility.
    lib: [
        "lib.es2015.d.ts",
        "lib.dom.d.ts",
        "lib.webworker.importscripts.d.ts",
        "lib.scripthost.d.ts",
    ],
    module: ts.ModuleKind.CommonJS,
    strictNullChecks: true,
    typeRoots: [],
    rootDir: ".",
};

// Standard-library types that cannot be represented in JSON. Without this
// check they would be structurally expanded into nonsense schemas (e.g.
// `Set<string>` would become `{ size: number }`).
const unsupportedBuiltins: ReadonlyMap<string, string> = new Map([
    ["Set", "use an array type instead"],
    ["WeakMap", "it cannot be represented in JSON"],
    ["WeakSet", "it cannot be represented in JSON"],
    ["Promise", "use the resolved type instead"],
]);

function isDeclaredInDefaultLib(
    program: ts.Program,
    symbol: ts.Symbol,
): boolean {
    const declarations = symbol.getDeclarations() ?? [];
    return declarations.some((declaration) =>
        program.isSourceFileDefaultLibrary(declaration.getSourceFile()),
    );
}

function tryGetMapValueType(
    checker: ts.TypeChecker,
    type: ts.Type,
): ts.Type | undefined {
    if ((type.flags & ts.TypeFlags.Object) === 0) {
        return undefined;
    }

    const objectType = type as ts.ObjectType;
    if ((objectType.objectFlags & ts.ObjectFlags.Reference) === 0) {
        return undefined;
    }

    const typeArguments = checker.getTypeArguments(type as ts.TypeReference);
    return typeArguments.length === 2 ? typeArguments[1] : undefined;
}

// typescript-json-schema maps `Date` to a date-time string out of the box,
// but it has no support for `Map`, and it structurally expands other
// standard-library generics into meaningless schemas. Wrap the generator's
// type dispatcher to map `Map<K, V>` to a JSON Schema map and to report
// unsupported built-in types with a helpful message.
function patchGeneratorForBuiltinTypes(
    generator: JsonSchemaGenerator,
    program: ts.Program,
): void {
    const checker = program.getTypeChecker();
    // `getTypeDefinition` is private in the type declarations, but it's the
    // single funnel through which every type goes. typescript-json-schema is
    // pinned to an exact version, and the unit tests cover this behavior.
    const generatorInternals = generator as unknown as {
        getTypeDefinition: (typ: ts.Type, ...rest: unknown[]) => Definition;
    };
    const originalGetTypeDefinition =
        generatorInternals.getTypeDefinition.bind(generator);
    generatorInternals.getTypeDefinition = (typ, ...rest) => {
        const symbol = typ.getSymbol();
        if (symbol !== undefined && isDeclaredInDefaultLib(program, symbol)) {
            const name = symbol.getName();
            if (name === "Map" || name === "ReadonlyMap") {
                const valueType = tryGetMapValueType(checker, typ);
                if (valueType !== undefined) {
                    return {
                        type: "object",
                        additionalProperties:
                            generatorInternals.getTypeDefinition(valueType),
                    };
                }
            }

            const advice = unsupportedBuiltins.get(name);
            if (advice !== undefined) {
                return messageError("TypeScriptCompilerError", {
                    message: `quicktype's TypeScript input does not support '${checker.typeToString(typ)}' - ${advice}`,
                });
            }
        }

        return originalGetTypeDefinition(typ, ...rest);
    };
}

function addEnumAccessorNames(schema: Definition, program: ts.Program): void {
    const definitions = schema.definitions;
    if (definitions === undefined) return;

    const checker = program.getTypeChecker();
    const visit = (node: ts.Node): void => {
        if (ts.isEnumDeclaration(node)) {
            const symbol = checker.getSymbolAtLocation(node.name);
            if (
                symbol !== undefined &&
                !isDeclaredInDefaultLib(program, symbol)
            ) {
                const accessorNames: Record<string, string> =
                    Object.create(null);
                for (const member of node.members) {
                    const value = checker.getConstantValue(member);
                    const name = member.name;
                    if (
                        typeof value !== "string" ||
                        (!ts.isIdentifier(name) &&
                            !ts.isStringLiteral(name) &&
                            !ts.isNumericLiteral(name))
                    ) {
                        return;
                    }

                    accessorNames[value] = name.text;
                }

                const definitionName = checker
                    .getFullyQualifiedName(symbol)
                    .replace(/(\bimport\(".*?"\)|".*?")\.| /g, "");
                const definition = definitions[definitionName];
                if (typeof definition === "object") {
                    (definition as unknown as Record<string, unknown>)[
                        "qt-accessors"
                    ] = accessorNames;
                }
            }
        }

        ts.forEachChild(node, visit);
    };

    for (const sourceFile of program.getSourceFiles()) {
        visit(sourceFile);
    }
}

// typescript-json-schema copies JSDoc `@type {string}` annotations into the
// generated schema verbatim. Strip the JSDoc braces so the value is a valid
// JSON Schema type.
function sanitizeTypeAnnotations(value: unknown): void {
    if (Array.isArray(value)) {
        value.forEach(sanitizeTypeAnnotations);
        return;
    }

    if (value === null || typeof value !== "object") {
        return;
    }

    const schema = value as Record<string, unknown>;
    if (typeof schema.type === "string") {
        const match = /^\{([^{}]+)\}$/.exec(schema.type);
        if (match !== null) {
            schema.type = match[1];
        }
    }

    Object.values(schema).forEach(sanitizeTypeAnnotations);
}

// FIXME: We're stringifying and then parsing this schema again. Just pass around
// the schema directly.
export function schemaForTypeScriptSources(
    sourceFileNames: string[],
): JSONSchemaSourceData {
    const program = ts.createProgram(sourceFileNames, compilerOptions);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const error = diagnostics.find(
        (d) => d.category === ts.DiagnosticCategory.Error,
    );
    if (error !== undefined) {
        return messageError("TypeScriptCompilerError", {
            message: ts.flattenDiagnosticMessageText(error.messageText, "\n"),
        });
    }

    const generator = buildGenerator(program, settings);
    if (generator === null) {
        return messageError("TypeScriptCompilerError", {
            message: "Failed to build the JSON Schema generator",
        });
    }

    patchGeneratorForBuiltinTypes(generator, program);

    const schema = generateSchema(program, "*", settings, undefined, generator);
    if (schema !== null) {
        addEnumAccessorNames(schema, program);
    }

    sanitizeTypeAnnotations(schema);

    const uris: string[] = [];
    let topLevelName = "";

    // if there is a type that is `export default`, swap the corresponding ref
    if (schema?.definitions?.default) {
        const defaultDefinition = schema?.definitions?.default;
        const matchingDefaultName = Object.entries(
            schema?.definitions ?? {},
        ).find(
            ([_name, definition]) =>
                (definition as Record<string, unknown>).$ref ===
                "#/definitions/default",
        )?.[0];

        if (matchingDefaultName) {
            topLevelName = matchingDefaultName;
            (defaultDefinition as Record<string, unknown>).title = topLevelName;

            schema.definitions[matchingDefaultName] = defaultDefinition;
            schema.definitions.default = {
                $ref: `#/definitions/${matchingDefaultName}`,
            };
        }
    }

    if (
        schema !== null &&
        typeof schema === "object" &&
        typeof schema.definitions === "object"
    ) {
        for (const name of Object.getOwnPropertyNames(schema.definitions)) {
            const definition = schema.definitions[name];
            if (
                definition === null ||
                Array.isArray(definition) ||
                typeof definition !== "object"
            ) {
                continue;
            }

            if (Array.isArray(definition.propertyOrder)) {
                (definition as Record<string, unknown>).quicktypePropertyOrder =
                    definition.propertyOrder;
            }

            if (typeof definition.description !== "string") {
                continue;
            }

            const description = definition.description as string;
            const matches = /#TopLevel/.exec(description);
            if (matches === null) {
                continue;
            }

            const index = defined(matches.index);
            definition.description =
                description.slice(0, index) +
                description.slice(index + matches[0].length);

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

    return {
        schema: JSON.stringify(schema),
        name: topLevelName,
        uris,
        isConverted: true,
    };
}
