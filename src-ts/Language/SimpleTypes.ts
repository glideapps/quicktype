"use strict";

import * as _ from "lodash";

import { Set, List, Map, OrderedMap, OrderedSet, Collection } from "immutable";

import {
    TopLevels,
    Type,
    PrimitiveType,
    ArrayType,
    MapType,
    EnumType,
    UnionType,
    NamedType,
    ClassType,
    nullableFromUnion,
    removeNullFromUnion,
    matchType
} from "../Type";

import { Source, Sourcelike } from "../Source";

import {
    utf16LegalizeCharacters,
    pascalCase,
    startWithLetter,
    utf16StringEscape,
    intercalate,
    defined
} from "../Support";

import {
    Namer,
    Namespace,
    Name,
    DependencyName,
    SimpleName,
    FixedName,
    keywordNamespace
} from "../Naming";

import { PrimitiveTypeKind, TypeKind } from "Reykjavik";
import { Renderer, RenderResult } from "../Renderer";
import { ConvenienceRenderer } from "../ConvenienceRenderer";

import { TargetLanguage, TypeScriptTargetLanguage } from "../TargetLanguage";
import { BooleanOption } from "../RendererOptions";

const unicode = require("unicode-properties");

export default class SimpleTypesTargetLanguage extends TypeScriptTargetLanguage {
    static declareUnionsOption = new BooleanOption(
        "declare-unions",
        "Declare unions as named types",
        false
    );

    constructor() {
        super("Simple Types", ["types"], "txt", [
            SimpleTypesTargetLanguage.declareUnionsOption.definition
        ]);
    }

    renderGraph(topLevels: TopLevels, optionValues: { [name: string]: any }): RenderResult {
        return new SimpleTypesRenderer(
            topLevels,
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

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

function simpleNameStyle(original: string, uppercase: boolean): string {
    return startWithLetter(isStartCharacter, uppercase, pascalCase(legalizeName(original)));
}

class SimpleTypesRenderer extends ConvenienceRenderer {
    constructor(topLevels: TopLevels, private readonly inlineUnions: boolean) {
        super(topLevels);
    }

    protected topLevelNameStyle(rawName: string): string {
        return simpleNameStyle(rawName, true);
    }

    protected get namedTypeNamer(): Namer {
        return new Namer(n => simpleNameStyle(n, true), []);
    }

    protected get propertyNamer(): Namer {
        return new Namer(n => simpleNameStyle(n, false), []);
    }

    protected get caseNamer(): Namer {
        return new Namer(n => simpleNameStyle(n, true), []);
    }

    protected topLevelDependencyNames(topLevelName: Name): DependencyName[] {
        return [];
    }

    protected namedTypeToNameForTopLevel(type: Type): NamedType | null {
        if (type.isNamedType()) {
            return type;
        }
        return null;
    }

    sourceFor = (t: Type): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            anyType => "Any",
            nullType => "Null",
            boolType => "Bool",
            integerType => "Int",
            doubleType => "Double",
            stringType => "String",
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
            }
        );
    };

    private emitClass = (c: ClassType, className: Name) => {
        this.emitLine("class ", className, " {");
        this.indent(() => {
            this.forEachProperty(c, "none", (name, jsonName, t) => {
                this.emitLine(name, ": ", this.sourceFor(t));
            });
        });
        this.emitLine("}");
    };

    emitEnum = (e: EnumType, enumName: Name) => {
        const caseNames: Sourcelike[] = [];
        this.forEachCase(e, "none", name => {
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
