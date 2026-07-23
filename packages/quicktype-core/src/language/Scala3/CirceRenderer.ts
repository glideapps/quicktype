import type { Name } from "../../Naming.js";
import type { Sourcelike } from "../../Source.js";
import {
    matchType,
    nullableFromUnion,
    removeNullFromUnion,
} from "../../Type/TypeUtils.js";
import type {
    ArrayType,
    ClassType,
    EnumType,
    MapType,
    Type,
    UnionType,
} from "../../Type/index.js";

import { stringEscape, utf16StringEscape } from "../../support/Strings.js";

import { Scala3Renderer } from "./Scala3Renderer.js";
import {
    propertyNameNeedsMapping,
    unionMemberSortOrder,
    wrapOption,
} from "./utils.js";

export class CirceRenderer extends Scala3Renderer {
    private readonly seenUnionTypes: string[] = [];

    protected circeEncoderForType(
        t: Type,
        __ = false,
        noOptional = false,
        paramName = "",
    ): Sourcelike {
        return matchType<Sourcelike>(
            t,
            (_anyType) => ["Encoder.encodeJson(", paramName, ")"],
            (_nullType) => ["Encoder.encodeNone(", paramName, ")"],
            (_boolType) => ["Encoder.encodeBoolean(", paramName, ")"],
            (_integerType) => ["Encoder.encodeLong(", paramName, ")"],
            (_doubleType) => ["Encoder.encodeDouble(", paramName, ")"],
            (_stringType) => ["Encoder.encodeString(", paramName, ")"],
            (arrayType) => [
                "Encoder.encodeSeq[",
                this.scalaType(arrayType.items),
                "].apply(",
                paramName,
                ")",
            ],
            (classType) => [
                "Encoder.AsObject[",
                this.scalaType(classType),
                "].apply(",
                paramName,
                ")",
            ],
            (mapType) => [
                "Encoder.encodeMap[String,",
                this.scalaType(mapType.values),
                "].apply(",
                paramName,
                ")",
            ],
            (enumType) => [
                "summon[Encoder[",
                this.scalaType(enumType),
                "]].apply(",
                paramName,
                ")",
            ],
            (unionType) => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    if (noOptional) {
                        return [
                            "Encoder.AsObject[",
                            this.nameForNamedType(nullable),
                            "]",
                        ];
                    }

                    return [
                        "Encoder.AsObject[Option[",
                        this.nameForNamedType(nullable),
                        "]]",
                    ];
                }

                return [
                    "Encoder.AsObject[",
                    this.nameForNamedType(unionType),
                    "]",
                ];
            },
        );
    }

    protected emitEmptyClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.ensureBlankLine();
        this.emitLine(
            "case class ",
            className,
            "()  derives Encoder.AsObject, Decoder",
        );
    }

    protected anySourceType(optional: boolean): Sourcelike {
        return [wrapOption("Json", optional)];
    }

    private renamedProperties(c: ClassType): Array<[Name, string]> {
        const renamed: Array<[Name, string]> = [];
        this.forEachClassProperty(c, "none", (name, jsonName) => {
            if (propertyNameNeedsMapping(jsonName)) {
                renamed.push([name, jsonName]);
            }
        });
        return renamed;
    }

    protected emitClassDefinitionMethods(c: ClassType, _className: Name): void {
        this.emitLine(
            this.renamedProperties(c).length === 0
                ? ") derives Encoder.AsObject, Decoder"
                : ")",
        );
    }

    protected emitClassDefinitionPostamble(
        c: ClassType,
        className: Name,
    ): void {
        const renamed = this.renamedProperties(c);
        if (renamed.length === 0) return;

        this.ensureBlankLine();
        this.emitLine(["object ", className, ":"]);
        this.indent(() => {
            this.emitLine("given io.circe.derivation.Configuration =");
            this.indent(() => {
                this.emitLine(
                    "io.circe.derivation.Configuration.default.withTransformMemberNames(",
                );
                this.indent(() => {
                    this.emitLine("io.circe.derivation.renaming.replaceWith(");
                    this.indent(() => {
                        renamed.forEach(([name, jsonName], index) => {
                            this.emitLine([
                                '"',
                                name,
                                `" -> "${utf16StringEscape(jsonName)}"`,
                                index === renamed.length - 1 ? "" : ",",
                            ]);
                        });
                    });
                    this.emitLine(")");
                });
                this.emitLine(")");
            });
            this.emitLine([
                "given io.circe.Codec.AsObject[",
                className,
                "] = io.circe.derivation.ConfiguredCodec.derived",
            ]);
        });
        this.ensureBlankLine();
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));
        this.ensureBlankLine();

        // Enum cases are styled Scala identifiers; the codecs below map
        // them back to the original JSON strings, which can be anything
        // (keywords, `"_"`, `""`, …).
        this.emitLine(["enum ", enumName, " : "]);
        this.indent(() => {
            this.forEachEnumCase(e, "none", (name) => {
                this.emitLine("case ", name);
            });
        });
        this.ensureBlankLine();

        this.emitLine([
            "given Decoder[",
            enumName,
            "] = Decoder.decodeString.emap {",
        ]);
        this.indent(() => {
            // `scala.` in case a generated type is named Right/Left.
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                this.emitLine([
                    `case "${stringEscape(jsonName)}" => scala.Right(`,
                    enumName,
                    ".",
                    name,
                    ")",
                ]);
            });
            this.emitLine([
                'case other => scala.Left("invalid ',
                enumName,
                ': " + other)',
            ]);
        });
        this.emitLine("}");
        this.emitLine([
            "given Encoder[",
            enumName,
            "] = Encoder.encodeString.contramap {",
        ]);
        this.indent(() => {
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                this.emitLine([
                    "case ",
                    enumName,
                    ".",
                    name,
                    ` => "${stringEscape(jsonName)}"`,
                ]);
            });
        });
        this.emitLine("}");
        this.ensureBlankLine();
    }

    protected emitHeader(): void {
        super.emitHeader();

        this.emitLine("import io.circe.syntax._");
        this.emitLine("import io.circe._");
        this.emitLine("import cats.syntax.functor._");
        this.ensureBlankLine();

        this.emitLine(
            "// If a union has a null in, then we'll need this too... ",
        );
        this.emitLine("type NullValue = None.type");
    }

    protected emitTopLevelArray(t: ArrayType, name: Name): void {
        super.emitTopLevelArray(t, name);
        const elementType = this.scalaType(t.items);
        this.emitLine([
            "given (using ev : ",
            elementType,
            "): Encoder[Seq[",
            elementType,
            "]] = Encoder.encodeSeq[",
            elementType,
            "]",
        ]);
    }

    protected emitTopLevelMap(t: MapType, name: Name): void {
        super.emitTopLevelMap(t, name);
        const elementType = this.scalaType(t.values);
        this.ensureBlankLine();
        this.emitLine([
            "given (using ev : ",
            elementType,
            "): Encoder[Map[String, ",
            elementType,
            "]] = Encoder.encodeMap[String, ",
            elementType,
            "]",
        ]);
    }

    protected emitUnionDefinition(u: UnionType, unionName: Name): void {
        this.emitDescription(this.descriptionForType(u));

        const [maybeNull, nonNulls] = removeNullFromUnion(u, false);
        const theTypes: Sourcelike[] = [];
        this.forEachUnionMember(u, nonNulls, "none", null, (_, t) => {
            theTypes.push(this.scalaType(t));
        });
        if (maybeNull !== null) {
            theTypes.push(this.nameForUnionMember(u, maybeNull));
        }

        this.emitItem(["type ", unionName, " = "]);
        theTypes.forEach((t, i) => {
            this.emitItem(i === 0 ? t : [" | ", t]);
        });
        const thisUnionType = theTypes
            .map((x) => this.sourcelikeToString(x))
            .join(" | ");

        this.ensureBlankLine();
        if (!this.seenUnionTypes.some((y) => y === thisUnionType)) {
            this.seenUnionTypes.push(thisUnionType);
            // The decoders are tried in order, most discriminating
            // first (see `unionMemberSortOrder`): circe's numeric
            // decoders accept strings like "5", so the string decoder
            // has to get a shot before them.
            const sourceLikeTypes: Array<[Sourcelike, Type]> = [];
            this.forEachUnionMember(
                u,
                nonNulls,
                "none",
                unionMemberSortOrder,
                (_, t) => {
                    sourceLikeTypes.push([this.scalaType(t), t]);
                },
            );
            if (maybeNull !== null) {
                sourceLikeTypes.push([
                    this.nameForUnionMember(u, maybeNull),
                    maybeNull,
                ]);
            }

            this.emitLine(["given Decoder[", unionName, "] = {"]);
            this.indent(() => {
                this.emitLine(["List[Decoder[", unionName, "]]("]);
                this.indent(() => {
                    sourceLikeTypes.forEach((t) => {
                        this.emitLine(["Decoder[", t[0], "].widen,"]);
                    });
                });
                this.emitLine(").reduceLeft(_ or _)");
            });
            this.emitLine(["}"]);

            this.ensureBlankLine();

            this.emitLine([
                "given Encoder[",
                unionName,
                "] = Encoder.instance {",
            ]);
            this.indent(() => {
                sourceLikeTypes.forEach((t, i) => {
                    const paramTemp = `enc${i.toString()}`;
                    this.emitLine([
                        "case ",
                        paramTemp,
                        " : ",
                        t[0],
                        " => ",
                        this.circeEncoderForType(t[1], false, false, paramTemp),
                    ]);
                });
            });
            this.emitLine("}");
        }
    }
}
