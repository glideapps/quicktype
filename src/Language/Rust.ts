import { TargetLanguage } from "../TargetLanguage";
import { TypeGraph } from "../TypeGraph";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import {
    legalizeCharacters,
    splitIntoWords,
    isLetterOrUnderscoreOrDigit,
    combineWords,
    allLowerWordStyle,
    firstUpperWordStyle,
    intToHex,
    utf32ConcatMap,
    escapeNonPrintableMapper,
    isPrintable,
    isAscii,
    isLetterOrUnderscore
} from "../Strings";
import { Name, Namer, funPrefixNamer } from "../Naming";
import { UnionType, nullableFromUnion, Type, ClassType, matchType, removeNullFromUnion, EnumType } from "../Type";
import { Sourcelike, maybeAnnotated } from "../Source";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { BooleanOption, EnumOption, Option } from "../RendererOptions";
import { defined } from "../Support";

export enum Density {
    Normal,
    Dense
}

export enum Visibility {
    Private,
    Crate,
    Public
}

export default class RustTargetLanguage extends TargetLanguage {
    private readonly _denseOption = new EnumOption("density", "Density", [
        ["normal", Density.Normal],
        ["dense", Density.Dense]
    ]);

    private readonly _visibilityOption = new EnumOption("visibility", "Field visibility", [
        ["private", Visibility.Private],
        ["crate", Visibility.Crate],
        ["public", Visibility.Public]
    ]);

    private readonly _deriveDebugOption = new BooleanOption("derive-debug", "Derive Debug impl", false);

    protected get rendererClass(): new (
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return RustRenderer;
    }

    constructor() {
        super("Rust", ["rs", "rust", "rustlang"], "rs");
    }

    protected getOptions(): Option<any>[] {
        return [this._denseOption, this._visibilityOption, this._deriveDebugOption];
    }
}

const keywords = [
    // Special reserved identifiers used internally for elided lifetimes,
    // unnamed method parameters, crate root module, error recovery etc.
    "{{root}}",
    "$crate",

    // Keywords used in the language.
    "as",
    "box",
    "break",
    "const",
    "continue",
    "crate",
    "else",
    "enum",
    "extern",
    "false",
    "fn",
    "for",
    "if",
    "impl",
    "in",
    "let",
    "loop",
    "match",
    "mod",
    "move",
    "mut",
    "pub",
    "ref",
    "return",
    "self",
    "Self",
    "static",
    "struct",
    "super",
    "trait",
    "true",
    "type",
    "unsafe",
    "use",
    "where",
    "while",

    // Keywords reserved for future use.
    "abstract",
    "alignof",
    "become",
    "do",
    "final",
    "macro",
    "offsetof",
    "override",
    "priv",
    "proc",
    "pure",
    "sizeof",
    "typeof",
    "unsized",
    "virtual",
    "yield",

    // Weak keywords, have special meaning only in specific contexts.
    "catch",
    "default",
    "dyn",
    "'static",
    "union"
];

const isAsciiLetterOrUnderscoreOrDigit = (codePoint: number): boolean => {
    if (!isAscii(codePoint)) {
        return false;
    }

    return isLetterOrUnderscoreOrDigit(codePoint);
};

const isAsciiLetterOrUnderscore = (codePoint: number): boolean => {
    if (!isAscii(codePoint)) {
        return false;
    }

    return isLetterOrUnderscore(codePoint);
};

const legalizeName = legalizeCharacters(isAsciiLetterOrUnderscoreOrDigit);

function rustStyle(original: string, isSnakeCase: boolean): string {
    const words = splitIntoWords(original);

    const wordStyle = isSnakeCase ? allLowerWordStyle : firstUpperWordStyle;

    const combined = combineWords(
        words,
        legalizeName,
        wordStyle,
        wordStyle,
        wordStyle,
        wordStyle,
        isSnakeCase ? "_" : "",
        isAsciiLetterOrUnderscore
    );

    return combined === "_" ? "_underscore" : combined;
}

const snakeNamingFunction = funPrefixNamer("default", (original: string) => rustStyle(original, true));
const camelNamingFunction = funPrefixNamer("camel", (original: string) => rustStyle(original, false));

const standardUnicodeRustEscape = (codePoint: number): string => {
    if (codePoint <= 0xffff) {
        return "\\u{" + intToHex(codePoint, 4) + "}";
    } else {
        return "\\u{" + intToHex(codePoint, 6) + "}";
    }
};

const rustStringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, standardUnicodeRustEscape));

export class RustRenderer extends ConvenienceRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        private readonly _density: Density,
        private readonly _visibility: Visibility,
        private readonly _deriveDebug: boolean
    ) {
        super(targetLanguage, graph, leadingComments);
    }

    protected makeNamedTypeNamer(): Namer {
        return camelNamingFunction;
    }

    protected namerForClassProperty(): Namer | null {
        return snakeNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer | null {
        return camelNamingFunction;
    }

    protected makeEnumCaseNamer(): Namer | null {
        return camelNamingFunction;
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForClassProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected get commentLineStart(): string {
        return "/// ";
    }

    private nullableRustType = (t: Type, withIssues: boolean): Sourcelike => {
        return ["Option<", this.breakCycle(t, withIssues), ">"];
    };

    protected isImplicitCycleBreaker(t: Type): boolean {
        const kind = t.kind;
        return kind === "array" || kind === "map";
    }

    private rustType = (t: Type, withIssues: boolean = false): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "serde_json::Value"),
            _nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "Option<serde_json::Value>"),
            _boolType => "bool",
            _integerType => "i64",
            _doubleType => "f64",
            _stringType => "String",
            arrayType => ["Vec<", this.rustType(arrayType.items, withIssues), ">"],
            classType => this.nameForNamedType(classType),
            mapType => ["HashMap<String, ", this.rustType(mapType.values, withIssues), ">"],
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);

                if (nullable !== null) return this.nullableRustType(nullable, withIssues);

                const [hasNull] = removeNullFromUnion(unionType);

                const isCycleBreaker = this.isCycleBreakerType(unionType);

                const name = isCycleBreaker
                    ? ["Box<", this.nameForNamedType(unionType), ">"]
                    : this.nameForNamedType(unionType);

                return hasNull !== null ? (["Option<", name, ">"] as Sourcelike) : name;
            }
        );
    };

    private breakCycle = (t: Type, withIssues: boolean): any => {
        const rustType = this.rustType(t, withIssues);
        const isCycleBreaker = this.isCycleBreakerType(t);

        return isCycleBreaker ? ["Box<", rustType, ">"] : rustType;
    };

    private emitRenameAttribute(propName: Name, jsonName: string) {
        const escapedName = rustStringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        if (namesDiffer || this._density === Density.Normal) {
            this.emitLine('#[serde(rename = "', escapedName, '")]');
        }
    }

    private get visibility(): string {
        if (this._visibility === Visibility.Crate) {
            return "pub(crate) ";
        } else if (this._visibility === Visibility.Public) {
            return "pub ";
        }
        return "";
    }

    protected emitStructDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitLine("#[derive(", this._deriveDebug ? "Debug, " : "", "Serialize, Deserialize)]");

        const blankLines = this._density === Density.Dense ? "none" : "interposing";
        const structBody = () =>
            this.forEachClassProperty(c, blankLines, (name, jsonName, prop) => {
                this.emitDescription(this.descriptionForClassProperty(c, jsonName));
                this.emitRenameAttribute(name, jsonName);
                this.emitLine(this.visibility, name, ": ", this.breakCycle(prop.type, true), ",");
            });

        this.emitBlock(["pub struct ", className], structBody);
    }

    protected emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    protected emitUnion(u: UnionType, unionName: Name): void {
        const isMaybeWithSingleType = nullableFromUnion(u);

        if (isMaybeWithSingleType !== null) {
            return;
        }

        this.emitDescription(this.descriptionForType(u));
        this.emitLine("#[derive(", this._deriveDebug ? "Debug, " : "", "Serialize, Deserialize)]");
        this.emitLine("#[serde(untagged)]");

        const [, nonNulls] = removeNullFromUnion(u);

        const blankLines = this._density === Density.Dense ? "none" : "interposing";
        this.emitBlock(["pub enum ", unionName], () =>
            this.forEachUnionMember(u, nonNulls, blankLines, null, (fieldName, t) => {
                const rustType = this.breakCycle(t, true);
                this.emitLine([fieldName, "(", rustType, "),"]);
            })
        );
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("#[derive(", this._deriveDebug ? "Debug, " : "", "Serialize, Deserialize)]");

        const blankLines = this._density === Density.Dense ? "none" : "interposing";
        this.emitBlock(["pub enum ", enumName], () =>
            this.forEachEnumCase(e, blankLines, (name, jsonName) => {
                this.emitRenameAttribute(name, jsonName);
                this.emitLine([name, ","]);
            })
        );
    }

    protected emitTopLevelAlias(t: Type, name: Name): void {
        this.emitLine("pub type ", name, " = ", this.rustType(t), ";");
    }

    protected emitUsageExample(): void {
        const topLevelName = defined(this.topLevels.keySeq().first());
        this.emitMultiline(
            `// Example code that deserializes and serializes the model.
// extern crate serde;
// #[macro_use]
// extern crate serde_derive;
// extern crate serde_json;
//
// use generated_module::${topLevelName};
//
// fn main() {
//     let json = r#"{"answer": 42}"#;
//     let model: ${topLevelName} = serde_json::from_str(&json).unwrap();
// }`
        );
    }

    protected emitSourceStructure(): void {
        this.emitUsageExample();
        this.emitLine();
        this.emitLine("extern crate serde_json;");

        if (this.haveMaps) {
            this.emitLine("use std::collections::HashMap;");
        }

        this.forEachTopLevel(
            "leading",
            (t, name) => this.emitTopLevelAlias(t, name),
            t => this.namedTypeToNameForTopLevel(t) === undefined
        );

        this.forEachClass("leading-and-interposing", (c, name) => this.emitStructDefinition(c, name));
        this.forEachUnion("leading-and-interposing", (u, name) => this.emitUnion(u, name));
        this.forEachEnum("leading-and-interposing", (e, name) => this.emitEnumDefinition(e, name));
    }
}
