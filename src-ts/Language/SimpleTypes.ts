"use strict";

import * as _ from "lodash";

import { Set, List, Map, OrderedMap, OrderedSet, Iterable } from "immutable";

import {
    TopLevels,
    Type,
    PrimitiveType,
    ArrayType,
    MapType,
    UnionType,
    NamedType,
    ClassType,
    nullableFromUnion,
    removeNullFromUnion,
    matchType
} from "../Type";

import { Source, Sourcelike } from "../Source";

import {
    legalizeCharacters,
    camelCase,
    startWithLetter,
    stringEscape,
    intercalate
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

function isStartCharacter(c: string): boolean {
    return unicode.isAlphabetic(c.charCodeAt(0)) || c == "_";
}

function isPartCharacter(c: string): boolean {
    const category: string = unicode.getCategory(c.charCodeAt(0));
    return _.includes(["Nd", "Pc", "Mn", "Mc"], category) || isStartCharacter(c);
}

const legalizeName = legalizeCharacters(isPartCharacter);

function simpleNameStyle(original: string, uppercase: boolean): string {
    return startWithLetter(isStartCharacter, uppercase, camelCase(legalizeName(original)));
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
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable) return ["Maybe<", this.sourceFor(nullable), ">"];

                if (this.inlineUnions) {
                    const children = unionType.children.map((t: Type) => this.sourceFor(t));
                    return intercalate(" | ", children).toArray();
                } else {
                    return this.nameForNamedType(unionType);
                }
            }
        );
    };

    private emitClass = (
        c: ClassType,
        className: Name,
        propertyNames: OrderedMap<string, Name>
    ) => {
        this.emitLine("class ", className, " {");
        this.indent(() => {
            propertyNames.forEach((name: Name, jsonName: string) => {
                const type = c.properties.get(jsonName);
                this.emitLine(name, ": ", this.sourceFor(type));
            });
        });
        this.emitLine("}");
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
        if (!this.inlineUnions) {
            this.forEachUnion("leading-and-interposing", this.emitUnion);
        }
    }
}
