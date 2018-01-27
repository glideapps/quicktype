"use strict";

import * as _ from "lodash";

import {
    Type,
    EnumType,
    UnionType,
    ClassType,
    nullableFromUnion,
    matchTypeExhaustive,
    directlyReachableSingleNamedType
} from "../Type";
import { TypeGraph } from "../TypeGraph";

import { Sourcelike } from "../Source";
import {
    legalizeCharacters,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allUpperWordStyle,
    allLowerWordStyle
} from "../Strings";
import { intercalate, panic } from "../Support";

import { Namer, Name } from "../Naming";

import { ConvenienceRenderer } from "../ConvenienceRenderer";

import { TargetLanguage } from "../TargetLanguage";
import { BooleanOption } from "../RendererOptions";
import { StringTypeMapping } from "../TypeBuilder";

const unicode = require("unicode-properties");

export default class SimpleTypesTargetLanguage extends TargetLanguage {
    private readonly _declareUnionsOption = new BooleanOption("declare-unions", "Declare unions as named types", false);

    constructor() {
        super("Simple Types", ["types"], "txt");
        this.setOptions([this._declareUnionsOption]);
    }

    protected get partialStringTypeMapping(): Partial<StringTypeMapping> {
        return { date: "date", time: "time", dateTime: "date-time" };
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected get rendererClass(): new (
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return SimpleTypesRenderer;
    }
}

function isStartCharacter(utf16Unit: number): boolean {
    return unicode.isAlphabetic(utf16Unit) || utf16Unit === 0x5f; // underscore
}

function isPartCharacter(utf16Unit: number): boolean {
    const category: string = unicode.getCategory(utf16Unit);
    return _.includes(["Nd", "Pc", "Mn", "Mc"], category) || isStartCharacter(utf16Unit);
}

const legalizeName = legalizeCharacters(isPartCharacter);

function simpleNameStyle(original: string, uppercase: boolean): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        uppercase ? firstUpperWordStyle : allLowerWordStyle,
        firstUpperWordStyle,
        uppercase ? allUpperWordStyle : allLowerWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
}

class SimpleTypesRenderer extends ConvenienceRenderer {
    constructor(graph: TypeGraph, leadingComments: string[] | undefined, private readonly inlineUnions: boolean) {
        super(graph, leadingComments);
    }

    protected topLevelNameStyle(rawName: string): string {
        return simpleNameStyle(rawName, true);
    }

    protected makeNamedTypeNamer(): Namer {
        return new Namer("types", n => simpleNameStyle(n, true), []);
    }

    protected namerForClassProperty(): Namer {
        return new Namer("properties", n => simpleNameStyle(n, false), []);
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): Namer {
        return new Namer("enum-cases", n => simpleNameStyle(n, true), []);
    }

    protected namedTypeToNameForTopLevel(type: Type): Type | undefined {
        return directlyReachableSingleNamedType(type);
    }

    sourceFor = (t: Type): Sourcelike => {
        return matchTypeExhaustive<Sourcelike>(
            t,
            _noneType => {
                return panic("None type should have been replaced");
            },
            _anyType => "Any",
            _nullType => "Null",
            _boolType => "Bool",
            _integerType => "Int",
            _doubleType => "Double",
            _stringType => "String",
            arrayType => ["List<", this.sourceFor(arrayType.items), ">"],
            classType => this.nameForNamedType(classType),
            mapType => ["Map<String, ", this.sourceFor(mapType.values), ">"],
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) return ["Maybe<", this.sourceFor(nullable), ">"];

                if (this.inlineUnions) {
                    const children = unionType.children.map((c: Type) => this.sourceFor(c));
                    return intercalate(" | ", children).toArray();
                } else {
                    return this.nameForNamedType(unionType);
                }
            },
            _dateType => "Date",
            _timeType => "Time",
            _dateTimeType => "DateTime"
        );
    };

    private emitClass = (c: ClassType, className: Name) => {
        this.emitLine("class ", className, " {");
        this.indent(() => {
            this.forEachClassProperty(c, "none", (name, _jsonName, p) => {
                this.emitLine(name, p.isOptional ? "?" : "", ": ", this.sourceFor(p.type));
            });
        });
        this.emitLine("}");
    };

    emitEnum = (e: EnumType, enumName: Name) => {
        const caseNames: Sourcelike[] = [];
        this.forEachEnumCase(e, "none", name => {
            if (caseNames.length > 0) caseNames.push(" | ");
            caseNames.push(name);
        });
        this.emitLine("enum ", enumName, " = ", caseNames);
    };

    emitUnion = (u: UnionType, unionName: Name) => {
        this.emitLine("union ", unionName, " {");
        this.indent(() => {
            this.forEach(u.members, false, false, (t: Type) => {
                this.emitLine("case ", this.sourceFor(t));
            });
        });
        this.emitLine("}");
    };

    protected emitSourceStructure() {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines("// ", this.leadingComments);
        }
        this.forEachClass("leading-and-interposing", this.emitClass);
        this.forEachEnum("leading-and-interposing", this.emitEnum);
        if (!this.inlineUnions) {
            this.forEachUnion("leading-and-interposing", this.emitUnion);
        }
    }
}
