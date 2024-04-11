import { type ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { type Name, type Namer } from "../Naming";
import { funPrefixNamer } from "../Naming";
import { type Option } from "../RendererOptions";
import { type RenderContext } from "../Renderer";
import { type MultiWord, type Sourcelike } from "../Source";
import { multiWord, parenIfNeeded, singleWord } from "../Source";
import { TargetLanguage } from "../TargetLanguage";
import { type Type, type ClassType, type EnumType, type UnionType } from "../Type";
import { ArrayType, MapType, PrimitiveType } from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../TypeUtils";
import { legalizeCharacters, isLetterOrUnderscoreOrDigit, stringEscape, makeNameStyle } from "../support/Strings";

export const pikeOptions = {};

const keywords = [
    "auto",
    "nomask",
    "final",
    "static",
    "extern",
    "private",
    "local",
    "public",
    "protected",
    "inline",
    "optional",
    "variant",
    "void",
    "mixed",
    "array",
    "__attribute__",
    "__deprecated__",
    "mapping",
    "multiset",
    "object",
    "function",
    "__func__",
    "program",
    "string",
    "float",
    "int",
    "enum",
    "typedef",
    "if",
    "do",
    "for",
    "while",
    "else",
    "foreach",
    "catch",
    "gauge",
    "class",
    "break",
    "case",
    "const",
    "constant",
    "continue",
    "default",
    "import",
    "inherit",
    "lambda",
    "predef",
    "return",
    "sscanf",
    "switch",
    "typeof",
    "global"
];

const legalizeName = legalizeCharacters(isLetterOrUnderscoreOrDigit);
const enumNamingFunction = funPrefixNamer("enumNamer", makeNameStyle("upper-underscore", legalizeName));
const namingFunction = funPrefixNamer("genericNamer", makeNameStyle("underscore", legalizeName));
const namedTypeNamingFunction = funPrefixNamer("typeNamer", makeNameStyle("pascal", legalizeName));

export class PikeTargetLanguage extends TargetLanguage {
    public constructor() {
        super("Pike", ["pike", "pikelang"], "pmod");
    }

    protected getOptions(): Array<Option<any>> {
        return [];
    }

    protected makeRenderer(renderContext: RenderContext): PikeRenderer {
        return new PikeRenderer(this, renderContext);
    }
}

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
            t => this.namedTypeToNameForTopLevel(t) === undefined
        );
        this.ensureBlankLine();
        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, className: Name) => this.emitClassDefinition(c, className),
            (e, n) => this.emitEnum(e, n),
            (u, n) => this.emitUnion(u, n)
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

    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected sourceFor(t: Type): MultiWord {
        if (["class", "object", "enum"].includes(t.kind)) {
            return singleWord(this.nameForNamedType(t));
        }

        return matchType<MultiWord>(
            t,
            _anyType => singleWord("mixed"),
            _nullType => singleWord("mixed"),
            _boolType => singleWord("bool"),
            _integerType => singleWord("int"),
            _doubleType => singleWord("float"),
            _stringType => singleWord("string"),
            arrayType => singleWord(["array(", this.sourceFor(arrayType.items).source, ")"]),
            _classType => singleWord(this.nameForNamedType(_classType)),
            mapType => {
                let valueSource: Sourcelike;
                const v = mapType.values;

                valueSource = this.sourceFor(v).source;
                return singleWord(["mapping(string:", valueSource, ")"]);
            },
            _enumType => singleWord("enum"),
            unionType => {
                if (nullableFromUnion(unionType) !== null) {
                    const children = Array.from(unionType.getChildren()).map(c => parenIfNeeded(this.sourceFor(c)));
                    return multiWord("|", ...children);
                } else {
                    return singleWord(this.nameForNamedType(unionType));
                }
            }
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
        this.emitBlock([e.kind, " ", enumName], () => {
            let table: Sourcelike[][] = [];
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                table.push([
                    [name, ' = "', stringEscape(jsonName), '", '],
                    ['// json: "', jsonName, '"']
                ]);
            });
            this.emitTable(table);
        });
    }

    protected emitUnion(u: UnionType, unionName: Name): void {
        const isMaybeWithSingleType = nullableFromUnion(u);

        if (isMaybeWithSingleType !== null) {
            return;
        }

        this.emitDescription(this.descriptionForType(u));

        const [, nonNulls] = removeNullFromUnion(u);

        let types: Sourcelike[][] = [];
        this.forEachUnionMember(u, nonNulls, "none", null, (_name, t) => {
            const pikeType = this.sourceFor(t).source;
            types.push([pikeType]);
        });

        this.emitLine([
            "typedef ",
            types.map(r => r.map(sl => this.sourcelikeToString(sl))).join("|"),
            " ",
            unionName,
            ";"
        ]);
        this.ensureBlankLine();
        this.emitBlock([unionName, " ", unionName, "_from_JSON(mixed json)"], () => {
            this.emitLine(["return json;"]);
        });
    }

    private emitBlock(line: Sourcelike, f: () => void, opening: Sourcelike = " {", closing: Sourcelike = "}"): void {
        this.emitLine(line, opening);
        this.indent(f);
        this.emitLine(closing);
    }

    private emitMappingBlock(line: Sourcelike, f: () => void): void {
        this.emitBlock(line, f, "([", "]);");
    }

    private emitClassMembers(c: ClassType): void {
        let table: Sourcelike[][] = [];
        this.forEachClassProperty(c, "none", (name, jsonName, p) => {
            const pikeType = this.sourceFor(p.type).source;

            table.push([
                [pikeType, " "],
                [name, "; "],
                ['// json: "', jsonName, '"']
            ]);
        });
        this.emitTable(table);
    }

    private emitInformationComment() {
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
                "match the expected interface, even if the JSON itself is valid."
            ],
            { lineStart: "// " }
        );
    }

    private emitTopLevelTypedef(t: Type, name: Name) {
        this.emitLine("typedef ", this.sourceFor(t).source, " ", name, ";");
    }

    private emitTopLevelConverter(t: Type, name: Name) {
        this.emitBlock([name, " ", name, "_from_JSON(mixed json)"], () => {
            if (t instanceof PrimitiveType) {
                this.emitLine(["return json;"]);
            } else if (t instanceof ArrayType) {
                if (t.items instanceof PrimitiveType) this.emitLine(["return json;"]);
                else this.emitLine(["return map(json, ", this.sourceFor(t.items).source, "_from_JSON);"]);
            } else if (t instanceof MapType) {
                const type = this.sourceFor(t.values).source;
                this.emitLine(["mapping(string:", type, ") retval = ([]);"]);
                let assignmentRval: Sourcelike;
                if (t.values instanceof PrimitiveType) assignmentRval = ["(", type, ") v"];
                else assignmentRval = [type, "_from_JSON(v)"];
                this.emitBlock(["foreach (json; string k; mixed v)"], () => {
                    this.emitLine(["retval[k] = ", assignmentRval, ";"]);
                });
                this.emitLine(["return retval;"]);
            }
        });
    }

    private emitEncodingFunction(c: ClassType) {
        this.emitBlock(["string encode_json()"], () => {
            this.emitMappingBlock(["mapping(string:mixed) json = "], () => {
                this.forEachClassProperty(c, "none", (name, jsonName) => {
                    this.emitLine(['"', stringEscape(jsonName), '" : ', name, ","]);
                });
            });
            this.ensureBlankLine();
            this.emitLine(["return Standards.JSON.encode(json);"]);
        });
    }

    private emitDecodingFunction(className: Name, c: ClassType) {
        this.emitBlock([className, " ", className, "_from_JSON(mixed json)"], () => {
            this.emitLine([className, " retval = ", className, "();"]);
            this.ensureBlankLine();
            this.forEachClassProperty(c, "none", (name, jsonName) => {
                this.emitLine(["retval.", name, ' = json["', stringEscape(jsonName), '"];']);
            });
            this.ensureBlankLine();
            this.emitLine(["return retval;"]);
        });
    }
}
