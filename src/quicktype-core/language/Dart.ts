import { Type, EnumType, UnionType, ClassType, ClassProperty } from "../Type";
import { matchType, nullableFromUnion, directlyReachableSingleNamedType } from "../TypeUtils";
import { Sourcelike, maybeAnnotated } from "../Source";
import {
    utf16LegalizeCharacters,
    utf16StringEscape,
    escapeNonPrintableMapper,
    utf16ConcatMap,
    standardUnicodeHexEscape,
    isAscii,
    isLetter,
    isDigit,
    splitIntoWords,
    combineWords,
    allUpperWordStyle,
    firstUpperWordStyle,
    allLowerWordStyle
} from "../support/Strings";
import { Name, Namer, funPrefixNamer, DependencyName } from "../Naming";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { Option } from "../RendererOptions";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { defined, assert } from "../support/Support";
import { RenderContext } from "../Renderer";

export class DartTargetLanguage extends TargetLanguage {
    constructor() {
        super("Dart", ["dart"], "dart");
    }

    protected getOptions(): Option<any>[] {
        return [];
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext): DartRenderer {
        return new DartRenderer(this, renderContext);
    }
}

const keywords = [
    "abstract",
    "do",
    "import",
    "super",
    "as",
    "dynamic",
    "in",
    "switch",
    "assert",
    "else",
    "interface",
    "sync*",
    "async",
    "enum",
    "is",
    "this",
    "async*",
    "export",
    "library",
    "throw",
    "await",
    "external",
    "mixin",
    "true",
    "break",
    "extends",
    "new",
    "try",
    "case",
    "factory",
    "null",
    "typedef",
    "catch",
    "false",
    "operator",
    "var",
    "class",
    "final",
    "part",
    "void",
    "const",
    "finally",
    "rethrow",
    "while",
    "continue",
    "for",
    "return",
    "with",
    "covariant",
    "get",
    "set",
    "yield",
    "default",
    "if",
    "static",
    "yield*",
    "deferred",
    "implements"
];

const typeNamingFunction = funPrefixNamer("types", n => dartNameStyle(true, false, n));
const propertyNamingFunction = funPrefixNamer("properties", n => dartNameStyle(false, false, n));
const enumCaseNamingFunction = funPrefixNamer("enum-cases", n => dartNameStyle(true, true, n));

export const stringEscape = utf16ConcatMap(escapeNonPrintableMapper(isAscii, standardUnicodeHexEscape));

function isStartCharacter(codePoint: number): boolean {
    if (codePoint === 0x5f) return false; // underscore
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
function dartNameStyle(startWithUpper: boolean, upperUnderscore: boolean, original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        upperUnderscore ? allUpperWordStyle : startWithUpper ? firstUpperWordStyle : allLowerWordStyle,
        upperUnderscore ? allUpperWordStyle : firstUpperWordStyle,
        upperUnderscore || startWithUpper ? allUpperWordStyle : allLowerWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
}

export class DartRenderer extends ConvenienceRenderer {
    private _currentFilename: string | undefined;
    private readonly _gettersAndSettersForPropertyName = new Map<Name, [Name, Name]>();

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
    ) {
        super(targetLanguage, renderContext);

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

    protected makePropertyDependencyNames(
        c: ClassType,
        className: Name,
        p: ClassProperty,
        jsonName: string,
        name: Name
    ): Name[] {
        const getterAndSetterNames = this.makeNamesForPropertyGetterAndSetter(c, className, p, jsonName, name);
        this._gettersAndSettersForPropertyName.set(name, getterAndSetterNames);
        return getterAndSetterNames;
    }

    protected startFile(basename: Sourcelike): void {
        assert(this._currentFilename === undefined, "Previous file wasn't finished");
        // FIXME: The filenames should actually be Sourcelikes, too
        this._currentFilename = `${this.sourcelikeToString(basename)}.dart`;
    }

    protected finishFile(): void {
        super.finishFile(defined(this._currentFilename));
        this._currentFilename = undefined;
    }

    protected emitFileHeader(fileName: Sourcelike): void {
        this.startFile(fileName);
        this.ensureBlankLine();
    }

    protected emitDescriptionBlock(lines: string[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    protected emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    protected dartType(t: Type, withIssues: boolean = false): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "dynamic"),
            _nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "dynamic"),
            _boolType => "bool",
            _integerType => "int",
            _doubleType => "double",
            _stringType => "String",
            arrayType => ["List<", this.dartType(arrayType.items, withIssues), ">"],
            classType => this.nameForNamedType(classType),
            mapType => ["Map<String, ", this.dartType(mapType.values, withIssues), ">"],
            enumType => this.nameForNamedType(enumType),
            _unionType => "dynamic"
        );
    }
    protected fromDynamicExpression = (t: Type, ...dynamic: Sourcelike[]): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            _anyType => dynamic,
            _nullType => dynamic,
            _boolType => dynamic,
            _integerType => dynamic,
            _doubleType => dynamic,
            _stringType => dynamic,
            arrayType => {
                var type = this.dartType(arrayType.items);
                if (type === "dynamic" || type === "String" || type === "bool" || type === "int" || type === "double" || type.toString().startsWith("List") || type.toString().startsWith("Map"))
                    return ["new List<", this.dartType(arrayType.items), ">.from(", dynamic, ".map((x) => x))"];
                return ["new List<", this.dartType(arrayType.items), ">.from(", dynamic, ".map((x) => new ", this.dartType(arrayType.items), ".fromJson(x)", "))"];;
            },
            classType => [this.nameForNamedType(classType), ".fromJson(", dynamic, ")"],
            _mapType => ["new Map.from(", dynamic, ")"],
            _enumType => dynamic,
            _unionType => dynamic
        );
    };

    protected toDynamicExpression = (t: Type, ...dynamic: Sourcelike[]): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            _anyType => dynamic,
            _nullType => dynamic,
            _boolType => dynamic,
            _integerType => dynamic,
            _doubleType => dynamic,
            _stringType => dynamic,
            _arrayType => dynamic,
            _classType => [dynamic, ".toJson()"],
            _mapType => dynamic,
            _enumType => dynamic,
            _unionType => dynamic);
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        //this.emitFileHeader(className);
        this.emitDescription(this.descriptionForType(c));
        this.emitBlock(["class ", className], () => {

            this.forEachClassProperty(c, "none", (name, _, p) => {
                this.emitLine(this.dartType(p.type, true), " ", name, ";");
            });
            this.ensureBlankLine();
            this.emitLine(className, "({");
            this.indent(() => {
                this.forEachClassProperty(c, "none", (name, _, _p) => {
                    this.emitLine("this.", name, ",");
                });

            });
            this.emitLine("});");
            this.ensureBlankLine();
            this.emitLine("factory ", className, ".fromJson(Map<String, dynamic> json) => new ", className, "(");
            this.indent(() => {
                this.forEachClassProperty(c, "none", (name, jsonName, property) => {
                    this.emitLine(name, ": ", this.fromDynamicExpression(property.type, "json['", utf16StringEscape(jsonName), "']"), ",");
                });
            });
            this.emitLine(");");
            this.ensureBlankLine();

            this.emitLine("Map<String, dynamic> toJson() => {");
            this.indent(() => {
                this.forEachClassProperty(c, "none", (name, jsonName, property) => {
                    this.emitLine("'", utf16StringEscape(jsonName), "': ", this.toDynamicExpression(property.type, name), ",");
                });
            });
            this.emitLine("};");

        });
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        const caseNames: Sourcelike[] = [];
        this.forEachEnumCase(e, "none", name => {
            if (caseNames.length > 0) caseNames.push(", ");
            caseNames.push(name);
        });
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("enum ", enumName, " { ", caseNames, " }");

    }
    protected emitSourceStructure(): void {
        this.emitFileHeader("TopLevel");
        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) => this.emitClassDefinition(c, n),
            (e, n) => this.emitEnumDefinition(e, n),
            (_e, _n) => {
                //We don't support this yet.
            }
        );

        this.finishFile();
    }
}
