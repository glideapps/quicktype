import { type Name } from "../../Naming";
import { type RenderContext } from "../../Renderer";
import { type OptionValues } from "../../RendererOptions";
import { type Sourcelike, modifySource } from "../../Source";
import { camelCase } from "../../support/Strings";
import { type TargetLanguage } from "../../TargetLanguage";
import { type ArrayType, type EnumType, type MapType, type Type } from "../../Type";

import { KotlinRenderer } from "./KotlinRenderer";
import { type kotlinOptions } from "./language";
import { stringEscape } from "./utils";

/**
 * Currently supports simple classes, enums, and TS string unions (which are also enums).
 * TODO: Union, Any, Top Level Array, Top Level Map
 */
export class KotlinXRenderer extends KotlinRenderer {
    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        _kotlinOptions: OptionValues<typeof kotlinOptions>
    ) {
        super(targetLanguage, renderContext, _kotlinOptions);
    }

    protected anySourceType(optional: string): Sourcelike {
        return ["JsonElement", optional];
    }

    protected arrayType(arrayType: ArrayType, withIssues = false, noOptional = false): Sourcelike {
        const valType = this.kotlinType(arrayType.items, withIssues, true);
        const name = this.sourcelikeToString(valType);
        if (name === "JsonObject" || name === "JsonElement") {
            return "JsonArray";
        }

        return super.arrayType(arrayType, withIssues, noOptional);
    }

    protected mapType(mapType: MapType, withIssues = false, noOptional = false): Sourcelike {
        const valType = this.kotlinType(mapType.values, withIssues, true);
        const name = this.sourcelikeToString(valType);
        if (name === "JsonObject" || name === "JsonElement") {
            return "JsonObject";
        }

        return super.mapType(mapType, withIssues, noOptional);
    }

    protected emitTopLevelMap(t: MapType, name: Name): void {
        const elementType = this.kotlinType(t.values);
        if (elementType === "JsonObject") {
            this.emitLine(["typealias ", name, " = JsonObject"]);
        } else {
            super.emitTopLevelMap(t, name);
        }
    }

    protected emitTopLevelArray(t: ArrayType, name: Name): void {
        const elementType = this.kotlinType(t.items);
        this.emitLine(["typealias ", name, " = JsonArray<", elementType, ">"]);
    }

    protected emitUsageHeader(): void {
        this.emitLine("// To parse the JSON, install kotlin's serialization plugin and do:");
        this.emitLine("//");
        const table: Sourcelike[][] = [];
        table.push(["// val ", "json", " = Json { allowStructuredMapKeys = true }"]);
        this.forEachTopLevel("none", (_, name) => {
            table.push([
                "// val ",
                modifySource(camelCase, name),
                ` = json.parse(${this.sourcelikeToString(name)}.serializer(), jsonString)`
            ]);
        });
        this.emitTable(table);
    }

    protected emitHeader(): void {
        super.emitHeader();

        this.emitLine("import kotlinx.serialization.*");
        this.emitLine("import kotlinx.serialization.json.*");
        this.emitLine("import kotlinx.serialization.descriptors.*");
        this.emitLine("import kotlinx.serialization.encoding.*");
    }

    protected emitClassAnnotations(_c: Type, _className: Name): void {
        this.emitLine("@Serializable");
    }

    protected renameAttribute(name: Name, jsonName: string, _required: boolean, meta: Array<() => void>): void {
        const rename = this._rename(name, jsonName);
        if (rename !== undefined) {
            meta.push(() => this.emitLine(rename));
        }
    }

    private _rename(propName: Name, jsonName: string): Sourcelike | undefined {
        const escapedName = stringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        if (namesDiffer) {
            return ['@SerialName("', escapedName, '")'];
        }

        return undefined;
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        this.emitLine(["@Serializable"]);
        this.emitBlock(["enum class ", enumName, "(val value: String)"], () => {
            let count = e.cases.size;
            this.forEachEnumCase(e, "none", (name, json) => {
                const jsonEnum = stringEscape(json);
                this.emitLine(`@SerialName("${jsonEnum}") `, name, `("${jsonEnum}")`, --count === 0 ? ";" : ",");
            });
        });
    }
}
