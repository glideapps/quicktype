import { Type, ArrayType, UnionType, ClassType, EnumType } from "../Type";
import { matchType, nullableFromUnion, isNamedType } from "../TypeUtils";
import { TypeGraph } from "../TypeGraph";
import { utf16StringEscape, camelCase } from "../Strings";

import { Sourcelike, modifySource, MultiWord, singleWord, parenIfNeeded, multiWord } from "../Source";
import { Name } from "../Naming";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { BooleanOption, Option } from "../RendererOptions";
import { JavaScriptTargetLanguage, JavaScriptRenderer } from "./JavaScript";
import { defined, panic } from "../Support";
import { TargetLanguage } from "../TargetLanguage";

export abstract class TypeScriptFlowBaseTargetLanguage extends JavaScriptTargetLanguage {
    private readonly _justTypes = new BooleanOption("just-types", "Interfaces only", false);
    private readonly _declareUnions = new BooleanOption("explicit-unions", "Explicitly name unions", false);

    protected getOptions(): Option<any>[] {
        return [this._justTypes, this._declareUnions, this.runtimeTypecheck];
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected abstract get rendererClass(): new (
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer;
}

export class TypeScriptTargetLanguage extends TypeScriptFlowBaseTargetLanguage {
    constructor() {
        super("TypeScript", ["typescript", "ts", "tsx"], "ts");
    }

    protected get rendererClass(): new (
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return TypeScriptRenderer;
    }
}

export abstract class TypeScriptFlowBaseRenderer extends JavaScriptRenderer {
    private readonly _inlineUnions: boolean;

    constructor(
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        private readonly _justTypes: boolean,
        declareUnions: boolean,
        runtimeTypecheck: boolean
    ) {
        super(targetLanguage, graph, leadingComments, runtimeTypecheck);
        this._inlineUnions = !declareUnions;
    }

    private sourceFor(t: Type): MultiWord {
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
                    (arrayType.items instanceof UnionType && this._inlineUnions) ||
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
                if (this._inlineUnions || nullableFromUnion(unionType) !== null) {
                    const children = unionType.children.map(c => parenIfNeeded(this.sourceFor(c)));
                    return multiWord(" | ", ...children.toArray());
                } else {
                    return singleWord(this.nameForNamedType(unionType));
                }
            }
        );
    }

    protected abstract emitEnum(e: EnumType, enumName: Name): void;

    protected abstract emitClassBlock(c: ClassType, className: Name): void;

    protected emitClassBlockBody(c: ClassType): void {
        this.emitPropertyTable(c, (name, _jsonName, p) => {
            const t = p.type;
            return [[name, p.isOptional ? "?" : "", ": "], [this.sourceFor(t).source, ";"]];
        });
    }

    private emitClass(c: ClassType, className: Name) {
        this.emitDescription(this.descriptionForType(c));
        this.emitClassBlock(c, className);
    }

    emitUnion(u: UnionType, unionName: Name) {
        if (this._inlineUnions) {
            return;
        }

        this.emitDescription(this.descriptionForType(u));

        const children = multiWord(" | ", ...u.children.map(c => parenIfNeeded(this.sourceFor(c))).toArray());
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
        if (this._justTypes) return;
        super.emitUsageComments();
    }

    protected deserializerFunctionLine(t: Type, name: Name): Sourcelike {
        return ["function to", name, "(json: string): ", this.sourceFor(t).source];
    }

    protected serializerFunctionLine(t: Type, name: Name): Sourcelike {
        const camelCaseName = modifySource(camelCase, name);
        return ["function ", camelCaseName, "ToJson(value: ", this.sourceFor(t).source, "): string"];
    }

    protected get moduleLine(): string | undefined {
        return undefined;
    }

    protected get castFunctionLine(): string {
        return "function cast<T>(obj: any, typ: any): T";
    }

    protected get typeAnnotations(): {
        any: string;
        anyArray: string;
        anyMap: string;
        string: string;
        stringArray: string;
        boolean: string;
    } {
        return {
            any: ": any",
            anyArray: ": any[]",
            anyMap: ": { [k: string]: any }",
            string: ": string",
            stringArray: ": string[]",
            boolean: ": boolean"
        };
    }

    protected emitConvertModule(): void {
        if (this._justTypes) return;
        super.emitConvertModule();
    }
}

export class TypeScriptRenderer extends TypeScriptFlowBaseRenderer {
    protected forbiddenNamesForGlobalNamespace(): string[] {
        return ["Array", "Date"];
    }

    protected deserializerFunctionLine(t: Type, name: Name): Sourcelike {
        return ["export ", super.deserializerFunctionLine(t, name)];
    }

    protected serializerFunctionLine(t: Type, name: Name): Sourcelike {
        return ["export ", super.serializerFunctionLine(t, name)];
    }

    protected get moduleLine(): string | undefined {
        return "export namespace Convert";
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
        this.emitBlock(["export enum ", enumName, " "], "", () => {
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                this.emitLine(name, ` = "${utf16StringEscape(jsonName)}",`);
            });
        });
    }

    protected emitClassBlock(c: ClassType, className: Name): void {
        this.emitBlock(["export interface ", className, " "], "", () => {
            this.emitClassBlockBody(c);
        });
    }
}

export class FlowTargetLanguage extends TypeScriptFlowBaseTargetLanguage {
    constructor() {
        super("Flow", ["flow"], "js");
    }

    protected get rendererClass(): new (
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return FlowRenderer;
    }
}

export class FlowRenderer extends TypeScriptFlowBaseRenderer {
    protected forbiddenNamesForGlobalNamespace(): string[] {
        return ["Class", "Object", "String", "Array", "JSON", "Error"];
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
