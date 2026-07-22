import type { Name } from "../../Naming.js";
import { type Sourcelike, modifySource } from "../../Source.js";
import { camelCase } from "../../support/Strings.js";
import type { ArrayType, EnumType, MapType, Type } from "../../Type/index.js";

import { KotlinRenderer } from "./KotlinRenderer.js";
import { stringEscape } from "./utils.js";

// kotlinx.serialization has no built-in serializers for java.time, so we
// emit our own and register them file-wide with `@file:UseSerializers`.
// Like the Jackson converters, they parse with `.parse` and format with the
// ISO formatters so values round-trip faithfully.
const dateTimeSerializers = [
    {
        kind: "date-time",
        name: "OffsetDateTimeSerializer",
        type: "OffsetDateTime",
        formatter: "ISO_OFFSET_DATE_TIME",
    },
    {
        kind: "date",
        name: "LocalDateSerializer",
        type: "LocalDate",
        formatter: "ISO_LOCAL_DATE",
    },
    {
        kind: "time",
        name: "OffsetTimeSerializer",
        type: "OffsetTime",
        formatter: "ISO_OFFSET_TIME",
    },
] as const;

/**
 * Currently supports simple classes, enums, and TS string unions (which are also enums).
 * TODO: Union, Any, Top Level Array, Top Level Map
 */
export class KotlinXRenderer extends KotlinRenderer {
    protected forbiddenNamesForGlobalNamespace(): readonly string[] {
        return [
            ...super.forbiddenNamesForGlobalNamespace(),
            ...dateTimeSerializers.map((s) => s.name),
        ];
    }

    private usedDateTimeSerializers(): Array<
        (typeof dateTimeSerializers)[number]
    > {
        return dateTimeSerializers.filter((s) =>
            this.haveTransformedStringType(s.kind),
        );
    }

    protected anySourceType(optional: string): Sourcelike {
        return ["JsonElement", optional];
    }

    protected arrayType(
        arrayType: ArrayType,
        withIssues = false,
        noOptional = false,
    ): Sourcelike {
        const valType = this.kotlinType(arrayType.items, withIssues, true);
        const name = this.sourcelikeToString(valType);
        if (name === "JsonObject" || name === "JsonElement") {
            return "JsonArray";
        }

        return super.arrayType(arrayType, withIssues, noOptional);
    }

    protected mapType(
        mapType: MapType,
        withIssues = false,
        noOptional = false,
    ): Sourcelike {
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
        this.emitLine(
            "// To parse the JSON, install kotlin's serialization plugin and do:",
        );
        this.emitLine("//");
        const table: Sourcelike[][] = [];
        table.push([
            "// val ",
            "json",
            " = Json { allowStructuredMapKeys = true }",
        ]);
        this.forEachTopLevel("none", (_, name) => {
            table.push([
                "// val ",
                modifySource(camelCase, name),
                ` = json.parse(${this.sourcelikeToString(name)}.serializer(), jsonString)`,
            ]);
        });
        this.emitTable(table);
    }

    protected emitFileAnnotations(): void {
        const serializers = this.usedDateTimeSerializers();
        if (serializers.length === 0) return;

        this.emitLine(
            "@file:UseSerializers(",
            serializers.map((s) => `${s.name}::class`).join(", "),
            ")",
        );
        this.ensureBlankLine();
    }

    protected emitHeader(): void {
        super.emitHeader();

        this.emitLine("import kotlinx.serialization.*");
        this.emitLine("import kotlinx.serialization.json.*");
        this.emitLine("import kotlinx.serialization.descriptors.*");
        this.emitLine("import kotlinx.serialization.encoding.*");
    }

    protected emitSourceStructure(): void {
        super.emitSourceStructure();

        for (const serializer of this.usedDateTimeSerializers()) {
            this.ensureBlankLine();
            this.emitMultiline(`object ${serializer.name} : KSerializer<${serializer.type}> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("${serializer.type}", PrimitiveKind.STRING)
    override fun deserialize(decoder: Decoder): ${serializer.type} = ${serializer.type}.parse(decoder.decodeString())
    override fun serialize(encoder: Encoder, value: ${serializer.type}) {
        encoder.encodeString(java.time.format.DateTimeFormatter.${serializer.formatter}.format(value))
    }
}`);
        }
    }

    protected emitClassAnnotations(_c: Type, _className: Name): void {
        this.emitLine("@Serializable");
    }

    protected renameAttribute(
        name: Name,
        jsonName: string,
        _required: boolean,
        meta: Array<() => void>,
    ): void {
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
                this.emitLine(
                    `@SerialName("${jsonEnum}") `,
                    name,
                    `("${jsonEnum}")`,
                    --count === 0 ? ";" : ",",
                );
            });
        });
    }
}
