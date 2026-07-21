import type { Name } from "../../Naming.js";
import type { Sourcelike } from "../../Source.js";
import { utf16StringEscape } from "../../support/Strings.js";
import { defined } from "../../support/Support.js";
import type { ClassType, EnumType, Type } from "../../Type/index.js";
import type { JavaScriptTypeAnnotations } from "../JavaScript/index.js";

import { TypeScriptFlowBaseRenderer } from "./TypeScriptFlowBaseRenderer.js";
import { tsFlowTypeAnnotations } from "./utils.js";

export class FlowRenderer extends TypeScriptFlowBaseRenderer {
    protected anyType(): string {
        return this._tsFlowOptions.preferUnknown ? "mixed" : "any";
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return ["Class", "Date", "Object", "String", "Array", "JSON", "Error"];
    }

    protected uncheckedParsedJson(t: Type, parsedJson: Sourcelike): Sourcelike {
        // With `raw-type any` and `prefer-unknown` the deserializer's
        // parameter is `mixed`, which can't be returned as the target
        // type without a cast.
        if (
            this._tsFlowOptions.rawType !== "json" &&
            this._tsFlowOptions.preferUnknown
        ) {
            return [
                "((",
                parsedJson,
                ": any): ",
                this.sourceFor(t).source,
                ")",
            ];
        }

        return parsedJson;
    }

    protected get typeAnnotations(): JavaScriptTypeAnnotations {
        return { never: "", ...tsFlowTypeAnnotations };
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

    protected emitSourceStructure(givenOutputFilename: string): void {
        this.emitLine("// @flow");
        this.ensureBlankLine();
        super.emitSourceStructure(givenOutputFilename);
    }
}
