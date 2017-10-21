"use strict";

import { Map, OrderedMap } from "immutable";

import { TypeScriptTargetLanguage } from "../TargetLanguage";
import {
    Type,
    TopLevels,
    PrimitiveType,
    NamedType,
    ClassType,
    UnionType,
    allClassesAndUnions,
    nullableFromUnion,
    matchTypeAll,
    removeNullFromUnion
} from "../Type";
import { Namespace, Name, DependencyName, Namer, funPrefixNamer } from "../Naming";
import { Sourcelike } from "../Source";
import {
    legalizeCharacters,
    camelCase,
    startWithLetter,
    isLetterOrUnderscore,
    isLetterOrUnderscoreOrDigit,
    stringEscape
} from "../Support";
import { RenderResult } from "../Renderer";
import { ConvenienceRenderer } from "../ConvenienceRenderer";

export default class CPlusPlusTargetLanguage extends TypeScriptTargetLanguage {
    constructor() {
        super("C++", ["c++", "cpp"], "cpp", []);
    }

    renderGraph(topLevels: TopLevels, optionValues: { [name: string]: any }): RenderResult {
        const renderer = new CPlusPlusRenderer(topLevels);
        return renderer.render();
    }
}

const namingFunction = funPrefixNamer(cppNameStyle);

const legalizeName = legalizeCharacters(isLetterOrUnderscoreOrDigit);

function cppNameStyle(original: string): string {
    const legalized = legalizeName(original);
    const cameled = camelCase(legalized);
    return startWithLetter(isLetterOrUnderscore, false, cameled);
}

class CPlusPlusRenderer extends ConvenienceRenderer {
    protected topLevelNameStyle(rawName: string): string {
        return cppNameStyle(rawName);
    }

    protected namedTypeNameStyle(rawName: string): string {
        return cppNameStyle(rawName);
    }

    protected propertyNameStyle(rawName: string): string {
        return cppNameStyle(rawName);
    }

    protected namedTypeToNameForTopLevel(type: Type): NamedType | null {
        // FIXME: implement this properly
        if (type.isNamedType()) {
            return type;
        }
        return null;
    }

    protected get namedTypeNamer(): Namer {
        return namingFunction;
    }

    protected get propertyNamer(): Namer {
        return namingFunction;
    }

    private emitBlock = (line: Sourcelike, f: () => void): void => {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    };

    private emitClass = (
        c: ClassType,
        className: Name,
        propertyNames: OrderedMap<string, Name>
    ): void => {
        this.emitBlock(["struct ", className], () => {
            propertyNames.forEach((name: Name, json: string) => {
                this.emitLine(name, " // ", json);
            });
        });
    };

    protected emitSourceStructure(): void {
        this.emitLine('#include "json.hpp"');
        this.forEachClass("leading-and-interposing", this.emitClass);
    }
}
