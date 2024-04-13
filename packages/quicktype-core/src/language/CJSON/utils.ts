import { Type, TypeKind } from "../../Type";
import { Name } from "../../Naming";
import { Sourcelike } from "../../Source";
import { legalizeCharacters, isAscii, isLetterOrUnderscoreOrDigit } from "../../support/Strings";

/* Function used to format names */
export const legalizeName = legalizeCharacters(cp => isAscii(cp) && isLetterOrUnderscoreOrDigit(cp));

/* Used to build forbidden global names */
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

/* To be able to support circles in multiple files - e.g. class#A using class#B using class#A (obviously not directly) we can forward declare them */
export enum IncludeKind {
    ForwardDeclare,
    Include
}

/* Used to map includes */
export type IncludeRecord = {
    kind: IncludeKind | undefined /* How to include that */;
    typeKind: TypeKind | undefined /* What exactly to include */;
};

/* Used to map includes */
export type TypeRecord = {
    name: Name;
    type: Type;
    level: number;
    variant: boolean;
    forceInclude: boolean;
};

/* Map each and every unique type to a include kind, e.g. how to include the given type */
export type IncludeMap = Map<string, IncludeRecord>;

/* cJSON type */
export type TypeCJSON = {
    cType: Sourcelike /* C type */;
    optionalQualifier: string /* C optional qualifier, empty string if not defined */;
    cjsonType: string /* cJSON type */;
    isType: Sourcelike /* cJSON check type function */;
    getValue: Sourcelike /* cJSON get value function */;
    addToObject: Sourcelike /* cJSON add to object function */;
    createObject: Sourcelike /* cJSON create object function */;
    deleteType: Sourcelike /* cJSON delete function */;
    items: TypeCJSON | undefined /* Sub-items, used for arrays and map */;
    isNullable: boolean /* True if the field is nullable */;
};
