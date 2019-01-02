"use strict";

import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { Name, Namer, funPrefixNamer } from "../Naming";
import { Option } from "../RendererOptions";
import { RenderContext } from "../Renderer";
import { Sourcelike, maybeAnnotated } from "../Source";
import { TargetLanguage } from "../TargetLanguage";
import { Type, ClassType } from "../Type";
import { matchType, nullableFromUnion } from "../TypeUtils";

import {
  legalizeCharacters,
  isLetterOrUnderscoreOrDigit,
  stringEscape,
  makeNameStyle
} from "../support/Strings";

export const pikeOptions = {
};

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
    this.forEachObject(
      "leading-and-interposing",
      (c: ClassType, className: Name) => this.emitClass(c, className));
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

  private emitBlock = (line: Sourcelike, f: () => void): void {
    this.emitLine(line, " {");
    this.indent(f);
    this.emitLine("}");
  };

  private emitStruct(name: Name, table: Sourcelike[][]): void {
    this.emitBlock(["class ", name], () => this.emitTable(table));
  }

  private pikeType(t: Type, withIssues: boolean = false): Sourcelike {
    return matchType<Sourcelike>(
      t,
      _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "mixed"),
      _nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "mixed"),
      _boolType => "bool",
      _integerType => "int",
      _doubleType => "float",
      _stringType => "string",
      arrayType => ["array(", this.pikeType(arrayType.items, withIssues), ")"],
      classType => this.nameForNamedType(classType),
      mapType => {
        let valueSource: Sourcelike;
        const v = mapType.values;

        valueSource = this.pikeType(v, withIssues);
        return ["mapping(string:", valueSource, ")"];
      },
      enumType => this.nameForNamedType(enumType),
      unionType => {
        const nullable = nullableFromUnion(unionType);
        if (nullable !== null) return this.pikeType(nullable, withIssues);
        return this.nameForNamedType(unionType);
      }
    );
  }

  private emitClass(c: ClassType, className: Name): void {
    let columns: Sourcelike[][] = [];
    this.forEachClassProperty(c, "none", (name, jsonName, p) => {
      const pikeType = this.pikeType(p.type, true);

      columns.push([
        [pikeType, " "],
        [name, ";"],
        ['// json: "', stringEscape(jsonName), '"']]);
    });
    this.emitDescription(this.descriptionForType(c));
    this.emitStruct(className, columns);
  }
}