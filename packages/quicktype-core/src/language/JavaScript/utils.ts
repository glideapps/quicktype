import { utf16LegalizeCharacters } from "../../support/Strings.js";

import { isES3IdentifierPart } from "./unicodeMaps.js";

export const legalizeName = utf16LegalizeCharacters(isES3IdentifierPart);
