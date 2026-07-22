import {
    allLowerWordStyle,
    allUpperWordStyle,
    combineWords,
    escapeNonPrintableMapper,
    firstUpperWordStyle,
    isAscii,
    isDigit,
    isLetter,
    splitIntoWords,
    standardUnicodeHexEscape,
    utf16ConcatMap,
    utf16LegalizeCharacters,
} from "../../support/Strings.js";

export const stringEscape = utf16ConcatMap(
    escapeNonPrintableMapper(isAscii, standardUnicodeHexEscape),
);

function isStartCharacter(codePoint: number): boolean {
    if (codePoint === 0x5f) return true; // underscore
    return isAscii(codePoint) && isLetter(codePoint);
}

function isPartCharacter(codePoint: number): boolean {
    return (
        isStartCharacter(codePoint) ||
        (isAscii(codePoint) && isDigit(codePoint))
    );
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

export function phpNameStyle(
    startWithUpper: boolean,
    upperUnderscore: boolean,
    original: string,
    acronymsStyle: (s: string) => string = allUpperWordStyle,
): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        upperUnderscore
            ? allUpperWordStyle
            : startWithUpper
              ? firstUpperWordStyle
              : allLowerWordStyle,
        upperUnderscore ? allUpperWordStyle : firstUpperWordStyle,
        upperUnderscore || startWithUpper
            ? allUpperWordStyle
            : allLowerWordStyle,
        acronymsStyle,
        upperUnderscore ? "_" : "",
        isStartCharacter,
    );
}

// Words that cannot be used as class names in PHP, in the PascalCase form
// the type namer produces (PHP reserves them case-insensitively): keywords,
// plus the reserved type and constant names, plus the classes the generated
// code itself refers to.  Class names produced from JSON property names
// like "mixed" or "class" would otherwise fail to compile.
export const phpForbiddenClassNames: readonly string[] = [
    "Abstract",
    "And",
    "Array",
    "As",
    "Bool",
    "Break",
    "Callable",
    "Case",
    "Catch",
    "Class",
    "Clone",
    "Const",
    "Continue",
    "Converter",
    "DateTime",
    "DateTimeInterface",
    "Declare",
    "Default",
    "Die",
    "Do",
    "Echo",
    "Else",
    "Elseif",
    "Empty",
    "Enddeclare",
    "Endfor",
    "Endforeach",
    "Endif",
    "Endswitch",
    "Endwhile",
    "Enum",
    "Eval",
    "Exception",
    "Exit",
    "Extends",
    "False",
    "Final",
    "Finally",
    "Float",
    "Fn",
    "For",
    "Foreach",
    "Function",
    "Global",
    "Goto",
    "If",
    "Implements",
    "Include",
    "Instanceof",
    "Insteadof",
    "Int",
    "Interface",
    "Isset",
    "Iterable",
    "List",
    "Match",
    "Mixed",
    "Namespace",
    "Never",
    "New",
    "Null",
    "Object",
    "Or",
    "Parent",
    "Print",
    "Private",
    "Protected",
    "Public",
    "Readonly",
    "Require",
    "Return",
    "Self",
    "Static",
    "StdClass",
    "String",
    "Switch",
    "Throw",
    "Trait",
    "True",
    "Try",
    "Unset",
    "Use",
    "Var",
    "Void",
    "While",
    "Xor",
    "Yield",
    "stdClass",
];
