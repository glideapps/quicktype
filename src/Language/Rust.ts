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
import { EnumOption, Option } from "../RendererOptions";
import { defined } from "../Support";

enum Density {
    Normal,
    Dense
}

export default class RustTargetLanguage extends TargetLanguage {
    private readonly _denseOption = new EnumOption("density", "Density", [
        ["normal", Density.Normal],
        ["dense", Density.Dense]
    ]);

    protected get rendererClass(): new (graph: TypeGraph, ...optionValues: any[]) => ConvenienceRenderer {
        return RustRenderer;
    }

    constructor() {
        super("Rust", ["rs", "rust", "rustlang"], "rs");
    }

    protected getOptions(): Option<any>[] {
        return [this._denseOption];
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

class RustRenderer extends ConvenienceRenderer {
    constructor(graph: TypeGraph, leadingComments: string[] | undefined, private readonly _density: Density) {
        super(graph, leadingComments);
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

    protected topLevelNameStyle(rawName: string): string {
        return rustStyle(rawName, false);
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

    private emitStructDefinition = (c: ClassType, className: Name): void => {
        this.emitDescription(this.descriptionForType(c));
        this.emitLine("#[derive(Serialize, Deserialize)]");

        const blankLines = this._density === Density.Dense ? "none" : "interposing";
        const structBody = () =>
            this.forEachClassProperty(c, blankLines, (name, jsonName, prop) => {
                this.emitDescription(this.descriptionForClassProperty(c, jsonName));
                this.emitRenameAttribute(name, jsonName);
                this.emitLine(name, ": ", this.breakCycle(prop.type, true), ",");
            });

        this.emitBlock(["pub struct ", className], structBody);
    };

    private emitBlock = (line: Sourcelike, f: () => void): void => {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    };

    private emitUnion = (u: UnionType, unionName: Name): void => {
        const isMaybeWithSingleType = nullableFromUnion(u);

        if (isMaybeWithSingleType !== null) {
            return;
        }

        this.emitDescription(this.descriptionForType(u));
        this.emitLine("#[derive(Serialize, Deserialize)]");
        this.emitLine("#[serde(untagged)]");

        const [, nonNulls] = removeNullFromUnion(u);

        const blankLines = this._density === Density.Dense ? "none" : "interposing";
        this.emitBlock(["pub enum ", unionName], () =>
            this.forEachUnionMember(u, nonNulls, blankLines, null, (fieldName, t) => {
                const rustType = this.breakCycle(t, true);
                this.emitLine([fieldName, "(", rustType, "),"]);
            })
        );
    };

    emitEnumDefinition = (e: EnumType, enumName: Name): void => {
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("#[derive(Serialize, Deserialize)]");

        const blankLines = this._density === Density.Dense ? "none" : "interposing";
        this.emitBlock(["pub enum ", enumName], () =>
            this.forEachEnumCase(e, blankLines, (name, jsonName) => {
                this.emitRenameAttribute(name, jsonName);
                this.emitLine([name, ","]);
            })
        );
    };

    emitTopLevelAlias = (t: Type, name: Name): void => {
        this.emitLine("pub type ", name, " = ", this.rustType(t), ";");
    };

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

        this.forEachTopLevel("leading", this.emitTopLevelAlias, t => this.namedTypeToNameForTopLevel(t) === undefined);

        this.forEachClass("leading-and-interposing", this.emitStructDefinition);
        this.forEachUnion("leading-and-interposing", this.emitUnion);
        this.forEachEnum("leading-and-interposing", this.emitEnumDefinition);
    }
}
