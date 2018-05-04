import { Map } from "immutable";

import { TypeKind, Type, ArrayType, MapType, EnumType, UnionType, ClassType, ClassProperty } from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion, directlyReachableSingleNamedType } from "../TypeUtils";
import { TypeGraph } from "../TypeGraph";
import { Sourcelike, maybeAnnotated } from "../Source";
import {
    utf16LegalizeCharacters,
    escapeNonPrintableMapper,
    utf16ConcatMap,
    standardUnicodeHexEscape,
    isAscii,
    isLetter,
    isDigit,
    capitalize,
    splitIntoWords,
    combineWords,
    allUpperWordStyle,
    firstUpperWordStyle,
    allLowerWordStyle
} from "../Strings";
import { Name, Namer, funPrefixNamer, DependencyName } from "../Naming";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { BooleanOption, StringOption, Option } from "../RendererOptions";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { defined, assert, assertNever } from "../Support";

export class ScalaTargetLanguage extends TargetLanguage {
    private readonly _justTypesOption = new BooleanOption("just-types", "Plain types only", false);
    // FIXME: Do this via a configurable named eventually.
    private readonly _packageOption = new StringOption("package", "Generated package name", "NAME", "io.quicktype");

    constructor() {
        super("Scala", ["scala"], "scala");
    }

    protected getOptions(): Option<any>[] {
        return [this._packageOption, this._justTypesOption];
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected get rendererClass(): new (
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return ScalaRenderer;
    }
}

const keywords = [
    "abstract",
    "case",
    "catch",
    "class",
    "def",
    "do",
    "else",
    "extends",
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
    "throw",
    "trait",
    "try",
    "true",
    "type",
    "val",
    "var",
    "while",
    "with",
    "yield"
];

const typeNamingFunction = funPrefixNamer("types", n => scalaNameStyle(true, false, n));
const propertyNamingFunction = funPrefixNamer("properties", n => scalaNameStyle(false, false, n));
const enumCaseNamingFunction = funPrefixNamer("enum-cases", n => scalaNameStyle(false, false, n));

export const stringEscape = utf16ConcatMap(escapeNonPrintableMapper(isAscii, standardUnicodeHexEscape));

function isStartCharacter(codePoint: number): boolean {
    if (codePoint === 0x5f) return true; // underscore
    return isAscii(codePoint) && isLetter(codePoint);
}

function isPartCharacter(codePoint: number): boolean {
    return isStartCharacter(codePoint) || (isAscii(codePoint) && isDigit(codePoint));
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

// FIXME: Handle acronyms consistently.  In particular, that means that
// we have to use namers to produce the getter and setter names - we can't
// just capitalize and concatenate.
// https://stackoverflow.com/questions/8277355/naming-convention-for-upper-case-abbreviations
function scalaNameStyle(startWithUpper: boolean, upperUnderscore: boolean, original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        upperUnderscore ? allUpperWordStyle : startWithUpper ? firstUpperWordStyle : allLowerWordStyle,
        upperUnderscore ? allUpperWordStyle : firstUpperWordStyle,
        upperUnderscore || startWithUpper ? allUpperWordStyle : allLowerWordStyle,
        allUpperWordStyle,
        upperUnderscore ? "_" : "",
        isStartCharacter
    );
}

export class ScalaRenderer extends ConvenienceRenderer {
    private _currentFilename: string | undefined;

    constructor(
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        private readonly _packageName: string,
        private readonly _justTypes: boolean
    ) {
        super(targetLanguage, graph, leadingComments);
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected makeNamedTypeNamer(): Namer {
        return typeNamingFunction;
    }

    protected namerForObjectProperty(): Namer {
        return propertyNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return propertyNamingFunction;
    }

    protected makeEnumCaseNamer(): Namer {
        return enumCaseNamingFunction;
    }

    protected unionNeedsName(u: UnionType): boolean {
        return nullableFromUnion(u) === null;
    }

    protected namedTypeToNameForTopLevel(type: Type): Type | undefined {
        // If the top-level type doesn't contain any classes or unions
        // we have to define a class just for the `FromJson` method, in
        // emitFromJsonForTopLevel.
        return directlyReachableSingleNamedType(type);
    }

    protected makeNamesForPropertyGetterAndSetter(
        _c: ClassType,
        _className: Name,
        _p: ClassProperty,
        _jsonName: string,
        name: Name
    ): [Name, Name] {
        const getterName = new DependencyName(propertyNamingFunction, name.order, lookup => `get_${lookup(name)}`);
        const setterName = new DependencyName(propertyNamingFunction, name.order, lookup => `set_${lookup(name)}`);
        return [getterName, setterName];
    }

    protected startFile(basename: Sourcelike): void {
        assert(this._currentFilename === undefined, "Previous file wasn't finished");
        // FIXME: The filenames should actually be Sourcelikes, too
        this._currentFilename = `${this.sourcelikeToString(basename)}.scala`;
    }

    protected finishFile(): void {
        super.finishFile(defined(this._currentFilename));
        this._currentFilename = undefined;
    }

    protected emitDescriptionBlock(lines: string[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    protected emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    protected scalaType(t: Type, withIssues: boolean = false): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "Any"),
            _nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "Any"),
            _boolType => "Boolean",
            _integerType => "Long",
            _doubleType => "Double",
            _stringType => "String",
            arrayType => ["Seq[", this.scalaType(arrayType.items, withIssues), "]"],
            classType => this.nameForNamedType(classType),
            mapType => ["Map[String, ", this.scalaType(mapType.values, withIssues), "]"],
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) return this.scalaType(nullable, withIssues);
                return this.nameForNamedType(unionType);
            }
        );
    }

    protected scalaTypeWithoutGenerics(t: Type): Sourcelike {
        if (t instanceof ArrayType) {
            return [this.scalaTypeWithoutGenerics(t.items), "[]"];
        } else if (t instanceof MapType) {
            return "Map";
        } else if (t instanceof UnionType) {
            const nullable = nullableFromUnion(t);
            if (nullable !== null) return this.scalaTypeWithoutGenerics(nullable);
            return this.nameForNamedType(t);
        } else {
            return this.scalaType(t);
        }
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitLine("case class ", className, "(");
        this.indent(() => {
            this.forEachClassProperty(c, "none", (name, _, p) => {
                // TODO remove last comma
                this.emitLine(name, ": ", this.scalaType(p.type, true), ",");
            });
        });
        this.emitLine(")");
        this.ensureBlankLine();
        this.emitLine("case object ", className, " {");
        this.emitLine("    val jsonReads: Reads[", className, "] = Json.reads[", className, "]");
        this.emitLine("}");
    }

    // TODO union???
    protected unionField(
        u: UnionType,
        t: Type,
        withIssues: boolean = false
    ): { fieldType: Sourcelike; fieldName: Sourcelike } {
        const fieldType = this.scalaType(t, withIssues);
        // FIXME: "Value" should be part of the name.
        const fieldName = [this.nameForUnionMember(u, t), "Value"];
        return { fieldType, fieldName };
    }

    protected emitUnionDefinition(u: UnionType, unionName: Name): void {
        const tokenCase = (tokenType: string): void => {
            this.emitLine("case ", tokenType, ":");
        };

        const emitNullDeserializer = (): void => {
            tokenCase("VALUE_NULL");
            this.indent(() => this.emitLine("break;"));
        };

        const emitDeserializeType = (t: Type): void => {
            const { fieldName } = this.unionField(u, t);
            const rendered = this.scalaTypeWithoutGenerics(t);
            this.emitLine("value.", fieldName, " = jsonParser.readValueAs(", rendered, ".class);");
            this.emitLine("break;");
        };

        const emitDeserializer = (tokenTypes: string[], kind: TypeKind): void => {
            const t = u.findMember(kind);
            if (t === undefined) return;

            for (const tokenType of tokenTypes) {
                tokenCase(tokenType);
            }
            this.indent(() => emitDeserializeType(t));
        };

        const emitDoubleSerializer = (): void => {
            const t = u.findMember("double");
            if (t === undefined) return;

            if (u.findMember("integer") === undefined) tokenCase("VALUE_NUMBER_INT");
            tokenCase("VALUE_NUMBER_FLOAT");
            this.indent(() => emitDeserializeType(t));
        };

        this.emitDescription(this.descriptionForType(u));
        if (!this._justTypes) {
            this.emitLine("@JsonDeserialize(using = ", unionName, ".Deserializer.class)");
            this.emitLine("@JsonSerialize(using = ", unionName, ".Serializer.class)");
        }
        const [maybeNull, nonNulls] = removeNullFromUnion(u);
        this.emitBlock(["public class ", unionName], () => {
            nonNulls.forEach(t => {
                const { fieldType, fieldName } = this.unionField(u, t, true);
                this.emitLine("public ", fieldType, " ", fieldName, ";");
            });
            if (this._justTypes) return;
            this.ensureBlankLine();
            this.emitBlock(["static class Deserializer extends JsonDeserializer<", unionName, ">"], () => {
                this.emitLine("@Override");
                this.emitBlock(
                    [
                        "public ",
                        unionName,
                        " deserialize(JsonParser jsonParser, DeserializationContext deserializationContext) throws IOException, JsonProcessingException"
                    ],
                    () => {
                        this.emitLine(unionName, " value = new ", unionName, "();");
                        this.emitLine("switch (jsonParser.getCurrentToken()) {");
                        if (maybeNull !== null) emitNullDeserializer();
                        emitDeserializer(["VALUE_NUMBER_INT"], "integer");
                        emitDoubleSerializer();
                        emitDeserializer(["VALUE_TRUE", "VALUE_FALSE"], "bool");
                        emitDeserializer(["VALUE_STRING"], "string");
                        emitDeserializer(["START_ARRAY"], "array");
                        emitDeserializer(["START_OBJECT"], "class");
                        emitDeserializer(["VALUE_STRING"], "enum");
                        emitDeserializer(["START_OBJECT"], "map");
                        this.emitLine('default: throw new IOException("Cannot deserialize ', unionName, '");');
                        this.emitLine("}");
                        this.emitLine("return value;");
                    }
                );
            });
            this.ensureBlankLine();
            this.emitBlock(["static class Serializer extends JsonSerializer<", unionName, ">"], () => {
                this.emitLine("@Override");
                this.emitBlock(
                    [
                        "public void serialize(",
                        unionName,
                        " obj, JsonGenerator jsonGenerator, SerializerProvider serializerProvider) throws IOException"
                    ],
                    () => {
                        nonNulls.forEach(t => {
                            const { fieldName } = this.unionField(u, t, true);
                            this.emitBlock(["if (obj.", fieldName, " != null)"], () => {
                                this.emitLine("jsonGenerator.writeObject(obj.", fieldName, ");");
                                this.emitLine("return;");
                            });
                        });
                        if (maybeNull !== null) {
                            this.emitLine("jsonGenerator.writeNull();");
                        } else {
                            this.emitLine('throw new IOException("', unionName, ' must not be null");');
                        }
                    }
                );
            });
        });
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("object ", enumName, " extends Enumeration {");
        this.indent(() => {
            this.ensureBlankLine();
            this.emitLine("type ", enumName, " = Value");
            this.ensureBlankLine();

            this.forEachEnumCase(e, "none", name => {
                this.emitLine("val ", name, ' = Value("', name, '")');
            });

            this.ensureBlankLine();
            this.emitLine("implicit val ", enumName, "Reads = Reads.enumNameReads(", enumName, ")");
            this.emitLine("implicit val ", enumName, "Writes = Writes.enumNameWrites");
        });
        this.emitLine("}");
    }

    protected emitSourceStructure(): void {
        this.startFile("Model.scala");
        this.ensureBlankLine();
        this.emitLine("import java.time._");
        this.emitLine("import play.api.libs.json._");
        this.ensureBlankLine();

        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) => this.emitClassDefinition(c, n),
            (e, n) => this.emitEnumDefinition(e, n),
            (u, n) => this.emitUnionDefinition(u, n)
        );

        this.finishFile();
    }
}
