import { Type, ArrayType, UnionType, ClassType, EnumType } from "../Type";
import { matchType, nullableFromUnion, isNamedType } from "../TypeUtils";
import { utf16StringEscape, camelCase } from "../support/Strings";

import { Sourcelike, modifySource, MultiWord, singleWord, parenIfNeeded, multiWord } from "../Source";
import { Name, Namer, funPrefixNamer } from "../Naming";
import { BooleanOption, Option, OptionValues, getOptionValues } from "../RendererOptions";
import {
    javaScriptOptions,
    JavaScriptTargetLanguage,
    JavaScriptRenderer,
    JavaScriptTypeAnnotations,
    legalizeName
} from "./JavaScript";
import { defined, panic } from "../support/Support";
import { TargetLanguage } from "../TargetLanguage";
import { RenderContext } from "../Renderer";
import { isES3IdentifierStart } from "./JavaScriptUnicodeMaps";

export const tsFlowOptions = Object.assign({}, javaScriptOptions, {
    justTypes: new BooleanOption("just-types", "Interfaces only", false),
    nicePropertyNames: new BooleanOption("nice-property-names", "Transform property names to be JavaScripty", false),
    declareUnions: new BooleanOption("explicit-unions", "Explicitly name unions", false),
    preferUnions: new BooleanOption("prefer-unions", "Use union type instead of enum", false),
    preferTypes: new BooleanOption("prefer-types", "Use types instead of interfaces", false),
    preferConstValues: new BooleanOption(
        "prefer-const-values",
        "Use string instead of enum for string enums with single value",
        false
    )
});

const tsFlowTypeAnnotations = {
    any: ": any",
    anyArray: ": any[]",
    anyMap: ": { [k: string]: any }",
    string: ": string",
    stringArray: ": string[]",
    boolean: ": boolean"
};

export abstract class TypeScriptFlowBaseTargetLanguage extends JavaScriptTargetLanguage {
    protected getOptions(): Option<any>[] {
        return [
            tsFlowOptions.justTypes,
            tsFlowOptions.nicePropertyNames,
            tsFlowOptions.declareUnions,
            tsFlowOptions.runtimeTypecheck,
            tsFlowOptions.runtimeTypecheckIgnoreUnknownProperties,
            tsFlowOptions.acronymStyle,
            tsFlowOptions.converters,
            tsFlowOptions.rawType,
            tsFlowOptions.preferUnions,
            tsFlowOptions.preferTypes,
            tsFlowOptions.preferConstValues
        ];
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected abstract makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: { [name: string]: any }
    ): JavaScriptRenderer;
}

export class TypeScriptTargetLanguage extends TypeScriptFlowBaseTargetLanguage {
    constructor() {
        super("TypeScript", ["typescript", "ts", "tsx"], "ts");
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: { [name: string]: any }
    ): TypeScriptRenderer {
        return new TypeScriptRenderer(this, renderContext, getOptionValues(tsFlowOptions, untypedOptionValues));
    }
}

function quotePropertyName(original: string): string {
    const escaped = utf16StringEscape(original);
    const quoted = `"${escaped}"`;

    if (original.length === 0) {
        return quoted;
    } else if (!isES3IdentifierStart(original.codePointAt(0) as number)) {
        return quoted;
    } else if (escaped !== original) {
        return quoted;
    } else if (legalizeName(original) !== original) {
        return quoted;
    } else {
        return original;
    }
}

export abstract class TypeScriptFlowBaseRenderer extends JavaScriptRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly _tsFlowOptions: OptionValues<typeof tsFlowOptions>
    ) {
        super(targetLanguage, renderContext, _tsFlowOptions);
    }

    protected namerForObjectProperty(): Namer {
        if (this._tsFlowOptions.nicePropertyNames) {
            return funPrefixNamer("properties", s => this.nameStyle(s, false));
        } else {
            return super.namerForObjectProperty();
        }
    }

    protected sourceFor(t: Type): MultiWord {
        if (this._tsFlowOptions.preferConstValues && t.kind === "enum" && t instanceof EnumType && t.cases.size === 1) {
            const item = t.cases.values().next().value;
            return singleWord(`"${utf16StringEscape(item)}"`);
        }
        if (["class", "object", "enum"].indexOf(t.kind) >= 0) {
            return singleWord(this.nameForNamedType(t));
        }
        return matchType<MultiWord>(
            t,
            _anyType => singleWord("any"),
            _nullType => singleWord("null"),
            _boolType => singleWord("boolean"),
            _integerType => singleWord("number"),
            _doubleType => singleWord("number"),
            _stringType => singleWord("string"),
            arrayType => {
                const itemType = this.sourceFor(arrayType.items);
                if (
                    (arrayType.items instanceof UnionType && !this._tsFlowOptions.declareUnions) ||
                    arrayType.items instanceof ArrayType
                ) {
                    return singleWord(["Array<", itemType.source, ">"]);
                } else {
                    return singleWord([parenIfNeeded(itemType), "[]"]);
                }
            },
            _classType => panic("We handled this above"),
            mapType => singleWord(["{ [key: string]: ", this.sourceFor(mapType.values).source, " }"]),
            _enumType => panic("We handled this above"),
            unionType => {
                if (!this._tsFlowOptions.declareUnions || nullableFromUnion(unionType) !== null) {
                    const children = Array.from(unionType.getChildren()).map(c => parenIfNeeded(this.sourceFor(c)));
                    return multiWord(" | ", ...children);
                } else {
                    return singleWord(this.nameForNamedType(unionType));
                }
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    return singleWord("Date");
                }
                return singleWord("string");
            }
        );
    }

    protected abstract emitEnum(e: EnumType, enumName: Name): void;

    protected abstract emitClassBlock(c: ClassType, className: Name): void;

    protected emitClassBlockBody(c: ClassType): void {
        this.emitPropertyTable(c, (name, _jsonName, p) => {
            const t = p.type;
            return [
                [modifySource(quotePropertyName, name), p.isOptional ? "?" : "", ": "],
                [this.sourceFor(t).source, ";"]
            ];
        });

        const additionalProperties = c.getAdditionalProperties();
        if (additionalProperties) {
            this.emitTable([["[property: string]", ": ", this.sourceFor(additionalProperties).source, ";"]]);
        }
    }

    private emitClass(c: ClassType, className: Name) {
        this.emitDescription(this.descriptionForType(c));
        this.emitClassBlock(c, className);
    }

    emitUnion(u: UnionType, unionName: Name) {
        if (!this._tsFlowOptions.declareUnions) {
            return;
        }

        this.emitDescription(this.descriptionForType(u));

        const children = multiWord(" | ", ...Array.from(u.getChildren()).map(c => parenIfNeeded(this.sourceFor(c))));
        this.emitLine("export type ", unionName, " = ", children.source, ";");
    }

    protected emitTypes(): void {
        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) => this.emitClass(c, n),
            (e, n) => this.emitEnum(e, n),
            (u, n) => this.emitUnion(u, n)
        );
    }

    protected emitUsageComments(): void {
        if (this._tsFlowOptions.justTypes) return;
        super.emitUsageComments();
    }

    protected deserializerFunctionLine(t: Type, name: Name): Sourcelike {
        const jsonType = this._tsFlowOptions.rawType === "json" ? "string" : "any";
        return ["function to", name, "(json: ", jsonType, "): ", this.sourceFor(t).source];
    }

    protected serializerFunctionLine(t: Type, name: Name): Sourcelike {
        const camelCaseName = modifySource(camelCase, name);
        const returnType = this._tsFlowOptions.rawType === "json" ? "string" : "any";
        return ["function ", camelCaseName, "ToJson(value: ", this.sourceFor(t).source, "): ", returnType];
    }

    protected get moduleLine(): string | undefined {
        return undefined;
    }

    protected get castFunctionLines(): [string, string] {
        return ["function cast<T>(val: any, typ: any): T", "function uncast<T>(val: T, typ: any): any"];
    }

    protected get typeAnnotations(): JavaScriptTypeAnnotations {
        throw new Error("not implemented");
    }

    protected emitConvertModule(): void {
        if (this._tsFlowOptions.justTypes) return;
        super.emitConvertModule();
    }

    protected emitConvertModuleHelpers(): void {
        if (this._tsFlowOptions.justTypes) return;
        super.emitConvertModuleHelpers();
    }

    protected emitModuleExports(): void {
        if (this._tsFlowOptions.justTypes) {
            return;
        } else {
            super.emitModuleExports();
        }
    }
}

export class TypeScriptRenderer extends TypeScriptFlowBaseRenderer {
    protected forbiddenNamesForGlobalNamespace(): string[] {
        return ["Array", "Date"];
    }

    protected deserializerFunctionLine(t: Type, name: Name): Sourcelike {
        const jsonType = this._tsFlowOptions.rawType === "json" ? "string" : "any";
        return ["public static to", name, "(json: ", jsonType, "): ", this.sourceFor(t).source];
    }

    protected serializerFunctionLine(t: Type, name: Name): Sourcelike {
        const camelCaseName = modifySource(camelCase, name);
        const returnType = this._tsFlowOptions.rawType === "json" ? "string" : "any";
        return ["public static ", camelCaseName, "ToJson(value: ", this.sourceFor(t).source, "): ", returnType];
    }

    protected get moduleLine(): string | undefined {
        return "export class Convert";
    }

    protected get typeAnnotations(): JavaScriptTypeAnnotations {
        return Object.assign({ never: ": never" }, tsFlowTypeAnnotations);
    }

    protected emitModuleExports(): void {
        return;
    }

    protected emitUsageImportComment(): void {
        const topLevelNames: Sourcelike[] = [];
        this.forEachTopLevel(
            "none",
            (_t, name) => {
                topLevelNames.push(", ", name);
            },
            isNamedType
        );
        this.emitLine("//   import { Convert", topLevelNames, ' } from "./file";');
    }

    protected emitEnum(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        // enums with only one value are emitted as constants
        if (this._tsFlowOptions.preferConstValues && e.cases.size === 1) return;

        if (this._tsFlowOptions.preferUnions) {
            let items = "";
            e.cases.forEach(item => {
                if (items === "") {
                    items += `"${utf16StringEscape(item)}"`;
                    return;
                }
                items += ` | "${utf16StringEscape(item)}"`;
            });
            this.emitLine("export type ", enumName, " = ", items, ";");
        } else {
            this.emitBlock(["export enum ", enumName, " "], "", () => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine(name, ` = "${utf16StringEscape(jsonName)}",`);
                });
            });
        }
    }

    protected emitClassBlock(c: ClassType, className: Name): void {
        this.emitBlock(
            this._tsFlowOptions.preferTypes
                ? ["export type ", className, " = "]
                : ["export interface ", className, " "],
            "",
            () => {
                this.emitClassBlockBody(c);
            }
        );
    }
}

export class FlowTargetLanguage extends TypeScriptFlowBaseTargetLanguage {
    constructor() {
        super("Flow", ["flow"], "js");
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: { [name: string]: any }): FlowRenderer {
        return new FlowRenderer(this, renderContext, getOptionValues(tsFlowOptions, untypedOptionValues));
    }
}

export class FlowRenderer extends TypeScriptFlowBaseRenderer {
    protected forbiddenNamesForGlobalNamespace(): string[] {
        return ["Class", "Date", "Object", "String", "Array", "JSON", "Error"];
    }

    protected get typeAnnotations(): JavaScriptTypeAnnotations {
        return Object.assign({ never: "" }, tsFlowTypeAnnotations);
    }

    protected emitEnum(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));
        const lines: string[][] = [];
        this.forEachEnumCase(e, "none", (_, jsonName) => {
            const maybeOr = lines.length === 0 ? "  " : "| ";
            lines.push([maybeOr, '"', utf16StringEscape(jsonName), '"']);
        });
        defined(lines[lines.length - 1]).push(";");

        this.emitLine("export type ", enumName, " =");
        this.indent(() => {
            for (const line of lines) {
                this.emitLine(line);
            }
        });
    }

    protected emitClassBlock(c: ClassType, className: Name): void {
        this.emitBlock(["export type ", className, " = "], ";", () => {
            this.emitClassBlockBody(c);
        });
    }

    protected emitSourceStructure() {
        this.emitLine("// @flow");
        this.ensureBlankLine();
        super.emitSourceStructure();
    }
}
