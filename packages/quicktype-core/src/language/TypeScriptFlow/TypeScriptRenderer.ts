import { isUnionExclusive } from "../../attributes/UnionMembers.js";
import type { Name } from "../../Naming.js";
import {
    type MultiWord,
    type Sourcelike,
    modifySource,
    multiWord,
    singleWord,
} from "../../Source.js";
import { camelCase, utf16StringEscape } from "../../support/Strings.js";
import {
    type ClassType,
    type EnumType,
    ObjectType,
    type Type,
    type UnionType,
} from "../../Type/index.js";
import { isNamedType } from "../../Type/TypeUtils.js";
import type { JavaScriptTypeAnnotations } from "../JavaScript/index.js";

import { TypeScriptFlowBaseRenderer } from "./TypeScriptFlowBaseRenderer.js";
import { tsFlowTypeAnnotations } from "./utils.js";

export class TypeScriptRenderer extends TypeScriptFlowBaseRenderer {
    protected sourceForUnionMembers(unionType: UnionType): MultiWord {
        if (!isUnionExclusive(unionType.getAttributes())) {
            return super.sourceForUnionMembers(unionType);
        }

        const members = Array.from(unionType.members);
        if (
            members.length < 2 ||
            !members.every((member) => member instanceof ObjectType)
        ) {
            return super.sourceForUnionMembers(unionType);
        }

        // TypeScript's excess-property checks allow an object literal to mix
        // properties from different union members.  Exclude sibling keys so a
        // oneOf remains exclusive in the generated type.
        const propertyNames = new Set<string>();
        for (const member of members as ObjectType[]) {
            for (const name of member.getProperties().keys()) {
                propertyNames.add(name);
            }
        }

        const memberSources = (members as ObjectType[]).map((member) => {
            const excludedProperties: Sourcelike[] = [];
            for (const name of propertyNames) {
                if (member.getProperties().has(name)) continue;
                excludedProperties.push(
                    `"${utf16StringEscape(name)}"?: never; `,
                );
            }

            if (excludedProperties.length === 0) {
                return singleWord(this.sourceFor(member).source);
            }

            return singleWord([
                "(",
                this.sourceFor(member).source,
                " & { ",
                excludedProperties,
                "})",
            ]);
        });

        return multiWord(
            " | ",
            ...memberSources.map((source) => source.source),
        );
    }

    protected anyType(): string {
        return this._tsFlowOptions.preferUnknown ? "unknown" : "any";
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return ["Array", "Date"];
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
