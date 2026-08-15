import { iterableFirst, mapFirst } from "collection-utils";

import { addDescriptionToSchema } from "../../attributes/Description.js";
import { ConvenienceRenderer } from "../../ConvenienceRenderer.js";
import type { Name, Namer } from "../../Naming.js";
import type { RenderContext } from "../../Renderer.js";
import type { OptionValues } from "../../RendererOptions/index.js";
import type { Sourcelike } from "../../Source.js";
import { assert, defined, panic } from "../../support/Support.js";
import type { TargetLanguage } from "../../TargetLanguage.js";
import {
    type EnumType,
    type ObjectType,
    type Type,
    type UnionType,
    transformedStringTypeTargetTypeKindsMap,
} from "../../Type/index.js";
import { matchTypeExhaustive } from "../../Type/TypeUtils.js";

import type { jsonSchemaOptions } from "./language.js";
import { namingFunction } from "./utils.js";

interface Schema {
    // biome-ignore lint/suspicious/noExplicitAny: JSON Schema values are arbitrary JSON
    [name: string]: any;
}

export class JSONSchemaRenderer extends ConvenienceRenderer {
    private _currentFilename: string | undefined;

    // The title of the definition currently being rendered, when
    // `multiFileOutput` is on. Used by `makeRef` to tell same-file
    // references (`#/definitions/X`) apart from cross-file ones
    // (`X.schema#/definitions/X`).
    private _currentTitle: string | undefined;

    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof jsonSchemaOptions>,
    ) {
        super(targetLanguage, renderContext);
    }

    protected makeNamedTypeNamer(): Namer {
        return namingFunction;
    }

    protected namerForObjectProperty(): null {
        return null;
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): null {
        return null;
    }

    private nameForType(t: Type): string {
        return defined(this.names.get(this.nameForNamedType(t)));
    }

    private makeOneOf(types: ReadonlySet<Type>): Schema {
        const first = iterableFirst(types);
        if (first === undefined) {
            return panic("Must have at least one type for oneOf");
        }

        if (types.size === 1) {
            return this.schemaForType(first);
        }

        return {
            anyOf: Array.from(types).map((t: Type) => this.schemaForType(t)),
        };
    }

    private makeRef(t: Type): Schema {
        const title = this.nameForType(t);
        if (
            this._options.multiFileOutput === true &&
            title !== this._currentTitle
        ) {
            return { $ref: `${title}.schema#/definitions/${title}` };
        }

        return { $ref: `#/definitions/${title}` };
    }

    // The title of the sole top-level type, used in multi-file mode to
    // decide which file the document root type belongs on. Returns
    // undefined when there are multiple top-levels (`FIXME` below).
    private topLevelTitle(): string | undefined {
        if (this.topLevels.size !== 1) {
            return undefined;
        }

        let title: string | undefined;
        this.forEachTopLevel("none", (_t, name) => {
            title = defined(this.names.get(name));
        });
        return title;
    }

    private addAttributesToSchema(t: Type, schema: Schema): void {
        const attributes = this.typeGraph.attributeStore.attributesForType(t);
        for (const [kind, attr] of attributes) {
            kind.addToSchema(schema, t, attr);
        }
    }

    private schemaForType(t: Type): Schema {
        const schema = matchTypeExhaustive<Schema>(
            t,
            (_noneType) => {
                return panic("none type should have been replaced");
            },
            (_anyType) => ({}),
            (_nullType) => ({ type: "null" }),
            (_boolType) => ({ type: "boolean" }),
            (_integerType) => ({ type: "integer" }),
            (_doubleType) => ({ type: "number" }),
            (_stringType) => ({ type: "string" }),
            (arrayType) => ({
                type: "array",
                items: this.schemaForType(arrayType.items),
            }),
            (classType) => this.makeRef(classType),
            (mapType) => this.definitionForObject(mapType, undefined),
            (objectType) => this.makeRef(objectType),
            (enumType) => this.makeRef(enumType),
            (unionType) => {
                if (this.unionNeedsName(unionType)) {
                    return this.makeRef(unionType);
                }

                return this.definitionForUnion(unionType);
            },
            (transformedStringType) => {
                const target = transformedStringTypeTargetTypeKindsMap.get(
                    transformedStringType.kind,
                );
                if (target === undefined) {
                    return panic(
                        `Unknown transformed string type ${transformedStringType.kind}`,
                    );
                }

                return { type: "string", format: target.jsonSchema };
            },
        );
        if (schema.$ref === undefined) {
            this.addAttributesToSchema(t, schema);
        }

        return schema;
    }

    private definitionForObject(
        o: ObjectType,
        title: string | undefined,
    ): Schema {
        let properties: Schema | undefined;
        let required: string[] | undefined;
        if (o.getProperties().size === 0) {
            properties = undefined;
            required = undefined;
        } else {
            const props: Schema = {};
            const req: string[] = [];
            for (const [name, p] of o.getProperties()) {
                const prop = this.schemaForType(p.type);
                if (prop.description === undefined) {
                    addDescriptionToSchema(
                        prop,
                        this.descriptionForClassProperty(o, name),
                    );
                }

                props[name] = prop;
                if (!p.isOptional) {
                    req.push(name);
                }
            }

            properties = props;
            // biome-ignore lint/suspicious/useArraySortCompare: sorting strings; default UTF-16 order is intended
            required = req.sort();
        }

        const additional = o.getAdditionalProperties();
        const additionalProperties =
            additional !== undefined ? this.schemaForType(additional) : false;
        const schema = {
            type: "object",
            additionalProperties,
            properties,
            required,
            title,
        };
        this.addAttributesToSchema(o, schema);
        return schema;
    }

    private definitionForUnion(u: UnionType, title?: string): Schema {
        const oneOf = this.makeOneOf(u.sortedMembers);
        if (title !== undefined) {
            oneOf.title = title;
        }

        this.addAttributesToSchema(u, oneOf);
        return oneOf;
    }

    private definitionForEnum(e: EnumType, title: string): Schema {
        const schema = { type: "string", enum: Array.from(e.cases), title };
        this.addAttributesToSchema(e, schema);
        return schema;
    }

    protected emitSourceStructure(): void {
        if (this._options.multiFileOutput === true) {
            // FIXME: Find a good way to do multiple top-levels.  Maybe multiple files?
            const rootTitle = this.topLevelTitle();
            let rootTitleUsed = false;
            const useAsRoot = (title: string): boolean => {
                const isRoot = title === rootTitle;
                if (isRoot) rootTitleUsed = true;
                return isRoot;
            };

            this.forEachObject("none", (o: ObjectType, name: Name) => {
                const title = defined(this.names.get(name));
                this.outputDefinitionFile(title, useAsRoot(title), () => ({
                    [title]: this.definitionForObject(o, title),
                }));
            });
            this.forEachUnion("none", (u, name) => {
                if (!this.unionNeedsName(u)) return;
                const title = defined(this.names.get(name));
                this.outputDefinitionFile(title, useAsRoot(title), () => ({
                    [title]: this.definitionForUnion(u, title),
                }));
            });
            this.forEachEnum("none", (e, name) => {
                const title = defined(this.names.get(name));
                this.outputDefinitionFile(title, useAsRoot(title), () => ({
                    [title]: this.definitionForEnum(e, title),
                }));
            });

            // The top-level type may not be an object/union/enum with its
            // own definition (e.g. a bare array or map), in which case none
            // of the files above is "the root". Give it a dedicated file so
            // the document root type is never dropped in multi-file mode.
            if (rootTitle !== undefined && !rootTitleUsed) {
                this.outputDefinitionFile(rootTitle, true, () => ({}));
            }

            return;
        }

        const definitions: { [name: string]: Schema } = {};
        this.forEachObject("none", (o: ObjectType, name: Name) => {
            const title = defined(this.names.get(name));
            definitions[title] = this.definitionForObject(o, title);
        });
        this.forEachUnion("none", (u, name) => {
            if (!this.unionNeedsName(u)) return;
            const title = defined(this.names.get(name));
            definitions[title] = this.definitionForUnion(u, title);
        });
        this.forEachEnum("none", (e, name) => {
            const title = defined(this.names.get(name));
            definitions[title] = this.definitionForEnum(e, title);
        });
        this.emitMultiline(
            JSON.stringify(
                this.makeSchema(true, definitions),
                undefined,
                "    ",
            ),
        );
    }

    // Builds the schema document for one output file. `includeRootType`
    // controls whether the document's root also describes the overall
    // top-level type: it's true for the single file in single-file mode,
    // and for whichever per-definition file corresponds to the top-level
    // type in multi-file mode. Every other per-definition file just holds
    // its own definition.
    private makeSchema(
        includeRootType: boolean,
        definitions: { [name: string]: Schema },
    ): Schema {
        const schema: Schema = {
            $schema: "http://json-schema.org/draft-06/schema#",
        };
        if (includeRootType) {
            Object.assign(
                schema,
                this.topLevels.size === 1
                    ? this.schemaForType(defined(mapFirst(this.topLevels)))
                    : {},
            );
        }

        schema.definitions = definitions;
        return schema;
    }

    private outputDefinitionFile(
        title: string,
        includeRootType: boolean,
        makeDefinitions: () => { [name: string]: Schema },
    ): void {
        this.startFile(title);
        this._currentTitle = title;
        this.emitMultiline(
            JSON.stringify(
                this.makeSchema(includeRootType, makeDefinitions()),
                undefined,
                "    ",
            ),
        );
        this._currentTitle = undefined;
        this.endFile();
    }

    /// startFile takes a file name, appends ".schema" to it, and sets it as the current filename.
    protected startFile(basename: Sourcelike): void {
        assert(
            this._currentFilename === undefined,
            `Previous file wasn't finished: ${this._currentFilename}`,
        );
        this._currentFilename = `${this.sourcelikeToString(basename)}.schema`;
        this.initializeEmitContextForFilename(this._currentFilename);
    }

    /// endFile pushes the current file name onto the collection of finished files and then resets the current file name. These finished files are used in index.ts to write the output.
    protected endFile(): void {
        this.finishFile(defined(this._currentFilename));
        this._currentFilename = undefined;
    }
}
