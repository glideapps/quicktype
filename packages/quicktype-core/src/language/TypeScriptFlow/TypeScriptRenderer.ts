import { minMaxItemsForType } from "../../attributes/Constraints.js";
import type { Name } from "../../Naming.js";
import {
    type MultiWord,
    type Sourcelike,
    modifySource,
    parenIfNeeded,
    singleWord,
} from "../../Source.js";
import { camelCase, utf16StringEscape } from "../../support/Strings.js";
import type { ArrayType, ClassType, EnumType, Type } from "../../Type/index.js";
import { isNamedType } from "../../Type/TypeUtils.js";
import type { JavaScriptTypeAnnotations } from "../JavaScript/index.js";

import { TypeScriptFlowBaseRenderer } from "./TypeScriptFlowBaseRenderer.js";
import { tsFlowTypeAnnotations } from "./utils.js";

// An array type with a huge `minItems` would otherwise expand into an
// equally huge tuple type, so beyond this limit we fall back to a plain
// array type.
const maxSpelledOutMinItems = 16;

export class TypeScriptRenderer extends TypeScriptFlowBaseRenderer {
    protected get emptyObjectType(): string {
        return "object";
    }

    protected anyType(): string {
        return this._tsFlowOptions.preferUnknown ? "unknown" : "any";
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return ["Array", "Date"];
    }

    // An array with `minItems` >= 1 becomes a tuple that spells out the
    // guaranteed elements, followed by a rest element: `minItems: 2`
    // renders as `[T, T, ...T[]]`.  Only `minItems` shapes the type;
    // `maxItems` is enforced by none of the generated code, and spelling
    // it out would enumerate every allowed arity as its own tuple.
    protected sourceForArrayType(arrayType: ArrayType): MultiWord {
        const minItems = minMaxItemsForType(arrayType)?.[0];
        if (
            minItems === undefined ||
            minItems < 1 ||
            minItems > maxSpelledOutMinItems
        ) {
            return super.sourceForArrayType(arrayType);
        }

        const itemType = this.sourceFor(arrayType.items);
        const source: Sourcelike[] = ["["];
        for (let i = 0; i < minItems; i++) {
            source.push(itemType.source, ", ");
        }

        source.push("...", parenIfNeeded(itemType), "[]]");
        return singleWord(source);
    }

    protected uncheckedParsedJson(t: Type, parsedJson: Sourcelike): Sourcelike {
        // With `raw-type any` and `prefer-unknown` the deserializer's
        // parameter is `unknown`, which can't be returned as the target
        // type without a cast.
        if (
            this._tsFlowOptions.rawType !== "json" &&
            this._tsFlowOptions.preferUnknown
        ) {
            return [parsedJson, " as ", this.sourceFor(t).source];
        }

        return parsedJson;
    }

    protected deserializerFunctionLine(t: Type, name: Name): Sourcelike {
        const jsonType =
            this._tsFlowOptions.rawType === "json" ? "string" : this.anyType();
        return [
            "public static to",
            name,
            "(json: ",
            jsonType,
            "): ",
            this.sourceFor(t).source,
        ];
    }

    protected serializerFunctionLine(t: Type, name: Name): Sourcelike {
        const camelCaseName = modifySource(camelCase, name);
        const returnType =
            this._tsFlowOptions.rawType === "json" ? "string" : this.anyType();
        return [
            "public static ",
            camelCaseName,
            "ToJson(value: ",
            this.sourceFor(t).source,
            "): ",
            returnType,
        ];
    }

    protected get moduleLine(): string | undefined {
        return "export class Convert";
    }

    protected get typeAnnotations(): JavaScriptTypeAnnotations {
        return { never: ": never", ...tsFlowTypeAnnotations };
    }

    protected emitModuleExports(): void {}

    protected emitUsageImportComment(givenOutputFilename: string): void {
        const topLevelNames: Sourcelike[] = [];
        this.forEachTopLevel(
            "none",
            (_t, name) => {
                topLevelNames.push(", ", name);
            },
            isNamedType,
        );
        this.emitLine(
            "//   import { Convert",
            topLevelNames,
            ' } from "./',
            this.usageModuleName(givenOutputFilename),
            '";',
        );
    }

    protected emitEnum(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        // enums with only one value are emitted as constants
        if (this._tsFlowOptions.preferConstValues && e.cases.size === 1) return;

        if (this._tsFlowOptions.preferUnions) {
            let items = "";
            e.cases.forEach((item) => {
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
            },
        );
    }
}
