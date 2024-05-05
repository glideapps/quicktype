import {
    type MinMaxConstraint,
    minMaxLengthForType,
    minMaxValueForType,
    patternForType
} from "../../attributes/Constraints";
import { type Name } from "../../Naming";
import { type Sourcelike } from "../../Source";
import { isAscii, isLetterOrUnderscoreOrDigit, legalizeCharacters } from "../../support/Strings";
import { type Type, type TypeKind } from "../../Type";

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
    ForwardDeclare = "ForwardDeclare",
    Include = "Include"
}

// FIXME: make these string enums eventually
export enum GlobalNames {
    ClassMemberConstraints = 1,
    ClassMemberConstraintException = 2,
    ValueTooLowException = 3,
    ValueTooHighException = 4,
    ValueTooShortException = 5,
    ValueTooLongException = 6,
    InvalidPatternException = 7,
    CheckConstraint = 8
}

// FIXME: make these string enums eventually
export enum MemberNames {
    MinIntValue = 1,
    GetMinIntValue = 2,
    SetMinIntValue = 3,
    MaxIntValue = 4,
    GetMaxIntValue = 5,
    SetMaxIntValue = 6,
    MinDoubleValue = 7,
    GetMinDoubleValue = 8,
    SetMinDoubleValue = 9,
    MaxDoubleValue = 10,
    GetMaxDoubleValue = 11,
    SetMaxDoubleValue = 12,
    MinLength = 13,
    GetMinLength = 14,
    SetMinLength = 15,
    MaxLength = 16,
    GetMaxLength = 17,
    SetMaxLength = 18,
    Pattern = 19,
    GetPattern = 20,
    SetPattern = 21
}

export interface ConstraintMember {
    cppConstType?: string;
    cppType: string;
    getter: MemberNames;
    name: MemberNames;
    setter: MemberNames;
}

export interface IncludeRecord {
    kind: IncludeKind | undefined /** How to include that */;
    typeKind: TypeKind | undefined /** What exactly to include */;
}

export interface TypeRecord {
    forceInclude: boolean;
    level: number;
    name: Name;
    type: Type;
    variant: boolean;
}

/**
 * We map each and every unique type to a include kind, e.g. how
 * to include the given type
 */
export type IncludeMap = Map<string, IncludeRecord>;

export interface TypeContext {
    inJsonNamespace: boolean;
    needsForwardIndirection: boolean;
    needsOptionalIndirection: boolean;
}

export interface StringType {
    createStringLiteral: (inner: Sourcelike) => Sourcelike;
    emitHelperFunctions: () => void;
    getConstType: () => string;
    getRegex: () => string;
    getSMatch: () => string;
    getType: () => string;
    wrapEncodingChange: (
        qualifier: Sourcelike[],
        fromType: Sourcelike,
        toType: Sourcelike,
        inner: Sourcelike
    ) => Sourcelike;
    wrapToString: (inner: Sourcelike) => Sourcelike;
}

export function addQualifier(qualifier: Sourcelike, qualified: Sourcelike[]): Sourcelike[] {
    if (qualified.length === 0) {
        return [];
    }

    return [qualifier, qualified];
}

class WrappingCode {
    public constructor(
        private readonly start: Sourcelike[],
        private readonly end: Sourcelike[]
    ) {}

    public wrap(qualifier: Sourcelike, inner: Sourcelike): Sourcelike {
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

    public constructor(
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
