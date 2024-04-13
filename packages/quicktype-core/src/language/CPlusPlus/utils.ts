import { Type, TypeKind } from "../../Type";
import { Name } from "../../Naming";
import { Sourcelike } from "../../Source";
import { legalizeCharacters, isAscii, isLetterOrUnderscoreOrDigit } from "../../support/Strings";
import {
    minMaxValueForType,
    minMaxLengthForType,
    patternForType,
    MinMaxConstraint
} from "../../attributes/Constraints";

export function constraintsForType(t: Type):
    | {
          minMax?: MinMaxConstraint;
          minMaxLength?: MinMaxConstraint;
          pattern?: string;
      }
    | undefined {
    const minMax = minMaxValueForType(t);
    const minMaxLength = minMaxLengthForType(t);
    const pattern = patternForType(t);
    if (minMax === undefined && minMaxLength === undefined && pattern === undefined) return undefined;
    return { minMax, minMaxLength, pattern };
}

export const legalizeName = legalizeCharacters(cp => isAscii(cp) && isLetterOrUnderscoreOrDigit(cp));

/// Type to use as an optional if cycle breaking is required
export const optionalAsSharedType = "std::shared_ptr";
/// Factory to use when creating an optional if cycle breaking is required
export const optionalFactoryAsSharedType = "std::make_shared";

/**
 * To be able to support circles in multiple files -
 * e.g. class#A using class#B using class#A (obviously not directly,
 * but in vector or in variant) we can forward declare them;
 */
export enum IncludeKind {
    ForwardDeclare,
    Include
}

export enum GlobalNames {
    ClassMemberConstraints,
    ClassMemberConstraintException,
    ValueTooLowException,
    ValueTooHighException,
    ValueTooShortException,
    ValueTooLongException,
    InvalidPatternException,
    CheckConstraint
}

export enum MemberNames {
    MinIntValue,
    GetMinIntValue,
    SetMinIntValue,
    MaxIntValue,
    GetMaxIntValue,
    SetMaxIntValue,
    MinDoubleValue,
    GetMinDoubleValue,
    SetMinDoubleValue,
    MaxDoubleValue,
    GetMaxDoubleValue,
    SetMaxDoubleValue,
    MinLength,
    GetMinLength,
    SetMinLength,
    MaxLength,
    GetMaxLength,
    SetMaxLength,
    Pattern,
    GetPattern,
    SetPattern
}

export type ConstraintMember = {
    name: MemberNames;
    getter: MemberNames;
    setter: MemberNames;
    cppType: string;
    cppConstType?: string;
};

export type IncludeRecord = {
    kind: IncludeKind | undefined /** How to include that */;
    typeKind: TypeKind | undefined /** What exactly to include */;
};

export type TypeRecord = {
    name: Name;
    type: Type;
    level: number;
    variant: boolean;
    forceInclude: boolean;
};

/**
 * We map each and every unique type to a include kind, e.g. how
 * to include the given type
 */
export type IncludeMap = Map<string, IncludeRecord>;

export type TypeContext = {
    needsForwardIndirection: boolean;
    needsOptionalIndirection: boolean;
    inJsonNamespace: boolean;
};

export interface StringType {
    getType(): string;
    getConstType(): string;
    getSMatch(): string;
    getRegex(): string;
    createStringLiteral(inner: Sourcelike): Sourcelike;
    wrapToString(inner: Sourcelike): Sourcelike;
    wrapEncodingChange(
        qualifier: Sourcelike[],
        fromType: Sourcelike,
        toType: Sourcelike,
        inner: Sourcelike
    ): Sourcelike;
    emitHelperFunctions(): void;
}

export function addQualifier(qualifier: Sourcelike, qualified: Sourcelike[]): Sourcelike[] {
    if (qualified.length === 0) {
        return [];
    }
    return [qualifier, qualified];
}

export class WrappingCode {
    constructor(
        private readonly start: Sourcelike[],
        private readonly end: Sourcelike[]
    ) {}

    wrap(qualifier: Sourcelike, inner: Sourcelike): Sourcelike {
        return [addQualifier(qualifier, this.start), inner, this.end];
    }
}

export class BaseString {
    public _stringType: string;
    public _constStringType: string;
    public _smatch: string;
    public _regex: string;
    public _stringLiteralPrefix: string;
    public _toString: WrappingCode;
    public _encodingClass: Sourcelike;
    public _encodingFunction: Sourcelike;

    constructor(
        stringType: string,
        constStringType: string,
        smatch: string,
        regex: string,
        stringLiteralPrefix: string,
        toString: WrappingCode,
        encodingClass: string,
        encodingFunction: string
    ) {
        this._stringType = stringType;
        this._constStringType = constStringType;
        this._smatch = smatch;
        this._regex = regex;
        this._stringLiteralPrefix = stringLiteralPrefix;
        this._toString = toString;
        this._encodingClass = encodingClass;
        this._encodingFunction = encodingFunction;
    }

    public getType(): string {
        return this._stringType;
    }

    public getConstType(): string {
        return this._constStringType;
    }

    public getSMatch(): string {
        return this._smatch;
    }

    public getRegex(): string {
        return this._regex;
    }

    public createStringLiteral(inner: Sourcelike): Sourcelike {
        return [this._stringLiteralPrefix, '"', inner, '"'];
    }

    public wrapToString(inner: Sourcelike): Sourcelike {
        return this._toString.wrap([], inner);
    }
}
