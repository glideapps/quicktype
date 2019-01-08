"use strict";

import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { Name, Namer, funPrefixNamer } from "../Naming";
import { Option } from "../RendererOptions";
import { RenderContext } from "../Renderer";
import { MultiWord, Sourcelike, multiWord, parenIfNeeded, singleWord } from "../Source";
import { TargetLanguage } from "../TargetLanguage";
import { Type, ClassType, EnumType, UnionType } from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../TypeUtils";
import { legalizeCharacters, isLetterOrUnderscoreOrDigit, stringEscape, makeNameStyle } from "../support/Strings";

export const pikeOptions = {};

const baseClassName = "JsonEncodable";
const legalizeName = legalizeCharacters(isLetterOrUnderscoreOrDigit);
const namingFunction = funPrefixNamer("namer", makeNameStyle("underscore", legalizeName));
const namedTypeNamingFunction = funPrefixNamer("namer", makeNameStyle("pascal", legalizeName));

export class PikeTargetLanguage extends TargetLanguage {
    constructor() {
        super("Pike", ["pike", "pikelang"], "Pike");
    }
    protected getOptions(): Option<any>[] {
        return [];
    }

    protected makeRenderer(renderContext: RenderContext): PikeRenderer {
        return new PikeRenderer(this, renderContext);
    }
}

export class PikeRenderer extends ConvenienceRenderer {
    protected emitSourceStructure(): void {
        this.emitBaseClass();
        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, className: Name) => this.emitClass(c, className),
            (e, n) => this.emitEnum(e, n),
            (u, n) => this.emitUnion(u, n)
        );
    }

    protected makeEnumCaseNamer(): Namer {
        return namingFunction;
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

    protected forbiddenNamesForObjectProperties(): string[] {
        return ["private", "protected", "public", "return"];
    }

    protected sourceFor(t: Type): MultiWord {
        if (["class", "object", "enum"].indexOf(t.kind) >= 0) {
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

    private emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    private emitBaseClass(): void {
        this.emitBlock(["class ", baseClassName, ";"], () => {
            this.emitBlock(["string encode_json() "], () => {
                this.emitLine(["array(string) members = map(indices(this), lambda(string idx) {"]);
                this.indent(() => {
                    this.emitLine(["return callablep(this[idx])? 0 : idx;"]);
                });
                this.emitLine(["});"]);
                this.emitLine(["members -= ({0});"]);
                this.ensureBlankLine();
                this.emitLine(["array values = map(members, lambda(string idx) {"]);
                this.indent(() => {
                    this.emitLine(["return this[idx];"]);
                });
                this.emitLine(["});"]);
                this.ensureBlankLine();
                this.emitLine(["return Standards.JSON.encode(mkmapping(members, values));"]);
            });
        });
    }

    private emitClassMembers(c: ClassType): void {
        let table: Sourcelike[][] = [];
        this.forEachClassProperty(c, "none", (name, jsonName, p) => {
            const pikeType = this.sourceFor(p.type).source;

            table.push([[pikeType, " "], [name, "; "], ['// json: "', stringEscape(jsonName), '"']]);
        });
        this.emitTable(table);
    }

    private emitClass(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitBlock(["class ", className], () => {
            this.emitLine(["inherit ", baseClassName, ";"]);
            this.ensureBlankLine();
            this.emitClassMembers(c);
            this.ensureBlankLine();
        });
    }

    protected emitEnum(e: EnumType, enumName: Name): void {
        this.emitBlock([e.kind, " ", enumName], () => {
            let table: Sourcelike[][] = [];
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                table.push([[name, ", "], ['// json: "', stringEscape(jsonName), '"']]);
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
    }
}
