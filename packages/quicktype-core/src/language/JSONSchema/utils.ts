import { funPrefixNamer } from "../../Naming.js";
import {
    allUpperWordStyle,
    combineWords,
    firstUpperWordStyle,
    legalizeCharacters,
    splitIntoWords,
} from "../../support/Strings.js";

export const namingFunction = funPrefixNamer("namer", jsonNameStyle);

const legalizeName = legalizeCharacters(
    (cp) => cp >= 32 && cp < 128 && cp !== 0x2f /* slash */,
);

function jsonNameStyle(original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        firstUpperWordStyle,
        firstUpperWordStyle,
        allUpperWordStyle,
        allUpperWordStyle,
        "",
        (_) => true,
    );
}
