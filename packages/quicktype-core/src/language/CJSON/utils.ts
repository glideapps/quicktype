import type { Name } from "../../Naming";
import type { Sourcelike } from "../../Source";
import {
    isAscii,
    isLetterOrUnderscoreOrDigit,
    legalizeCharacters,
} from "../../support/Strings";
import type { Type, TypeKind } from "../../Type";

/* Function used to format names */
export const legalizeName = legalizeCharacters(
    (cp) => isAscii(cp) && isLetterOrUnderscoreOrDigit(cp),
);

/* Used to build forbidden global names */
export enum GlobalNames {
    ClassMemberConstraints = 1,
    ClassMemberConstraintException = 2,
    ValueTooLowException = 3,
    ValueTooHighException = 4,
    ValueTooShortException = 5,
    ValueTooLongException = 6,
    InvalidPatternException = 7,
    CheckConstraint = 8,
}

/* To be able to support circles in multiple files - e.g. class#A using class#B using class#A (obviously not directly) we can forward declare them */
export enum IncludeKind {
    ForwardDeclare = "ForwardDeclare",
    Include = "Include",
}

/* Used to map includes */
export interface IncludeRecord {
    kind: IncludeKind | undefined /* How to include that */;
    typeKind: TypeKind | undefined /* What exactly to include */;
}

/* Used to map includes */
export interface TypeRecord {
    forceInclude: boolean;
    level: number;
    name: Name;
    type: Type;
    variant: boolean;
}

/* Map each and every unique type to a include kind, e.g. how to include the given type */
export type IncludeMap = Map<string, IncludeRecord>;

/* cJSON type */
export interface TypeCJSON {
    addToObject: Sourcelike /* cJSON add to object function */;
    cType: Sourcelike /* C type */;
    cjsonType: string /* cJSON type */;
    createObject: Sourcelike /* cJSON create object function */;
    deleteType: Sourcelike /* cJSON delete function */;
    getValue: Sourcelike /* cJSON get value function */;
    isNullable: boolean /* True if the field is nullable */;
    isType: Sourcelike /* cJSON check type function */;
    items: TypeCJSON | undefined /* Sub-items, used for arrays and map */;
    optionalQualifier: string /* C optional qualifier, empty string if not defined */;
}
