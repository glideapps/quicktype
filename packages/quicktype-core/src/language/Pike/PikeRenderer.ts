import {
    ConvenienceRenderer,
    type ForbiddenWordsInfo,
} from "../../ConvenienceRenderer.js";
import type { Name, Namer } from "../../Naming.js";
import {
    type MultiWord,
    type Sourcelike,
    multiWord,
    parenIfNeeded,
    singleWord,
} from "../../Source.js";
import { stringEscape } from "../../support/Strings.js";
import {
    ArrayType,
    type ClassType,
    EnumType,
    MapType,
    PrimitiveType,
    type Type,
    UnionType,
} from "../../Type/index.js";
import {
    matchType,
    nullableFromUnion,
    removeNullFromUnion,
} from "../../Type/TypeUtils.js";

import { keywords } from "./constants.js";
import {
    enumNamingFunction,
    namedTypeNamingFunction,
    namingFunction,
} from "./utils.js";

export class PikeRenderer extends ConvenienceRenderer {
    protected emitSourceStructure(): void {
        this.emitInformationComment();
        this.ensureBlankLine();
        this.forEachTopLevel(
            "leading",
            (t, name) => {
                this.emitTopLevelTypedef(t, name);
                this.ensureBlankLine();
                this.emitTopLevelConverter(t, name);
                this.ensureBlankLine();
            },
            (t) => this.namedTypeToNameForTopLevel(t) === undefined,
        );
        this.ensureBlankLine();
        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, className: Name) =>
                this.emitClassDefinition(c, className),
            (e, n) => this.emitEnum(e, n),
            (u, n) => this.emitUnion(u, n),
        );
    }

    protected get enumCasesInGlobalNamespace(): boolean {
        return true;
    }

    protected makeEnumCaseNamer(): Namer {
        return enumNamingFunction;
    }

    protected makeNamedTypeNamer(): Namer {
        return namedTypeNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return namingFunction;
    }

    protected namerForObjectProperty(): Namer {
        return namingFunction;
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return [...keywords];
    }

    protected forbiddenForObjectProperties(
        _c: ClassType,
        _className: Name,
    ): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(
        _e: EnumType,
        _enumName: Name,
    ): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForUnionMembers(
        _u: UnionType,
        _unionName: Name,
    ): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected sourceFor(t: Type): MultiWord {
        if (["class", "object", "enum"].includes(t.kind)) {
            return singleWord(this.nameForNamedType(t));
        }

        return matchType<MultiWord>(
            t,
            (_anyType) => singleWord("mixed"),
            (_nullType) => singleWord("mixed"),
            (_boolType) => singleWord("bool"),
            (_integerType) => singleWord("int"),
            (_doubleType) => singleWord("float"),
            (_stringType) => singleWord("string"),
            (arrayType) =>
                singleWord([
                    "array(",
                    this.sourceFor(arrayType.items).source,
                    ")",
                ]),
            (_classType) => singleWord(this.nameForNamedType(_classType)),
            (mapType) => {
                const v = mapType.values;
                const valueSource: Sourcelike = this.sourceFor(v).source;

                return singleWord(["mapping(string:", valueSource, ")"]);
            },
            (_enumType) => singleWord("enum"),
            (unionType) => {
                if (nullableFromUnion(unionType) !== null) {
                    const children = Array.from(unionType.getChildren()).map(
                        (c) => parenIfNeeded(this.sourceFor(c)),
                    );
                    return multiWord("|", ...children);
                }

                return singleWord(this.nameForNamedType(unionType));
            },
        );
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitBlock(["class ", className], () => {
            this.emitClassMembers(c);
            this.ensureBlankLine();
            this.emitEncodingFunction(c);
        });
        this.ensureBlankLine();
        this.emitDecodingFunction(className, c);
    }

    protected emitEnum(e: EnumType, enumName: Name): void {
        const checks: string[] = [];
        this.emitBlock([e.kind, " ", enumName], () => {
            const table: Sourcelike[][] = [];
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                checks.push(`json != "${stringEscape(jsonName)}"`);
                table.push([
                    [name, ' = "', stringEscape(jsonName), '", '],
                    ['// json: "', stringEscape(jsonName), '"'],
                ]);
            });
            this.emitTable(table);
        });
        this.ensureBlankLine();
        const check = `if(json&&${checks.join("&&")})error("enum");`;
        this.emitBlock(
            [enumName, " ", enumName, "_from_JSON(mixed json)"],
            () => this.emitLine(check, "return json;"),
        );
    }

    protected emitUnion(u: UnionType, unionName: Name): void {
        const isMaybeWithSingleType = nullableFromUnion(u);

        if (isMaybeWithSingleType !== null) {
            return;
        }

        this.emitDescription(this.descriptionForType(u));

        const [, nonNulls] = removeNullFromUnion(u);

        const types: Sourcelike[][] = [];
        this.forEachUnionMember(u, nonNulls, "none", null, (_name, t) => {
            const pikeType = this.sourceFor(t).source;
            types.push([pikeType]);
        });

        this.emitLine([
            "typedef ",
            types
                .map((r) => r.map((sl) => this.sourcelikeToString(sl)))
                .join("|"),
            " ",
            unionName,
            ";",
        ]);
        this.ensureBlankLine();
        this.emitBlock(
            [unionName, " ", unionName, "_from_JSON(mixed json)"],
            () => {
                this.emitLine(["return json;"]);
            },
        );
    }

    private emitBlock(
        line: Sourcelike,
        f: () => void,
        opening: Sourcelike = " {",
        closing: Sourcelike = "}",
    ): void {
        this.emitLine(line, opening);
        this.indent(f);
        this.emitLine(closing);
    }

    private emitMappingBlock(line: Sourcelike, f: () => void): void {
        this.emitBlock(line, f, "([", "]);");
    }

    private emitClassMembers(c: ClassType): void {
        const table: Sourcelike[][] = [];
        this.forEachClassProperty(c, "none", (name, jsonName, p) => {
            const pikeType = this.sourceFor(p.type).source;

            table.push([
                [pikeType, " "],
                [name, "; "],
                ['// json: "', stringEscape(jsonName), '"'],
            ]);
        });
        this.emitTable(table);
    }

    private emitInformationComment(): void {
        this.emitCommentLines(
            [
                "This source has been automatically generated by quicktype.",
                "( https://github.com/quicktype/quicktype )",
                "",
                "To use this code, simply import it into your project as a Pike module.",
                "To JSON-encode your object, you can pass it to `Standards.JSON.encode`",
                "or call `encode_json` on it.",
                "",
                "To decode a JSON string, first pass it to `Standards.JSON.decode`,",
                "and then pass the result to `<YourClass>_from_JSON`.",
                "It will return an instance of <YourClass>.",
                "Bear in mind that these functions have unexpected behavior,",
                "and will likely throw an error, if the JSON string does not",
                "match the expected interface, even if the JSON itself is valid.",
            ],
            { lineStart: "// " },
        );
    }

    private emitTopLevelTypedef(t: Type, name: Name): void {
        this.emitLine("typedef ", this.sourceFor(t).source, " ", name, ";");
    }

    private emitTopLevelConverter(t: Type, name: Name): void {
        this.emitBlock([name, " ", name, "_from_JSON(mixed json)"], () => {
            if (t instanceof PrimitiveType) {
                this.emitLine(["return json;"]);
            } else if (t instanceof ArrayType) {
                if (t.items.kind === "integer") {
                    this.emitMultiline(`return map(json, lambda(mixed value) {
    if (!intp(value)) error("Expected integer");
    return (int)value;
});`);
                } else if (t.items instanceof PrimitiveType)
                    this.emitLine(["return json;"]);
                else
                    this.emitLine([
                        "return map(json, ",
                        this.sourceFor(t.items).source,
                        "_from_JSON);",
                    ]);
            } else if (t instanceof MapType) {
                const type = this.sourceFor(t.values).source;
                this.emitLine(["mapping(string:", type, ") retval = ([]);"]);
                let assignmentRval: Sourcelike;
                if (t.values instanceof PrimitiveType)
                    assignmentRval = ["(", type, ") v"];
                else assignmentRval = [type, "_from_JSON(v)"];
                this.emitBlock(["foreach (json; string k; mixed v)"], () => {
                    this.emitLine(["retval[k] = ", assignmentRval, ";"]);
                });
                this.emitLine(["return retval;"]);
            }
        });
    }

    private emitEncodingFunction(c: ClassType): void {
        this.emitBlock(["string encode_json()"], () => {
            this.emitMappingBlock(["mapping(string:mixed) json = "], () => {
                this.forEachClassProperty(c, "none", (name, jsonName) => {
                    this.emitLine([
                        '"',
                        stringEscape(jsonName),
                        '" : ',
                        name,
                        ",",
                    ]);
                });
            });
            this.ensureBlankLine();
            this.emitLine(["return Standards.JSON.encode(json);"]);
        });
    }

    private emitDecodingFunction(className: Name, c: ClassType): void {
        this.emitBlock(
            [className, " ", className, "_from_JSON(mixed json)"],
            () => {
                this.emitLine([className, " retval = ", className, "();"]);
                this.ensureBlankLine();
                this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                    const rejectsArray =
                        p.type instanceof UnionType &&
                        nullableFromUnion(p.type) === null &&
                        !Array.from(p.type.members).some(
                            (t) => t instanceof ArrayType,
                        );
                    if (rejectsArray) {
                        this.emitLine(
                            `if (arrayp(json["${stringEscape(jsonName)}"])) error("Unexpected array");`,
                        );
                    }
                    if (
                        !p.isOptional &&
                        p.type instanceof MapType &&
                        p.type.values.kind === "integer"
                    ) {
                        this.emitLine(
                            `foreach (json["${stringEscape(jsonName)}"]; mixed _; mixed value) if (!intp(value)) error("Expected integer");`,
                        );
                    }
                    if (!p.isOptional && p.type.kind === "bool") {
                        this.emitLine(
                            `if (json["${stringEscape(jsonName)}"] != Standards.JSON.true && json["${stringEscape(jsonName)}"] != Standards.JSON.false) error("Expected bool");`,
                        );
                    }
                    const mapType =
                        p.type instanceof UnionType
                            ? nullableFromUnion(p.type)
                            : p.type;
                    const rejectsStringMap =
                        mapType instanceof MapType &&
                        mapType.values instanceof UnionType &&
                        !Array.from(mapType.values.members).some(
                            (t) => t.kind === "string",
                        );
                    if (rejectsStringMap) {
                        this.emitLine(
                            `foreach (json["${stringEscape(jsonName)}"]; mixed _; mixed value) if (stringp(value)) error("Unexpected string");`,
                        );
                    }
                    if (
                        !p.isOptional &&
                        p.type.kind === "union" &&
                        nullableFromUnion(p.type as UnionType) !== null
                    ) {
                        this.emitLine(
                            'if (!has_index(json, "',
                            stringEscape(jsonName),
                            '")) error("Missing required property");',
                        );
                    }

                    const enumType =
                        p.type instanceof UnionType
                            ? nullableFromUnion(p.type)
                            : p.type;
                    this.emitLine([
                        "retval.",
                        name,
                        " = ",
                        enumType instanceof EnumType
                            ? [
                                  this.nameForNamedType(enumType),
                                  '_from_JSON(json["',
                              ]
                            : [
                                  p.type.kind === "double" ? "(float)" : "",
                                  'json["',
                              ],
                        stringEscape(jsonName),
                        enumType instanceof EnumType ? '"])' : '"]',
                        ";",
                    ]);
                });
                this.ensureBlankLine();
                this.emitLine(["return retval;"]);
            },
        );
    }
}
