import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { Name, Namer, funPrefixNamer } from "../Naming";
import { EnumOption, Option, StringOption, OptionValues, getOptionValues } from "../RendererOptions";
import { Sourcelike, maybeAnnotated } from "../Source";
import {
    allLowerWordStyle,
    allUpperWordStyle,
    combineWords,
    firstUpperWordStyle,
    isDigit,
    isLetterOrUnderscore,
    isNumeric,
    legalizeCharacters,
    splitIntoWords
} from "../support/Strings";
import { assertNever } from "../support/Support";
import { TargetLanguage } from "../TargetLanguage";
import { ArrayType, ClassProperty, ClassType, EnumType, MapType, ObjectType, Type, UnionType } from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../TypeUtils";
import { RenderContext } from "../Renderer";

export enum Framework {
    None,
    Upickle,
    Circe
}

export const scala3Options = {
    framework: new EnumOption(
        "framework",
        "Serialization framework",
        [
            ["just-types", Framework.None],
            ["circe", Framework.Circe],
            ["upickle", Framework.Upickle]
        ],
        undefined
    ),
    packageName: new StringOption("package", "Package", "PACKAGE", "quicktype")
};

// Use backticks for param names with symbols
const invalidSymbols = [
    "?",
    ":",
    "-",
    "+",
    "!",
    "@",
    "#",
    "$",
    "%",
    "^",
    "&",
    "*",
    "(",
    ")",
    ">",
    "<",
    "/",
    ";",
    "'",
    '"',
    "{",
    "}",
    ":",
    "~",
    "`",
    "."
];

const keywords = [
    "abstract",
    "case",
    "catch",
    "class",
    "def",
    "do",
    "else",
    "enum",
    "extends",
    "export",
    "false",
    "final",
    "finally",
    "for",
    "forSome",
    "if",
    "implicit",
    "import",
    "lazy",
    "match",
    "new",
    "null",
    "object",
    "override",
    "package",
    "private",
    "protected",
    "return",
    "sealed",
    "super",
    "this",
    "then",
    "throw",
    "trait",
    "try",
    "true",
    "type",
    "val",
    "var",
    "while",
    "with",
    "yield",
    "Any",
    "Boolean",
    "Double",
    "Float",
    "Long",
    "Int",
    "Short",
    "System",
    "Byte",
    "String",
    "Array",
    "List",
    "Map",
    "Enum"
];

/**
 * Check if given parameter name should be wrapped in a backtick
 * @param paramName
 */
const shouldAddBacktick = (paramName: string): boolean => {
    return (
        keywords.some(s => paramName === s) ||
        invalidSymbols.some(s => paramName.includes(s)) ||
        !isNaN(+parseFloat(paramName)) ||
        !isNaN(parseInt(paramName.charAt(0)))
    );
};

const wrapOption = (s: string, optional: boolean): string => {
    if (optional) {
        return "Option[" + s + "]";
    } else {
        return s;
    }
};

function isPartCharacter(codePoint: number): boolean {
    return isLetterOrUnderscore(codePoint) || isNumeric(codePoint);
}

function isStartCharacter(codePoint: number): boolean {
    return isPartCharacter(codePoint) && !isDigit(codePoint);
}

const legalizeName = legalizeCharacters(isPartCharacter);

function scalaNameStyle(isUpper: boolean, original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        isUpper ? firstUpperWordStyle : allLowerWordStyle,
        firstUpperWordStyle,
        isUpper ? allUpperWordStyle : allLowerWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
}

/* function unicodeEscape(codePoint: number): string {
    return "\\u" + intToHex(codePoint, 4);
} */

//const _stringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, unicodeEscape));

/* function stringEscape(s: string): string {
    // "$this" is a template string in Kotlin so we have to escape $
    return _stringEscape(s).replace(/\$/g, "\\$");
} */

const upperNamingFunction = funPrefixNamer("upper", s => scalaNameStyle(true, s));
const lowerNamingFunction = funPrefixNamer("lower", s => scalaNameStyle(false, s));

export class Scala3Renderer extends ConvenienceRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly _scalaOptions: OptionValues<typeof scala3Options>
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForObjectProperties(_: ObjectType, _classNamed: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(_: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: false };
    }

    protected topLevelNameStyle(rawName: string): string {
        return scalaNameStyle(true, rawName);
    }

    protected makeNamedTypeNamer(): Namer {
        return upperNamingFunction;
    }

    protected namerForObjectProperty(): Namer {
        return lowerNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return funPrefixNamer("upper", s => scalaNameStyle(true, s) + "Value");
    }

    protected makeEnumCaseNamer(): Namer {
        return funPrefixNamer("upper", s => s.replace(" ", "")); // TODO - add backticks where appropriate
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    protected emitBlock(
        line: Sourcelike,
        f: () => void,
        delimiter: "curly" | "paren" | "lambda" | "none" = "curly"
    ): void {
        const [open, close] =
            delimiter === "curly"
                ? ["{", "}"]
                : delimiter === "paren"
                ? ["(", ")"]
                : delimiter === "none"
                ? ["", ""]
                : ["{", "})"];
        this.emitLine(line, " ", open);
        this.indent(f);
        this.emitLine(close);
    }

    protected anySourceType(optional: boolean): Sourcelike {
        return [wrapOption("Any", optional)];
    }

    // (asarazan): I've broken out the following two functions
    // because some renderers, such as kotlinx, can cope with `any`, while some get mad.
    protected arrayType(arrayType: ArrayType, withIssues = false): Sourcelike {
        return ["Seq[", this.scalaType(arrayType.items, withIssues), "]"];
    }

    protected mapType(mapType: MapType, withIssues = false): Sourcelike {
        return ["Map[String, ", this.scalaType(mapType.values, withIssues), "]"];
    }

    protected scalaType(t: Type, withIssues = false, noOptional = false): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => {
                return maybeAnnotated(withIssues, anyTypeIssueAnnotation, this.anySourceType(!noOptional));
            },
            _nullType => {
                //return "None.type"
                return maybeAnnotated(withIssues, nullTypeIssueAnnotation, this.anySourceType(!noOptional));
            },
            _boolType => "Boolean",
            _integerType => "Long",
            _doubleType => "Double",
            _stringType => "String",
            arrayType => this.arrayType(arrayType, withIssues),
            classType => this.nameForNamedType(classType),
            mapType => this.mapType(mapType, withIssues),
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    if (noOptional) {
                        return [this.scalaType(nullable, withIssues)];
                    } else {
                        return ["Option[", this.scalaType(nullable, withIssues), "]"];
                    }
                }
                return this.nameForNamedType(unionType);
            }
        );
    }
    protected emitUsageHeader(): void {
        // To be overridden
    }

    protected emitHeader(): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else {
            this.emitUsageHeader();
        }

        this.ensureBlankLine();
        this.emitLine("package ", this._scalaOptions.packageName);
        this.ensureBlankLine();
    }

    protected emitTopLevelArray(t: ArrayType, name: Name): void {
        const elementType = this.scalaType(t.items);
        this.emitLine(["type ", name, " = List[", elementType, "]"]);
    }

    protected emitTopLevelMap(t: MapType, name: Name): void {
        const elementType = this.scalaType(t.values);
        this.emitLine(["type ", name, " = Map[String, ", elementType, "]"]);
    }

    protected emitEmptyClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitLine("case class ", className, "()");
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        if (c.getProperties().size === 0) {
            this.emitEmptyClassDefinition(c, className);
            return;
        }

        const scalaType = (p: ClassProperty) => {
            if (p.isOptional) {
                return ["Option[", this.scalaType(p.type, true, true), "]"];
            } else {
                return this.scalaType(p.type, true);
            }
        };

        this.emitDescription(this.descriptionForType(c));
        this.emitLine("case class ", className, " (");
        this.indent(() => {
            let count = c.getProperties().size;
            let first = true;
            this.forEachClassProperty(c, "none", (_, jsonName, p) => {
                //console.log(jsonName); // Why is this in different order!!!!!!
                const nullable = p.type.kind === "union" && nullableFromUnion(p.type as UnionType) !== null;
                const nullableOrOptional = p.isOptional || p.type.kind === "null" || nullable;
                const last = --count === 0;
                const meta: Array<() => void> = [];

                const description = this.descriptionForClassProperty(c, jsonName);
                if (description !== undefined) {
                    meta.push(() => this.emitDescription(description));
                }

                if (meta.length > 0 && !first) {
                    this.ensureBlankLine();
                }

                for (const emit of meta) {
                    emit();
                }
                const nameNeedsBackticks = jsonName.endsWith("_") || shouldAddBacktick(jsonName);
                const nameWithBackticks = nameNeedsBackticks ? "`" + jsonName + "`" : jsonName;
                this.emitLine(
                    "val ",
                    nameWithBackticks,
                    " : ",
                    scalaType(p),
                    p.isOptional ? " = None" : nullableOrOptional ? " = None" : "",
                    last ? "" : ","
                );

                if (meta.length > 0 && !last) {
                    this.ensureBlankLine();
                }

                first = false;
            });
        });

        this.emitClassDefinitionMethods();
    }

    protected emitClassDefinitionMethods() {
        this.emitLine(")");
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        //console.log("vanilla");
        this.emitDescription(this.descriptionForType(e));

        this.emitBlock(
            ["enum ", enumName, " : "],
            () => {
                let count = e.cases.size;
                if (count > 0) {
                    this.emitItem("\t case ");
                }
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    //console.log(jsonName);
                    if (!(jsonName == "")) {
                        const backticks =
                            shouldAddBacktick(jsonName) ||
                            jsonName.includes(" ") ||
                            !isNaN(parseInt(jsonName.charAt(0)));
                        if (backticks) {
                            this.emitItem("`");
                        }
                        this.emitItemOnce([name]);
                        if (backticks) {
                            this.emitItem("`");
                        }
                        if (--count > 0) this.emitItem([","]);
                    } else {
                        --count;
                    }
                });
            },
            "none"
        );
    }

    protected emitUnionDefinition(u: UnionType, unionName: Name): void {
        function sortBy(t: Type): string {
            const kind = t.kind;
            if (kind === "class") return kind;
            return "_" + kind;
        }

        this.emitDescription(this.descriptionForType(u));

        const [maybeNull, nonNulls] = removeNullFromUnion(u, sortBy);
        const theTypes: Array<Sourcelike> = [];
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
        this.ensureBlankLine();
    }

    protected emitSourceStructure(): void {
        this.emitHeader();

        // Top-level arrays, maps
        this.forEachTopLevel("leading", (t, name) => {
            if (t instanceof ArrayType) {
                this.emitTopLevelArray(t, name);
            } else if (t instanceof MapType) {
                this.emitTopLevelMap(t, name);
            }
        });

        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) => this.emitClassDefinition(c, n),
            (e, n) => this.emitEnumDefinition(e, n),
            (u, n) => this.emitUnionDefinition(u, n)
        );
    }
}

export class UpickleRenderer extends Scala3Renderer {
    seenUnionTypes: Array<string> = [];

    protected upickleEncoderForType(t: Type, _ = false, noOptional = false, paramName: string = ""): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => ["OptionPickler.writeJs(", paramName, ")"],
            _nullType => ["OptionPickler.writeJs(", paramName, ")"],
            _boolType => ["OptionPickler.writeJs(", paramName, ")"],
            _integerType => ["OptionPickler.writeJs(", paramName, ")"],
            _doubleType => ["OptionPickler.writeJs(", paramName, ")"],
            _stringType => ["OptionPickler.writeJs(", paramName, ")"],
            arrayType => ["OptionPickler.writeJs[", this.scalaType(arrayType.items), "].apply(", paramName, ")"],
            classType => ["OptionPickler.writeJs[", this.scalaType(classType), "].apply(", paramName, ")"],
            mapType => ["OptionPickler.writeJs[String,", this.scalaType(mapType.values), "].apply(", paramName, ")"],
            _ => ["OptionPickler.writeJs(", paramName, ")"],
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    if (noOptional) {
                        return ["OptionPickler.writeJs[", this.nameForNamedType(nullable), "]"];
                    } else {
                        return ["OptionPickler.writeJs[Option[", this.nameForNamedType(nullable), "]]"];
                    }
                }
                return ["OptionPickler.writeJs[", this.nameForNamedType(unionType), "]"];
            }
        );
    }

    protected emitClassDefinitionMethods() {
        this.emitLine(") derives OptionPickler.ReadWriter ");
    }

    protected anySourceType(optional: boolean): Sourcelike {
        return [wrapOption("ujson.Value", optional)];
    }

    protected emitHeader(): void {
        super.emitHeader();
        const optionPickler = `object OptionPickler extends upickle.AttributeTagged :
    import upickle.default.Writer
    import upickle.default.Reader
    override implicit def OptionWriter[T: Writer]: Writer[Option[T]] =
        implicitly[Writer[T]].comap[Option[T]] {
            case None => null.asInstanceOf[T]
            case Some(x) => x
        }

    override implicit def OptionReader[T: Reader]: Reader[Option[T]] = {
        new Reader.Delegate[Any, Option[T]](implicitly[Reader[T]].map(Some(_))){
        override def visitNull(index: Int) = None
        }
    }
end OptionPickler

object JsonExt:
    val valueReader = OptionPickler.readwriter[ujson.Value]
    def badMerge[T](r1: => OptionPickler.Reader[?], rest: OptionPickler.Reader[?]*): OptionPickler.Reader[T] = valueReader.map { json =>
        var t: T | Null = null
        val stack       = Vector.newBuilder[Throwable]
        (r1 +: rest).foreach { reader =>
            if t == null then 
            try 
                t = OptionPickler.read[T](json, trace = true)(using reader.asInstanceOf[OptionPickler.Reader[T]])
            catch
                case exc => stack += exc
        }
        if t != null then t.nn else throw new Exception(json.toString(), stack.result().headOption.getOrElse(null))
    }

    extension [T](r: OptionPickler.Reader[T]) def widen[K >: T] = r.map(_.asInstanceOf[K])
end JsonExt
`;
        //         const singletonPickler = `given singletonStringPickler[A <: Singleton](using A <:< String): OptionPickler.ReadWriter[A] = OptionPickler.readwriter[ujson.Value].bimap[A](
        //     _.toString(),
        //     str => {
        //     str.toString().asInstanceOf[A]()
        //     }
        // )`;
        this.emitMultiline(optionPickler);
        this.ensureBlankLine();
        // this.emitMultiline(singletonPickler);
    }

    protected override emitEmptyClassDefinition(c: ClassType, className: Name): void {
        super.emitEmptyClassDefinition(c, className);
        this.emitItem(" derives OptionPickler.ReadWriter");
        this.ensureBlankLine();
    }

    protected override emitUnionDefinition(u: UnionType, unionName: Name): void {
        // function sortBy(t: Type): string {
        //     const kind = t.kind;
        //     if (kind === "class") return kind;
        //     return "_" + kind;
        // }

        this.emitDescription(this.descriptionForType(u));

        const [maybeNull, nonNulls] = removeNullFromUnion(u, false);
        const theTypes: Array<Sourcelike> = [];
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
        const thisUnionType = theTypes.map(x => this.sourcelikeToString(x)).join(" | ");

        this.ensureBlankLine();
        if (!this.seenUnionTypes.some(y => y === thisUnionType)) {
            this.seenUnionTypes.push(thisUnionType);
            const sourceLikeTypes: Array<[Sourcelike, Type]> = [];
            this.forEachUnionMember(u, nonNulls, "none", null, (_, t) => {
                sourceLikeTypes.push([this.scalaType(t), t]);
            });
            if (maybeNull !== null) {
                sourceLikeTypes.push([this.nameForUnionMember(u, maybeNull), maybeNull]);
            }
            this.ensureBlankLine();
            this.emitLine([
                "given unionWriter",
                unionName,
                ": OptionPickler.Reader[",
                unionName,
                "] = JsonExt.badMerge[",
                unionName,
                "]("
            ]);
            this.indent(() => {
                sourceLikeTypes.forEach(t => {
                    this.emitLine(["summon[OptionPickler.Reader[", t[0], "]],"]);
                });
                this.emitLine(")");
            });
            this.ensureBlankLine();
            this.emitLine([
                "given unionReader",
                unionName,
                ": OptionPickler.Writer[",
                unionName,
                "] = OptionPickler.writer[ujson.Value].comap[",
                unionName,
                "]{ _v =>"
            ]);
            this.indent(() => {
                this.emitLine("(_v: @unchecked) match ");
                this.indent(() => {
                    sourceLikeTypes.forEach(t => {
                        this.emitLine(["case v: ", t[0], " => OptionPickler.write[", t[0], "](v)"]);
                    });
                });
            });
            this.emitLine("}");
        }
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        let hasBlank = false;
        this.forEachEnumCase(e, "none", (_, jsonName) => {
            if (jsonName.trim() == "") {
                hasBlank = true;
            }
        });
        this.ensureBlankLine();
        if (hasBlank) {
            //console.log("enumName: " + enumName + " has blank");
            this.emitItem(["type ", enumName, ' = "" | ', enumName, "NonBlank"]);
            this.ensureBlankLine();
            this.emitLine([
                "given singleton",
                enumName,
                'Pickler[A <: "" | ',
                enumName,
                "NonBlank]: OptionPickler.ReadWriter[A] = "
            ]);

            this.indent(() => {
                this.emitLine(["OptionPickler.readwriter[ujson.Value].bimap[A]("]);
                this.indent(() => {
                    this.emitLine(["_.toString(),"]);
                    this.emitLine(["str => {"]);
                    this.indent(() => {
                        this.emitLine(["val str2 = str.str"]);
                        this.emitLine(["str2 match {"]);
                        this.indent(() => {
                            this.emitLine(['case _ if str2.length == 0 => "".asInstanceOf[A] ']);
                            this.emitLine([
                                "case parseable =>",
                                enumName,
                                "NonBlank.valueOf(parseable).asInstanceOf[A] "
                            ]);
                        });
                        this.emitLine(["}"]);
                    });
                    this.emitLine(["}"]);
                });
                this.emitLine([")"]);
            });
            this.ensureBlankLine();
            //let count = e.cases.size;
            this.ensureBlankLine();
            this.emitLine(["enum ", enumName, "NonBlank derives OptionPickler.ReadWriter: "]);
            this.indent(() => {
                let count = e.cases.size;
                this.forEachEnumCase(e, "none", (_, jsonName) => {
                    if (!(jsonName.trim() == "")) {
                        let strBuild = "";
                        const backticks =
                            shouldAddBacktick(jsonName) ||
                            jsonName.includes(" ") ||
                            !isNaN(parseInt(jsonName.charAt(0)));
                        this.emitItem(["case "]);
                        if (backticks) {
                            strBuild = strBuild + "`";
                        }
                        strBuild = strBuild + jsonName;
                        if (backticks) {
                            strBuild = strBuild + "`";
                        }
                        if (--count > 0) strBuild + ",";
                        this.emitLine([strBuild]);
                    }
                });
            });
        } else {
            //console.log("enumName: " + enumName + " has non blank");
            this.emitLine(["enum ", enumName, " derives OptionPickler.ReadWriter: "]);

            this.indent(() => {
                let count = e.cases.size;
                this.forEachEnumCase(e, "none", (_, jsonName) => {
                    let strBuild = "";
                    const backticks =
                        shouldAddBacktick(jsonName) || jsonName.includes(" ") || !isNaN(parseInt(jsonName.charAt(0)));
                    this.emitItem(["case "]);
                    if (backticks) {
                        strBuild = strBuild + "`";
                    }
                    strBuild = strBuild + jsonName;
                    if (backticks) {
                        strBuild = strBuild + "`";
                    }
                    if (--count > 0) strBuild + ",";
                    this.emitLine([strBuild]);
                });
            });
        }
    }
}

export class CirceRenderer extends Scala3Renderer {
    seenUnionTypes: Array<string> = [];

    protected circeEncoderForType(t: Type, _ = false, noOptional = false, paramName: string = ""): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => ["Encoder.encodeJson(", paramName, ")"],
            _nullType => ["Encoder.encodeNone(", paramName, ")"],
            _boolType => ["Encoder.encodeBoolean(", paramName, ")"],
            _integerType => ["Encoder.encodeLong(", paramName, ")"],
            _doubleType => ["Encoder.encodeDouble(", paramName, ")"],
            _stringType => ["Encoder.encodeString(", paramName, ")"],
            arrayType => ["Encoder.encodeSeq[", this.scalaType(arrayType.items), "].apply(", paramName, ")"],
            classType => ["Encoder.AsObject[", this.scalaType(classType), "].apply(", paramName, ")"],
            mapType => ["Encoder.encodeMap[String,", this.scalaType(mapType.values), "].apply(", paramName, ")"],
            enumType => ["summon[Encoder[", this.scalaType(enumType), "]].apply(", paramName, ")"],
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    if (noOptional) {
                        return ["Encoder.AsObject[", this.nameForNamedType(nullable), "]"];
                    } else {
                        return ["Encoder.AsObject[Option[", this.nameForNamedType(nullable), "]]"];
                    }
                }
                return ["Encoder.AsObject[", this.nameForNamedType(unionType), "]"];
            }
        );
    }

    protected emitEmptyClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.ensureBlankLine();
        this.emitLine("case class ", className, "()  derives Encoder.AsObject, Decoder");
    }

    protected anySourceType(optional: boolean): Sourcelike {
        return [wrapOption("Json", optional)];
    }

    protected emitClassDefinitionMethods() {
        this.emitLine(") derives Encoder.AsObject, Decoder");
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        let hasBlank = false;
        this.forEachEnumCase(e, "none", (_, jsonName) => {
            if (jsonName.trim() == "") {
                hasBlank = true;
            }
        });
        this.ensureBlankLine();

        const isBlank = (str: string): boolean => !str.trim();

        if (hasBlank) {
            //console.log("enumName: " + enumName + " has blank");
            this.emitItem(["type ", enumName, ' = "" | ', enumName, "NonBlank"]);
            this.ensureBlankLine();
            this.emitLine([
                "given ",
                enumName,
                "Enc: Encoder[",
                enumName,
                "] = Encoder.encodeString.contramap(_.toString())"
            ]);
            this.emitLine(["given ", enumName, "Dec: Decoder[", enumName, "] = List[Decoder[", enumName, "]]("]);
            this.indent(() => {
                this.emitLine('Decoder[""].widen,');
                this.emitLine(["Decoder[", enumName, "NonBlank].widen"]);
            });
            this.emitLine(").reduceLeft(_ or _)");

            let count = e.cases.size - 1;

            this.ensureBlankLine();
            //let count = e.cases.size;
            this.ensureBlankLine();
            this.emitLine(["enum ", enumName, "NonBlank :"]);
            this.indent(() => {
                let count = e.cases.size;

                this.forEachEnumCase(e, "none", (_, jsonName) => {
                    let strBuild = "";
                    const backticks =
                        shouldAddBacktick(jsonName) || jsonName.includes(" ") || !isNaN(parseInt(jsonName.charAt(0)));
                    if (!isBlank(jsonName)) {
                        this.emitItem(["case "]);
                    }
                    if (backticks) {
                        strBuild = strBuild + "`";
                    }
                    strBuild = strBuild + jsonName;
                    if (backticks) {
                        strBuild = strBuild + "`";
                    }
                    if (--count > 0) strBuild + ",";
                    // don't emit the blank case
                    if (!isBlank(jsonName)) {
                        this.emitLine([strBuild]);
                    }
                });
            });

            this.emitLine([
                "given Decoder[",
                enumName,
                "NonBlank] = Decoder.decodeString.emapTry(x => Try(",
                enumName,
                "NonBlank.valueOf(x) ))"
            ]);
            this.emitLine("given Encoder[", enumName, "NonBlank] = Encoder.encodeString.contramap(_.toString())");
        } else {
            //console.log("enumName: " + enumName + " has non blank");
            this.emitLine(["enum ", enumName, " : "]);

            this.indent(() => {
                let count = e.cases.size;
                this.forEachEnumCase(e, "none", (_, jsonName) => {
                    let strBuild = "";
                    const backticks =
                        shouldAddBacktick(jsonName) || jsonName.includes(" ") || !isNaN(parseInt(jsonName.charAt(0)));
                    this.emitItem(["case "]);
                    if (backticks) {
                        strBuild = strBuild + "`";
                    }
                    strBuild = strBuild + jsonName;
                    if (backticks) {
                        strBuild = strBuild + "`";
                    }
                    if (--count > 0) strBuild + ",";
                    this.emitLine([strBuild]);
                });
            });
            this.emitLine([
                "given Decoder[",
                enumName,
                "] = Decoder.decodeString.emapTry(x => Try(",
                enumName,
                ".valueOf(x) )) "
            ]);
            this.emitLine(["given Encoder[", enumName, "] = Encoder.encodeString.contramap(_.toString())"]);
            this.ensureBlankLine();
        }
    }

    protected emitHeader(): void {
        super.emitHeader();

        this.emitLine("import scala.util.Try");
        this.emitLine("import io.circe.syntax._");
        this.emitLine("import io.circe._");
        this.emitLine("import cats.syntax.functor._");
        this.ensureBlankLine();

        this.emitLine("// For serialising string unions");
        // this.emitLine(
        //     "given [A <: Singleton](using A <:< String): Decoder[A] = Decoder.decodeString.emapTry(x => Try(x.asInstanceOf[A])) "
        // );
        // this.emitLine(
        //     "given [A <: Singleton](using ev: A <:< String): Encoder[A] = Encoder.encodeString.contramap(ev) "
        // );
        this.ensureBlankLine();
        this.emitLine("// If a union has a null in, then we'll need this too... ");
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
            "]"
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
            "]"
        ]);
    }

    protected emitUnionDefinition(u: UnionType, unionName: Name): void {
        function sortBy(t: Type): string {
            const kind = t.kind;
            if (kind === "class") return kind;
            return "_" + kind;
        }

        this.emitDescription(this.descriptionForType(u));

        const [maybeNull, nonNulls] = removeNullFromUnion(u, sortBy);
        const theTypes: Array<Sourcelike> = [];
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
        const thisUnionType = theTypes.map(x => this.sourcelikeToString(x)).join(" | ");

        this.ensureBlankLine();
        if (!this.seenUnionTypes.some(y => y === thisUnionType)) {
            this.seenUnionTypes.push(thisUnionType);
            const sourceLikeTypes: Array<[Sourcelike, Type]> = [];
            this.forEachUnionMember(u, nonNulls, "none", null, (_, t) => {
                sourceLikeTypes.push([this.scalaType(t), t]);
            });
            if (maybeNull !== null) {
                sourceLikeTypes.push([this.nameForUnionMember(u, maybeNull), maybeNull]);
            }

            this.emitLine(["given Decoder[", unionName, "] = {"]);
            this.indent(() => {
                this.emitLine(["List[Decoder[", unionName, "]]("]);
                this.indent(() => {
                    sourceLikeTypes.forEach(t => {
                        this.emitLine(["Decoder[", t[0], "].widen,"]);
                    });
                });
                this.emitLine(").reduceLeft(_ or _)");
            });
            this.emitLine(["}"]);

            this.ensureBlankLine();

            this.emitLine(["given Encoder[", unionName, "] = Encoder.instance {"]);
            this.indent(() => {
                sourceLikeTypes.forEach((t, i) => {
                    const paramTemp = `enc${i.toString()}`;
                    this.emitLine([
                        "case ",
                        paramTemp,
                        " : ",
                        t[0],
                        " => ",
                        this.circeEncoderForType(t[1], false, false, paramTemp)
                    ]);
                });
            });
            this.emitLine("}");
        }
    }
}

export class Scala3TargetLanguage extends TargetLanguage {
    constructor() {
        super("Scala3", ["scala3"], "scala");
    }

    protected getOptions(): Option<any>[] {
        return [scala3Options.framework, scala3Options.packageName];
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: { [name: string]: any }
    ): ConvenienceRenderer {
        const options = getOptionValues(scala3Options, untypedOptionValues);

        switch (options.framework) {
            case Framework.None:
                return new Scala3Renderer(this, renderContext, options);
            case Framework.Upickle:
                return new UpickleRenderer(this, renderContext, options);
            case Framework.Circe:
                return new CirceRenderer(this, renderContext, options);
            default:
                return assertNever(options.framework);
        }
    }
}
