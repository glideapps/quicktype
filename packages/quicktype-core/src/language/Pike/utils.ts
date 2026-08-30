import { funPrefixNamer } from "../../Naming.js";
import {
    isAscii,
    isLetterOrUnderscoreOrDigit,
    legalizeCharacters,
    makeNameStyle,
} from "../../support/Strings.js";

const legalizeName = legalizeCharacters(
    (cp) => isAscii(cp) && isLetterOrUnderscoreOrDigit(cp),
);
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
