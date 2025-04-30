import { type Name, type Namer, funPrefixNamer } from "../../Naming";
import { type RenderContext } from "../../Renderer";
import { type OptionValues } from "../../RendererOptions";
import { type MultiWord, type Sourcelike, modifySource, multiWord, parenIfNeeded, singleWord } from "../../Source";
import { camelCase, utf16StringEscape } from "../../support/Strings";
import { panic } from "../../support/Support";
import { type TargetLanguage } from "../../TargetLanguage";
import { ArrayType, type ClassType, EnumType, type Type, UnionType } from "../../Type";
import { matchType, nullableFromUnion } from "../../TypeUtils";
import { JavaScriptRenderer, type JavaScriptTypeAnnotations } from "../JavaScript";

import { type tsFlowOptions } from "./language";
import { quotePropertyName } from "./utils";

export abstract class TypeScriptFlowBaseRenderer extends JavaScriptRenderer {
    public constructor(
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
            const item = t.cases.values().next().value ?? '';
            return singleWord(`"${utf16StringEscape(item)}"`);
        }

        if (["class", "object", "enum"].includes(t.kind)) {
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

            let propertyName: Sourcelike = name;
            propertyName = modifySource(quotePropertyName, name);

            if (this._tsFlowOptions.readonly) {
                propertyName = modifySource(_propertyName => "readonly " + _propertyName, propertyName);
            }

            return [
                [propertyName, p.isOptional ? "?" : "", ": "],
                [this.sourceFor(t).source, ";"]
            ];
        });

        const additionalProperties = c.getAdditionalProperties();
        if (additionalProperties) {
            this.emitTable([["[property: string]", ": ", this.sourceFor(additionalProperties).source, ";"]]);
        }
    }

    private emitClass(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitClassBlock(c, className);
    }

    protected emitUnion(u: UnionType, unionName: Name): void {
        if (!this._tsFlowOptions.declareUnions) {
            return;
        }

        this.emitDescription(this.descriptionForType(u));

        const children = multiWord(" | ", ...Array.from(u.getChildren()).map(c => parenIfNeeded(this.sourceFor(c))));
        this.emitLine("export type ", unionName, " = ", children.source, ";");
    }

    protected emitTypes(): void {
        // emit primitive top levels
        this.forEachTopLevel("none", (t, name) => {
            if (!t.isPrimitive()) {
                return;
            }

            this.ensureBlankLine();
            this.emitDescription(this.descriptionForType(t));
            this.emitLine("type ", name, " = ", this.sourceFor(t).source, ";");
        });

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
