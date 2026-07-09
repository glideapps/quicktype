import { funPrefixNamer } from "../../Naming";
import {
    isLetterOrUnderscoreOrDigit,
    legalizeCharacters,
    makeNameStyle,
} from "../../support/Strings";

const legalizeName = legalizeCharacters(isLetterOrUnderscoreOrDigit);
export const enumNamingFunction = funPrefixNamer(
    "enumNamer",
    makeNameStyle("upper-underscore", legalizeName),
);
export const namingFunction = funPrefixNamer(
    "genericNamer",
    makeNameStyle("underscore", legalizeName),
);
export const namedTypeNamingFunction = funPrefixNamer(
    "typeNamer",
    makeNameStyle("pascal", legalizeName),
);
