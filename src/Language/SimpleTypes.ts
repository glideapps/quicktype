"use strict";

import * as _ from "lodash";

import { Type, EnumType, UnionType, NamedType, ClassType, nullableFromUnion, matchTypeExhaustive } from "../Type";
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
import { intercalate } from "../Support";

import { Namer, Name } from "../Naming";

import { RenderResult } from "../Renderer";
import { ConvenienceRenderer } from "../ConvenienceRenderer";

import { TargetLanguage } from "../TargetLanguage";
import { BooleanOption } from "../RendererOptions";
import { StringTypeMapping } from "../TypeBuilder";

const unicode = require("unicode-properties");

export default class SimpleTypesTargetLanguage extends TargetLanguage {
    static declareUnionsOption = new BooleanOption("declare-unions", "Declare unions as named types", false);

    constructor() {
        super("Simple Types", ["types"], "txt", [SimpleTypesTargetLanguage.declareUnionsOption.definition]);
    }

    protected get partialStringTypeMapping(): Partial<StringTypeMapping> {
        return { date: "date", time: "time", dateTime: "date-time" };
    }

    renderGraph(graph: TypeGraph, optionValues: { [name: string]: any }): RenderResult {
        return new SimpleTypesRenderer(
            graph,
            !SimpleTypesTargetLanguage.declareUnionsOption.getValue(optionValues)
        ).render();
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
    constructor(graph: TypeGraph, private readonly inlineUnions: boolean) {
        super(graph);
    }

    protected topLevelNameStyle(rawName: string): string {
        return simpleNameStyle(rawName, true);
    }

    protected get namedTypeNamer(): Namer {
        return new Namer(n => simpleNameStyle(n, true), []);
    }

    protected get classPropertyNamer(): Namer {
        return new Namer(n => simpleNameStyle(n, false), []);
    }

    protected get unionMemberNamer(): null {
        return null;
    }

    protected get enumCaseNamer(): Namer {
        return new Namer(n => simpleNameStyle(n, true), []);
    }

    protected namedTypeToNameForTopLevel(type: Type): NamedType | null {
        if (type.isNamedType()) {
            return type;
        }
        return null;
    }

    sourceFor = (t: Type): Sourcelike => {
        return matchTypeExhaustive<Sourcelike>(
            t,
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
                if (nullable) return ["Maybe<", this.sourceFor(nullable), ">"];

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
            this.forEachClassProperty(c, "none", (name, _jsonName, t) => {
                this.emitLine(name, ": ", this.sourceFor(t));
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
        this.forEachClass("interposing", this.emitClass);
        this.forEachEnum("leading-and-interposing", this.emitEnum);
        if (!this.inlineUnions) {
            this.forEachUnion("leading-and-interposing", this.emitUnion);
        }
    }
}
